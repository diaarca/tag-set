import SetwiseCore
import SwiftUI
import UniformTypeIdentifiers

private enum Editor: Identifiable {
  case add
  case tag(String)
  case newTag
  case song(String)
  var id: String {
    switch self {
    case .add: return "add"
    case .tag(let id): return "tag:\(id)"
    case .newTag: return "newTag"
    case .song(let id): return "song:\(id)"
    }
  }
}

@MainActor
struct LibraryView: View {
  @EnvironmentObject private var library: NativeLibraryStore
  @EnvironmentObject private var player: AudioPlayer
  @Environment(\.scenePhase) private var scenePhase
  @AppStorage("iCloudSyncEnabled") private var syncEnabled = false
  @State private var selected: String? = "all"
  @State private var tagSearch = ""
  @State private var songSearch = ""
  @State private var editor: Editor?
  @State private var importing = false
  private var tagID: String? { selected == "all" ? nil : selected }
  private var collectionSongs: [MusicTrack] { library.snapshot.songs(in: tagID) }
  private var songs: [MusicTrack] {
    collectionSongs.filter {
      songSearch.isEmpty
        || "\($0.title) \($0.artists.joined(separator: " "))".localizedCaseInsensitiveContains(
          songSearch)
    }
  }

  var body: some View {
    NavigationSplitView {
      List(selection: $selected) {
        NavigationLink(value: "all") { Label("All songs", systemImage: "music.note.list") }
        Section("Tags") {
          ForEach(
            library.snapshot.sortedTags.filter {
              tagSearch.isEmpty || $0.name.localizedCaseInsensitiveContains(tagSearch)
            }
          ) { tag in
            NavigationLink(value: tag.id) {
              HStack {
                Label(tag.name, systemImage: tag.pinned ? "pin.fill" : "number")
                Spacer()
                Text("\(library.snapshot.songs(in: tag.id).count)").foregroundStyle(.secondary)
              }
            }
            .contextMenu {
              Button(tag.pinned ? "Unpin" : "Pin") {
                perform { try library.commit([.pinTag(tag.id, !tag.pinned)]) }
              }
              Button("Edit connections") { editor = .tag(tag.id) }
            }
          }
        }
      }
      .searchable(text: $tagSearch, prompt: "Find a tag")
      .navigationTitle("Setwise")
      .toolbar {
        Button {
          editor = .newTag
        } label: {
          Label("Create tag", systemImage: "plus")
        }
      }
    } detail: {
      VStack(spacing: 0) {
        List {
          if let tagID, let tag = library.snapshot.tags[tagID] {
            Section {
              Button("Edit tag connections") { editor = .tag(tag.id) }
              Text(
                collectionSongs.count >= 2
                  ? "Automatic playlist · \(collectionSongs.count) songs"
                  : "Tag collection · \(collectionSongs.count) songs"
              ).font(.caption).foregroundStyle(.secondary)
            }
          }
          Section {
            if songs.isEmpty {
              ContentUnavailableView(
                "Make a connection", systemImage: "music.note",
                description: Text("Add a song, import a playlist, or connect a child tag."))
            }
            ForEach(songs) { song in
              HStack {
                Button {
                  player.start([song])
                } label: {
                  Image(
                    systemName: player.current?.id == song.id && player.playing
                      ? "speaker.wave.2.fill" : "play.fill")
                }.buttonStyle(.borderless).accessibilityLabel("Play \(song.title)")
                VStack(alignment: .leading) {
                  Text(song.title)
                  Text(song.artists.joined(separator: " · ")).font(.caption).foregroundStyle(
                    .secondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Button {
                  editor = .song(song.id)
                } label: {
                  Image(systemName: "ellipsis")
                }.buttonStyle(.borderless).accessibilityLabel("Edit \(song.title)")
              }
            }
          }
        }
        .searchable(text: $songSearch, prompt: "Search this collection")
        PlayerBar()
        HStack {
          if library.cloudSyncAvailable {
            Toggle("iCloud sync", isOn: $syncEnabled).toggleStyle(.switch).fixedSize()
          }
          Text(library.syncStatus).font(.caption).foregroundStyle(.secondary).lineLimit(2)
          Spacer()
          if library.cloudSyncAvailable {
            Button {
              Task { await library.synchronize() }
            } label: {
              Image(systemName: "arrow.triangle.2.circlepath")
            }.disabled(!syncEnabled || library.syncing).accessibilityLabel("Sync now")
          }
        }.padding(10)
      }
      .navigationTitle(tagID.flatMap { library.snapshot.tags[$0]?.name } ?? "All songs")
      .toolbar {
        Button {
          player.start(collectionSongs)
        } label: {
          Label("Play collection", systemImage: "play.fill")
        }.disabled(collectionSongs.isEmpty)
        Button {
          editor = .add
        } label: {
          Label("Add music", systemImage: "plus")
        }
        Button {
          importing = true
        } label: {
          Label("Import web library", systemImage: "square.and.arrow.down")
        }
      }
    }
    .tint(.green)
    .sheet(item: $editor) { selection in
      NavigationStack {
        Group {
          switch selection {
          case .add: ImportMusicView()
          case .newTag: TagEditorView(id: nil)
          case .tag(let id): TagEditorView(id: id)
          case .song(let id): SongEditorView(id: id)
          }
        }.toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Done") { editor = nil } }
        }
      }.frame(idealWidth: 620, idealHeight: 650)
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
      perform { try library.importWebLibrary(result.get()) }
    }
    .alert(
      "Setwise",
      isPresented: Binding(get: { library.error != nil }, set: { if !$0 { library.error = nil } })
    ) {
      Button("OK") { library.error = nil }
    } message: {
      Text(library.error ?? "")
    }
    .task(id: "\(syncEnabled)-\(scenePhase == .active)") {
      guard library.cloudSyncAvailable, syncEnabled, scenePhase == .active else { return }
      while !Task.isCancelled {
        await library.synchronize()
        do { try await Task.sleep(for: .seconds(60)) } catch { break }
      }
    }
    .task(id: library.journal.events.count) {
      guard library.cloudSyncAvailable, syncEnabled, scenePhase == .active else { return }
      do {
        try await Task.sleep(for: .seconds(1))
        await library.synchronize()
      } catch {}
    }
  }
  private func perform(_ operation: () throws -> Void) {
    do { try operation() } catch { library.error = error.localizedDescription }
  }
}

@MainActor
private struct PlayerBar: View {
  @EnvironmentObject private var player: AudioPlayer
  private func time(_ value: Double) -> String {
    "\(Int(value) / 60):\(String(format: "%02d", Int(value) % 60))"
  }
  var body: some View {
    VStack(spacing: 10) {
      if let song = player.current {
        HStack {
          Image(systemName: "music.note").font(.title2)
          VStack(alignment: .leading) {
            Text(song.title).lineLimit(1)
            Text(song.artists.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
              .lineLimit(1)
          }
          Spacer()
          if player.loading { ProgressView() }
        }
        HStack {
          Text(time(player.position)).monospacedDigit()
          Slider(
            value: Binding(
              get: { min(player.position, max(player.duration, 1)) }, set: { player.seek($0) }),
            in: 0...max(player.duration, 1)
          ).disabled(player.duration <= 0).accessibilityLabel("Seek")
          Text(time(player.duration)).monospacedDigit()
        }.font(.caption)
        HStack(spacing: 25) {
          Button {
            player.shuffle.toggle()
          } label: {
            Image(systemName: "shuffle").foregroundStyle(
              player.shuffle ? Color.green : Color.secondary)
          }.accessibilityLabel("Shuffle")
          Button(action: player.previous) { Image(systemName: "backward.end.fill") }
            .accessibilityLabel("Previous song")
          Button(action: player.toggle) {
            Image(systemName: player.playing || player.loading ? "pause.fill" : "play.fill").font(
              .title2)
          }.accessibilityLabel(player.playing ? "Pause" : "Play")
          Button {
            player.advance()
          } label: {
            Image(systemName: "forward.end.fill")
          }.accessibilityLabel("Next song")
          Button {
            let modes = AudioPlayer.RepeatMode.allCases
            player.repeatMode = modes[(modes.firstIndex(of: player.repeatMode)! + 1) % modes.count]
          } label: {
            Image(systemName: player.repeatMode == .one ? "repeat.1" : "repeat").foregroundStyle(
              player.repeatMode == .off ? Color.secondary : Color.green)
          }.accessibilityLabel("Repeat: \(player.repeatMode.rawValue)")
        }.buttonStyle(.borderless)
        #if os(macOS)
          Slider(value: $player.volume, in: 0...1).accessibilityLabel("Volume")
        #endif
      } else {
        Text("Choose a song or tag collection to begin.").foregroundStyle(.secondary)
      }
      if let error = player.error {
        Text(error).font(.caption).foregroundStyle(.red)
        HStack {
          Button("Retry", action: player.retry)
          Button("Skip") { player.advance() }
        }
      }
    }.padding().background(.thinMaterial)
  }
}

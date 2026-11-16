import SetwiseCore
import SwiftUI

@MainActor
struct ImportMusicView: View {
  @EnvironmentObject private var library: NativeLibraryStore
  @State private var mode = "Search"
  @State private var query = ""
  @State private var url = ""
  @State private var tagName = ""
  @State private var title = ""
  @State private var artists = ""
  @State private var results: [MusicTrack] = []
  @State private var busy = false
  @State private var message = ""
  @State private var error: String?
  private let catalog = MusicCatalog()
  var body: some View {
    Form {
      Picker("Add music", selection: $mode) {
        ForEach(["Search", "Song link", "Playlist", "Manual"], id: \.self) { Text($0) }
      }.disabled(busy)
      if mode == "Search" {
        TextField("Song title or artist", text: $query)
        Button("Search YouTube Music") {
          run {
            results = try await catalog.search(query)
            message = results.isEmpty ? "No matching songs." : ""
          }
        }.disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
        ForEach(results) { song in
          HStack {
            VStack(alignment: .leading) {
              Text(song.title)
              Text(song.artists.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if library.snapshot.songs[song.id] != nil {
              Text("In library").font(.caption)
            } else {
              Button("Add") {
                run {
                  try library.importSongs([song])
                  message = "Added \(song.title)."
                }
              }.disabled(busy)
            }
          }
        }
      } else {
        TextField(mode == "Playlist" ? "Public playlist URL" : "YouTube Music song URL", text: $url)
        if mode == "Playlist" {
          TextField("Tag name (defaults to playlist title)", text: $tagName)
          Text(
            "Existing songs and tags are reused. Reimporting adds songs without removing assignments."
          ).font(.caption).foregroundStyle(.secondary)
        }
        if mode == "Manual" {
          TextField("Song title", text: $title)
          TextField("Artists, one per line", text: $artists, axis: .vertical).lineLimit(2...5)
        }
        Button("Import") {
          run {
            if mode == "Playlist" {
              let playlist = try await catalog.playlist(url)
              guard !playlist.tracks.isEmpty else {
                throw LibraryError.invalid("This playlist has no importable songs.")
              }
              try library.importSongs(
                playlist.tracks,
                tag: tagName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                  ? playlist.title : tagName)
              message =
                "Imported \(playlist.tracks.count) songs into a tag; \(playlist.skipped) unavailable entries skipped."
            } else {
              let song: MusicTrack
              if mode == "Manual" {
                song = try validatedTrack(
                  videoId: YouTubeLink.video(url), title: title, artists: artists)
              } else {
                song = try await catalog.lookup(url)
              }
              try library.importSongs([song])
              message = "Added \(song.title)."
            }
          }
        }.disabled(busy || url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
      if busy { ProgressView("Connecting to YouTube Music…") }
      if !message.isEmpty { Text(message).foregroundStyle(.green) }
      if let error { Text(error).foregroundStyle(.red) }
    }.navigationTitle("Add music")
  }
  private func run(_ operation: @escaping @MainActor () async throws -> Void) {
    busy = true
    message = ""
    error = nil
    Task {
      do { try await operation() } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}

func validatedTrack(videoId: String, title: String, artists: String) throws -> MusicTrack {
  let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
  var seen = Set<String>()
  let names = artists.components(separatedBy: .newlines).map {
    $0.trimmingCharacters(in: .whitespacesAndNewlines)
  }.filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
  guard !name.isEmpty, name.count <= 500, !names.isEmpty, names.count <= 30,
    names.allSatisfy({ $0.count <= 200 })
  else { throw LibraryError.invalid("Enter a title and between 1 and 30 artist names.") }
  return MusicTrack(videoId: videoId, title: name, artists: names)
}

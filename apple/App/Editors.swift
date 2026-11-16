import SetwiseCore
import SwiftUI

@MainActor
struct SongEditorView: View {
  let id: String
  @EnvironmentObject private var library: NativeLibraryStore
  @EnvironmentObject private var player: AudioPlayer
  @Environment(\.dismiss) private var dismiss
  @State private var title = ""
  @State private var artists = ""
  @State private var selectedTag = ""
  @State private var deleting = false
  @State private var message = ""
  @State private var error: String?
  var body: some View {
    Form {
      Section("Song details") {
        TextField("Title", text: $title)
        TextField("Artists, one per line", text: $artists, axis: .vertical).lineLimit(2...5)
        Button("Save details") {
          perform {
            try library.update(validatedTrack(videoId: id, title: title, artists: artists))
            message = "Saved."
          }
        }
        if !message.isEmpty { Text(message).foregroundStyle(.green) }
      }
      Section("Tags") {
        ForEach(
          library.snapshot.sortedTags.filter { tag in
            library.snapshot.songs(in: tag.id).contains(where: { $0.id == id })
          }
        ) { tag in
          let direct = library.snapshot.assignments.filter { $0.song == id && $0.tag == tag.id }
          let via = library.snapshot.links.filter {
            $0.parent == tag.id
              && library.snapshot.songs(in: $0.child).contains(where: { $0.id == id })
          }
          VStack(alignment: .leading) {
            HStack {
              Text("# \(tag.name)")
              Spacer()
              if direct.contains(where: { $0.origin == "manual" }) {
                Button("Remove direct") {
                  perform {
                    try library.commit([.assignment(Assignment(song: id, tag: tag.id), false)])
                  }
                }
              }
            }
            if direct.contains(where: { $0.origin == "artist" }) {
              Text("Artist tag").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array(via).sorted { $0.child < $1.child }, id: \.self) { edge in
              Text("Inherited via \(library.snapshot.tags[edge.child]?.name ?? edge.child)").font(
                .caption
              ).foregroundStyle(.secondary)
            }
          }
        }
        Picker("Assign tag", selection: $selectedTag) {
          Text("Choose a tag").tag("")
          ForEach(library.snapshot.sortedTags) { Text($0.name).tag($0.id) }
        }
        Button("Add tag") {
          perform {
            try library.commit([.assignment(Assignment(song: id, tag: selectedTag), true)])
            selectedTag = ""
          }
        }.disabled(selectedTag.isEmpty)
      }
      if let error { Text(error).foregroundStyle(.red) }
      Button("Delete song", role: .destructive) { deleting = true }
    }
    .navigationTitle("Song details")
    .onAppear {
      title = library.snapshot.songs[id]?.title ?? ""
      artists = library.snapshot.songs[id]?.artists.joined(separator: "\n") ?? ""
    }
    .confirmationDialog(
      "Delete this song from your library?", isPresented: $deleting, titleVisibility: .visible
    ) {
      Button("Delete song", role: .destructive) {
        perform {
          try library.commit([.removeSong(id)])
          player.remove(id)
          dismiss()
        }
      }
    }
  }
  private func perform(_ operation: () throws -> Void) {
    error = nil
    do { try operation() } catch { self.error = error.localizedDescription }
  }
}

@MainActor
struct TagEditorView: View {
  let id: String?
  @EnvironmentObject private var library: NativeLibraryStore
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var parent = ""
  @State private var child = ""
  @State private var deleting = false
  @State private var error: String?
  var body: some View {
    Form {
      Section("Tag") {
        TextField("Name", text: $name)
        Button(id == nil ? "Create tag" : "Save name") {
          perform {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, trimmed.count <= 200 else {
              throw LibraryError.invalid("Tag names must contain 1–200 characters.")
            }
            if let id {
              try library.commit([.renameTag(id, trimmed)])
            } else {
              guard
                !library.snapshot.tags.values.contains(where: {
                  MusicTag.key($0.name) == MusicTag.key(trimmed)
                })
              else { throw LibraryError.invalid("A tag with this name already exists.") }
              try library.commit([.tag(MusicTag(id: UUID().uuidString, name: trimmed))])
              dismiss()
            }
          }
        }
        if let id, let tag = library.snapshot.tags[id] {
          Button(tag.pinned ? "Unpin" : "Pin at top") {
            perform { try library.commit([.pinTag(id, !tag.pinned)]) }
          }
        }
      }
      if let id {
        Section("Parents — include this tag's songs") {
          ForEach(
            Array(library.snapshot.links.filter { $0.child == id }).sorted {
              $0.parent < $1.parent
            }, id: \.self
          ) { edge in connection(edge, other: edge.parent) }
          Picker("Add parent", selection: $parent) {
            Text("Choose a tag").tag("")
            ForEach(library.snapshot.sortedTags.filter { $0.id != id }) { Text($0.name).tag($0.id) }
          }
          Button("Connect parent") {
            perform {
              try library.commit([.link(TagLink(parent: parent, child: id), true)])
              parent = ""
            }
          }.disabled(parent.isEmpty)
        }
        Section("Children — their songs belong here") {
          ForEach(
            Array(library.snapshot.links.filter { $0.parent == id }).sorted { $0.child < $1.child },
            id: \.self
          ) { edge in connection(edge, other: edge.child) }
          Picker("Add child", selection: $child) {
            Text("Choose a tag").tag("")
            ForEach(library.snapshot.sortedTags.filter { $0.id != id }) { Text($0.name).tag($0.id) }
          }
          Button("Connect child") {
            perform {
              try library.commit([.link(TagLink(parent: id, child: child), true)])
              child = ""
            }
          }.disabled(child.isEmpty)
        }
        Button("Delete tag", role: .destructive) { deleting = true }
      }
      if let error { Text(error).foregroundStyle(.red) }
    }.navigationTitle(id == nil ? "Create tag" : "Tag connections")
      .onAppear { name = id.flatMap { library.snapshot.tags[$0]?.name } ?? "" }
      .confirmationDialog(
        "Delete this tag and its relationships? Songs and other tags remain.",
        isPresented: $deleting, titleVisibility: .visible
      ) {
        Button("Delete tag", role: .destructive) {
          if let id {
            perform {
              try library.commit([.removeTag(id)])
              dismiss()
            }
          }
        }
      }
  }
  private func connection(_ edge: TagLink, other: String) -> some View {
    HStack {
      Text(library.snapshot.tags[other]?.name ?? other)
      Spacer()
      Button("Unlink") { perform { try library.commit([.link(edge, false)]) } }
    }
  }
  private func perform(_ operation: () throws -> Void) {
    error = nil
    do { try operation() } catch { self.error = error.localizedDescription }
  }
}

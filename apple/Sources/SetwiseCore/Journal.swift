import Foundation

public struct LibraryJournal: Codable, Sendable {
  public var version = 1
  public var device = UUID()
  public var events: [LibraryEvent] = []
  public var uploaded: Set<UUID> = []
  public var cloudToken: Data?
  public var cloudAccount: String?
  public init() {}
  public var snapshot: LibrarySnapshot { LibrarySnapshot(events: events) }
  public var pending: [LibraryEvent] { events.filter { !uploaded.contains($0.id) } }

  public mutating func append(_ changes: [LibraryChange]) throws {
    guard !changes.isEmpty else { return }
    var counter = events.map(\.counter).max() ?? 0
    var additions: [LibraryEvent] = []
    var chunk: [LibraryChange] = []
    var size = 0
    for change in changes {
      let encoded = try JSONEncoder().encode(change)
      guard encoded.count < 450_000 else {
        throw LibraryError.invalid("This library entry is too large to synchronize.")
      }
      if size + encoded.count > 450_000 {
        guard counter < Int64.max else {
          throw LibraryError.invalid("Invalid library event counter.")
        }
        counter += 1
        additions.append(LibraryEvent(counter: counter, device: device, changes: chunk))
        chunk = []
        size = 0
      }
      chunk.append(change)
      size += encoded.count
    }
    guard counter < Int64.max else { throw LibraryError.invalid("Invalid library event counter.") }
    additions.append(LibraryEvent(counter: counter + 1, device: device, changes: chunk))
    let candidate = LibrarySnapshot(events: events + additions)
    guard candidate.conflicts.count == snapshot.conflicts.count else {
      throw LibraryError.invalid("This edit would create a duplicate tag name or tag cycle.")
    }
    events += additions
  }

  public mutating func merge(_ incoming: [LibraryEvent]) throws {
    var known = Dictionary(uniqueKeysWithValues: events.map { ($0.id, $0) })
    for event in incoming {
      if let existing = known[event.id], existing != event {
        throw LibraryError.invalid("Conflicting copies of a library change were received.")
      }
      guard event.counter > 0 else {
        throw LibraryError.invalid("An invalid library change was received.")
      }
      known[event.id] = event
    }
    events = known.values.sorted(by: LibraryEvent.ordered)
  }
}

public struct WebLibraryTransfer: Decodable {
  struct WebSong: Decodable {
    let id: Int
    let videoId: String
    let title: String
    let artists: [String]
  }
  struct WebTag: Decodable {
    let id: Int
    let name: String
    let pinned: Bool
  }
  struct WebAssignment: Decodable {
    let songId: Int
    let tagId: Int
    let origin: String
  }
  struct WebEdge: Decodable {
    let parentId: Int
    let childId: Int
  }
  let version: Int
  let songs: [WebSong]
  let tags: [WebTag]
  let assignments: [WebAssignment]
  let edges: [WebEdge]

  public func changes(into snapshot: LibrarySnapshot) throws -> [LibraryChange] {
    guard version == 1 else { throw LibraryError.invalid("Unsupported library export version.") }
    guard Set(songs.map(\.id)).count == songs.count, Set(tags.map(\.id)).count == tags.count else {
      throw LibraryError.invalid("Duplicate identifiers in library export.")
    }
    var changes: [LibraryChange] = []
    var songIDs: [Int: String] = [:]
    var tagIDs: [Int: String] = [:]
    for source in songs {
      guard source.videoId.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
        !source.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        !source.artists.isEmpty, source.artists.count <= 30,
        source.artists.allSatisfy({
          !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.count <= 200
        }), source.title.count <= 500
      else { throw LibraryError.invalid("Invalid song in library export.") }
      songIDs[source.id] = source.videoId
      if snapshot.songs[source.videoId] == nil {
        changes.append(
          .song(MusicTrack(videoId: source.videoId, title: source.title, artists: source.artists)))
      }
    }
    for source in tags {
      guard !MusicTag.key(source.name).isEmpty, source.name.count <= 200 else {
        throw LibraryError.invalid("Invalid tag in library export.")
      }
      var tag = snapshot.tag(named: source.name)
      if snapshot.tags[tag.id] == nil { tag.pinned = source.pinned }
      tagIDs[source.id] = tag.id
      if snapshot.tags[tag.id] == nil { changes.append(.tag(tag)) }
    }
    for source in assignments {
      guard let song = songIDs[source.songId], let tag = tagIDs[source.tagId],
        ["manual", "artist"].contains(source.origin)
      else { throw LibraryError.invalid("Invalid assignment in library export.") }
      changes.append(.assignment(Assignment(song: song, tag: tag, origin: source.origin), true))
    }
    for source in edges {
      guard let parent = tagIDs[source.parentId], let child = tagIDs[source.childId] else {
        throw LibraryError.invalid("Invalid relationship in library export.")
      }
      changes.append(.link(TagLink(parent: parent, child: child), true))
    }
    return changes
  }
}

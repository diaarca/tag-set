import Foundation

public struct MusicTrack: Codable, Hashable, Identifiable, Sendable {
  public var id: String { videoId }
  public var videoId: String
  public var title: String
  public var artists: [String]
  public init(videoId: String, title: String, artists: [String]) {
    self.videoId = videoId
    self.title = title
    self.artists = artists
  }
}

public struct MusicTag: Codable, Hashable, Identifiable, Sendable {
  public var id: String
  public var name: String
  public var pinned: Bool
  public init(id: String, name: String, pinned: Bool = false) {
    self.id = id
    self.name = name
    self.pinned = pinned
  }
  public static func key(_ name: String) -> String {
    name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }
  public static func named(_ name: String) -> MusicTag {
    MusicTag(id: "tag:\(key(name))", name: name.trimmingCharacters(in: .whitespacesAndNewlines))
  }
}

public struct Assignment: Codable, Hashable, Sendable {
  public var song: String
  public var tag: String
  public var origin: String
  public init(song: String, tag: String, origin: String = "manual") {
    self.song = song
    self.tag = tag
    self.origin = origin
  }
}
public struct TagLink: Codable, Hashable, Sendable {
  public var parent: String
  public var child: String
  public init(parent: String, child: String) {
    self.parent = parent
    self.child = child
  }
}

public enum LibraryChange: Codable, Hashable, Sendable {
  case song(MusicTrack)
  case tag(MusicTag)
  case updateSong(MusicTrack)
  case renameTag(String, String)
  case pinTag(String, Bool)
  case removeSong(String)
  case removeTag(String)
  case assignment(Assignment, Bool)
  case link(TagLink, Bool)
}

public struct LibraryEvent: Codable, Hashable, Identifiable, Sendable {
  public let id: UUID
  public let counter: Int64
  public let device: UUID
  public let changes: [LibraryChange]
  public init(id: UUID = UUID(), counter: Int64, device: UUID, changes: [LibraryChange]) {
    self.id = id
    self.counter = counter
    self.device = device
    self.changes = changes
  }
  public static func ordered(_ lhs: Self, _ rhs: Self) -> Bool {
    if lhs.counter != rhs.counter { return lhs.counter < rhs.counter }
    if lhs.device != rhs.device { return lhs.device.uuidString < rhs.device.uuidString }
    return lhs.id.uuidString < rhs.id.uuidString
  }
}

public struct LibrarySnapshot: Sendable {
  public private(set) var songs: [String: MusicTrack] = [:]
  public private(set) var tags: [String: MusicTag] = [:]
  public private(set) var assignments: Set<Assignment> = []
  public private(set) var links: Set<TagLink> = []
  public private(set) var conflicts: [String] = []
  private var aliases: [String: String] = [:]

  private func tagID(_ id: String) -> String { aliases[id] ?? id }
  public func tag(named name: String) -> MusicTag {
    if let existing = tags.values.first(where: { MusicTag.key($0.name) == MusicTag.key(name) }) {
      return existing
    }
    let proposed = MusicTag.named(name)
    return tags[proposed.id] == nil
      ? proposed : MusicTag(id: UUID().uuidString, name: proposed.name)
  }

  public init(events: [LibraryEvent] = []) {
    for event in events.sorted(by: LibraryEvent.ordered) {
      for change in event.changes { apply(change) }
    }
  }

  public func descendants(of tag: String) -> Set<String> {
    var result: Set<String> = [tag]
    var pending = [tag]
    while let current = pending.popLast() {
      for edge in links where edge.parent == current {
        if result.insert(edge.child).inserted { pending.append(edge.child) }
      }
    }
    return result
  }

  public func songs(in tag: String?) -> [MusicTrack] {
    let matching: Set<String>?
    if let tag {
      let children = descendants(of: tag)
      matching = Set(assignments.filter { children.contains($0.tag) }.map(\.song))
    } else {
      matching = nil
    }
    return songs.values.filter { matching?.contains($0.id) ?? true }.sorted {
      let order = $0.title.localizedCaseInsensitiveCompare($1.title)
      return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
    }
  }

  public var sortedTags: [MusicTag] {
    tags.values.sorted {
      if $0.pinned != $1.pinned { return $0.pinned }
      let order = $0.name.localizedCaseInsensitiveCompare($1.name)
      return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
    }
  }

  public func importChanges(_ tracks: [MusicTrack], into name: String? = nil) -> [LibraryChange] {
    var changes: [LibraryChange] = []
    let target = name.map { tag(named: $0) }
    if let target, tags[target.id] == nil { changes.append(.tag(target)) }
    var added = Set<String>()
    for track in tracks where added.insert(track.id).inserted {
      if songs[track.id] == nil {
        changes.append(.song(track))
        for artist in track.artists {
          let tag = tag(named: artist)
          if tags[tag.id] == nil { changes.append(.tag(tag)) }
          changes.append(
            .assignment(Assignment(song: track.id, tag: tag.id, origin: "artist"), true))
        }
      }
      if let target {
        changes.append(.assignment(Assignment(song: track.id, tag: target.id), true))
      }
    }
    return changes
  }

  private mutating func apply(_ change: LibraryChange) {
    switch change {
    case .song(let song): if songs[song.id] == nil { songs[song.id] = song }
    case .updateSong(let song): if songs[song.id] != nil { songs[song.id] = song }
    case .tag(let tag):
      let canonical = tagID(tag.id)
      guard tags[canonical] == nil else { return }
      if let existing = tags.values.first(where: { MusicTag.key($0.name) == MusicTag.key(tag.name) }
      ) {
        aliases[tag.id] = existing.id
      } else {
        var value = tag
        value.id = canonical
        tags[canonical] = value
      }
    case .renameTag(let source, let name):
      let id = tagID(source)
      guard var tag = tags[id] else { return }
      if tags.values.contains(where: { $0.id != id && MusicTag.key($0.name) == MusicTag.key(name) })
      {
        conflicts.append("A concurrent tag name conflict was ignored: \(name).")
      } else {
        tag.name = name
        tags[id] = tag
      }
    case .pinTag(let source, let pinned):
      let id = tagID(source)
      if tags[id] != nil { tags[id]?.pinned = pinned }
    case .removeSong(let id):
      songs[id] = nil
      assignments = assignments.filter { $0.song != id }
    case .removeTag(let source):
      let id = tagID(source)
      tags[id] = nil
      assignments = assignments.filter { $0.tag != id }
      links = links.filter { $0.parent != id && $0.child != id }
    case .assignment(var assignment, let present):
      assignment.tag = tagID(assignment.tag)
      if present {
        if songs[assignment.song] != nil && tags[assignment.tag] != nil {
          assignments.insert(assignment)
        }
      } else {
        assignments.remove(assignment)
      }
    case .link(var edge, let present):
      edge.parent = tagID(edge.parent)
      edge.child = tagID(edge.child)
      if !present {
        links.remove(edge)
      } else if tags[edge.parent] != nil && tags[edge.child] != nil {
        if descendants(of: edge.child).contains(edge.parent) {
          conflicts.append("A concurrent tag cycle was ignored.")
        } else {
          links.insert(edge)
        }
      }
    }
  }
}

public enum LibraryError: LocalizedError {
  case invalid(String)
  public var errorDescription: String? {
    switch self {
    case .invalid(let message): return message
    }
  }
}

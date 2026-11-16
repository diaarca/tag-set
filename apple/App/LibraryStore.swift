import Combine
import Foundation
import SetwiseCore

@MainActor
final class NativeLibraryStore: ObservableObject {
  @Published private(set) var journal = LibraryJournal()
  @Published private(set) var snapshot = LibrarySnapshot()
  @Published private(set) var syncStatus = "Stored on this device"
  @Published private(set) var syncing = false
  @Published var error: String?
  private let url: URL
  private var loaded = false
  private var cloudIdentifier: String? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: "SetwiseCloudContainer") as? String,
      !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !value.contains("example")
    else { return nil }
    return value
  }
  var cloudSyncAvailable: Bool { cloudIdentifier != nil }

  init() {
    url = URL.applicationSupportDirectory.appending(path: "Setwise/library.json")
    do {
      if FileManager.default.fileExists(atPath: url.path) {
        journal = try JSONDecoder().decode(LibraryJournal.self, from: Data(contentsOf: url))
        guard journal.version == 1 else {
          throw LibraryError.invalid("This library requires a newer version of Setwise.")
        }
        guard Set(journal.events.map(\.id)).count == journal.events.count,
          journal.events.allSatisfy({ $0.counter > 0 })
        else { throw LibraryError.invalid("The library journal contains invalid changes.") }
      }
      snapshot = journal.snapshot
      loaded = true
    } catch {
      self.error =
        "The local library could not be read. It has not been overwritten. \(error.localizedDescription)"
    }
  }

  private func persist(_ candidate: LibraryJournal) throws {
    guard loaded else {
      throw LibraryError.invalid("Resolve the library loading error before making changes.")
    }
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(candidate).write(to: url, options: .atomic)
    journal = candidate
    snapshot = candidate.snapshot
  }

  func commit(_ changes: [LibraryChange]) throws {
    var candidate = journal
    try candidate.append(changes)
    try persist(candidate)
  }

  func importSongs(_ tracks: [MusicTrack], tag: String? = nil) throws {
    try commit(snapshot.importChanges(tracks, into: tag))
  }

  func importWebLibrary(_ url: URL) throws {
    let allowed = url.startAccessingSecurityScopedResource()
    defer { if allowed { url.stopAccessingSecurityScopedResource() } }
    let transfer = try JSONDecoder().decode(WebLibraryTransfer.self, from: Data(contentsOf: url))
    try commit(transfer.changes(into: snapshot))
  }

  func update(_ track: MusicTrack) throws {
    guard let old = snapshot.songs[track.id] else { return }
    var changes: [LibraryChange] = [.updateSong(track)]
    if old.artists != track.artists {
      changes += snapshot.assignments.filter { $0.song == track.id && $0.origin == "artist" }.map {
        .assignment($0, false)
      }
      for name in track.artists {
        let tag = snapshot.tag(named: name)
        if snapshot.tags[tag.id] == nil { changes.append(.tag(tag)) }
        changes.append(.assignment(Assignment(song: track.id, tag: tag.id, origin: "artist"), true))
      }
    }
    try commit(changes)
  }

  func synchronize() async {
    guard loaded, !syncing else { return }
    guard let identifier = cloudIdentifier else {
      syncStatus = "iCloud sync is not enabled in this build"
      return
    }
    syncing = true
    syncStatus = "Synchronizing…"
    defer { syncing = false }
    do {
      let cloud = CloudLibrary(identifier: identifier)
      let exchange = try await cloud.exchange(
        pending: journal.pending, tokenData: journal.cloudToken, account: journal.cloudAccount)
      // Include edits made while the network request was in flight.
      var candidate = journal
      try candidate.merge(exchange.events)
      candidate.uploaded.formUnion(exchange.uploaded)
      candidate.uploaded.formUnion(exchange.events.map(\.id))
      candidate.cloudToken = exchange.token
      candidate.cloudAccount = exchange.account
      try persist(candidate)
      syncStatus =
        candidate.snapshot.conflicts.isEmpty
        ? "Synced with iCloud"
        : "Synced · \(candidate.snapshot.conflicts.count) conflicting edits ignored"
    } catch { syncStatus = "Sync paused: \(error.localizedDescription)" }
  }
}

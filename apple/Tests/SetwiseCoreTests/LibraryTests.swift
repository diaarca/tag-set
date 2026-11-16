import Foundation
import Testing

@testable import SetwiseCore

struct LibraryTests {
  let track = MusicTrack(videoId: "abcdefghijk", title: "A song", artists: ["Daft Punk", "Guest"])

  @Test func inheritedMembershipKeepsOtherPathsAndDirectAssignments() throws {
    var journal = LibraryJournal()
    try journal.append(journal.snapshot.importChanges([track]))
    let artist = MusicTag.named("Daft Punk")
    let parent = MusicTag.named("Atmosphere")
    let middle = MusicTag.named("Electronic")
    try journal.append([
      .tag(parent), .tag(middle), .link(TagLink(parent: parent.id, child: middle.id), true),
      .link(TagLink(parent: middle.id, child: artist.id), true),
      .link(TagLink(parent: parent.id, child: artist.id), true),
      .assignment(Assignment(song: track.id, tag: parent.id), true),
    ])
    #expect(journal.snapshot.songs(in: parent.id).count == 1)
    try journal.append([.link(TagLink(parent: parent.id, child: artist.id), false)])
    #expect(journal.snapshot.songs(in: parent.id).count == 1)
    try journal.append([.link(TagLink(parent: parent.id, child: middle.id), false)])
    #expect(journal.snapshot.songs(in: parent.id).count == 1)
    try journal.append([.assignment(Assignment(song: track.id, tag: parent.id), false)])
    #expect(journal.snapshot.songs(in: parent.id).count == 0)
  }

  @Test func offlineMergeConvergesAndRejectsConcurrentCycles() throws {
    let a = MusicTag.named("A")
    let b = MusicTag.named("B")
    var original = LibraryJournal()
    try original.append([.tag(a), .tag(b)])
    var first = original
    var second = original
    second.device = UUID()
    try first.append([.link(TagLink(parent: a.id, child: b.id), true)])
    try second.append([.link(TagLink(parent: b.id, child: a.id), true)])
    try first.merge(second.events)
    try second.merge(first.events)
    #expect(first.events == second.events)
    #expect(first.snapshot.links == second.snapshot.links)
    #expect(first.snapshot.links.count == 1)
    #expect(first.snapshot.conflicts.count == 1)
    try first.merge(second.events)
    #expect(first.events.count == 3)
  }

  @Test func concurrentTagCreationKeepsAssignmentsAndRenamesDoNotResurrectDeletions() throws {
    let firstTag = MusicTag(id: "first", name: "Jazz")
    let secondTag = MusicTag(id: "second", name: "jazz")
    var journal = LibraryJournal()
    try journal.append([
      .song(track), .tag(firstTag), .tag(secondTag),
      .assignment(Assignment(song: track.id, tag: secondTag.id), true),
    ])
    #expect(journal.snapshot.tags.count == 1)
    #expect(journal.snapshot.songs(in: firstTag.id).count == 1)
    try journal.append([.pinTag(firstTag.id, true), .renameTag(firstTag.id, "Renamed")])
    #expect(journal.snapshot.sortedTags.first?.name == "Renamed")
    #expect(journal.snapshot.sortedTags.first?.pinned == true)
    try journal.append([
      .removeTag(firstTag.id), .renameTag(firstTag.id, "Stale rename"), .pinTag(firstTag.id, true),
    ])
    #expect(journal.snapshot.tags.count == 0)
    #expect(journal.snapshot.songs.count == 1)
    #expect(journal.snapshot.assignments.count == 0)
  }

  @Test func renamedArtistTagDoesNotBlockReusingItsOldName() throws {
    var journal = LibraryJournal()
    try journal.append(journal.snapshot.importChanges([track]))
    let artist = MusicTag.named("Daft Punk")
    try journal.append([.renameTag(artist.id, "Renamed")])
    let second = MusicTrack(videoId: "lmnopqrstuv", title: "Another", artists: ["Daft Punk"])
    try journal.append(journal.snapshot.importChanges([second]))
    let newTag = try #require(journal.snapshot.tags.values.first { $0.name == "Daft Punk" })
    #expect(newTag.id != artist.id)
    #expect(journal.snapshot.songs(in: newTag.id).map(\.id) == [second.id])
  }

  @Test func journalRoundTripAndWebMigrationPreserveArtistAndManualSources() throws {
    let data = Data(
      #"{"version":1,"songs":[{"id":1,"videoId":"abcdefghijk","title":"Song","artists":["Artist"]}],"tags":[{"id":2,"name":"Artist","pinned":true},{"id":3,"name":"Genre","pinned":false}],"assignments":[{"songId":1,"tagId":2,"origin":"artist"},{"songId":1,"tagId":3,"origin":"manual"}],"edges":[{"parentId":3,"childId":2}]}"#
        .utf8)
    let transfer = try JSONDecoder().decode(WebLibraryTransfer.self, from: data)
    var journal = LibraryJournal()
    try journal.append(transfer.changes(into: journal.snapshot))
    let restored = try JSONDecoder().decode(
      LibraryJournal.self, from: JSONEncoder().encode(journal))
    #expect(restored.events == journal.events)
    #expect(restored.snapshot.songs(in: MusicTag.named("Genre").id).count == 1)
    #expect(restored.snapshot.assignments.count == 2)
    #expect(restored.snapshot.sortedTags.first?.pinned == true)
  }
}

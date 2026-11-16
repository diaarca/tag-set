import CloudKit
import Foundation
import SetwiseCore

struct CloudExchange {
  var events: [LibraryEvent]
  var uploaded: Set<UUID>
  var token: Data
  var account: String
}

actor CloudLibrary {
  private let container: CKContainer
  private let zone = CKRecordZone.ID(
    zoneName: "SetwiseLibrary", ownerName: CKCurrentUserDefaultName)

  init(identifier: String) { container = CKContainer(identifier: identifier) }

  func exchange(pending: [LibraryEvent], tokenData: Data?, account: String?) async throws
    -> CloudExchange
  {
    guard try await container.accountStatus() == .available else {
      throw LibraryError.invalid("Sign in to iCloud to synchronize your library.")
    }
    let owner = try await container.userRecordID().recordName
    guard account == nil || account == owner else {
      throw LibraryError.invalid(
        "Your iCloud account changed. Sync is paused to avoid merging libraries from different accounts."
      )
    }
    let database = container.privateCloudDatabase
    _ = try await database.save(CKRecordZone(zoneID: zone))
    var uploaded: Set<UUID> = []
    for start in stride(from: 0, to: pending.count, by: 100) {
      let chunk = Array(pending[start..<min(start + 100, pending.count)])
      let records = try chunk.map { event -> CKRecord in
        let record = CKRecord(
          recordType: "LibraryEvent",
          recordID: CKRecord.ID(recordName: event.id.uuidString, zoneID: zone))
        record["payload"] = try JSONEncoder().encode(event) as CKRecordValue
        return record
      }
      let result = try await database.modifyRecords(
        saving: records, deleting: [], savePolicy: .allKeys, atomically: false)
      for record in records {
        guard let saved = result.saveResults[record.recordID] else {
          throw LibraryError.invalid("iCloud did not acknowledge a library change.")
        }
        _ = try saved.get()
      }
      uploaded.formUnion(chunk.map(\.id))
    }
    var token = try tokenData.flatMap {
      try NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: $0)
    }
    var events: [LibraryEvent] = []
    while true {
      let page:
        (
          modificationResultsByID: [CKRecord.ID: Result<
            CKDatabase.RecordZoneChange.Modification, Error
          >], deletions: [CKDatabase.RecordZoneChange.Deletion], changeToken: CKServerChangeToken,
          moreComing: Bool
        )
      do { page = try await database.recordZoneChanges(inZoneWith: zone, since: token) } catch let
        error as CKError where error.code == .changeTokenExpired && token != nil
      {
        token = nil
        events = []
        continue
      }
      guard page.deletions.isEmpty else {
        throw LibraryError.invalid(
          "The iCloud history was changed outside Setwise. Sync is paused; your local library remains intact."
        )
      }
      for result in page.modificationResultsByID.values {
        let record = try result.get().record
        guard record.recordType == "LibraryEvent", let data = record["payload"] as? Data else {
          throw LibraryError.invalid("An invalid library change was received from iCloud.")
        }
        let event = try JSONDecoder().decode(LibraryEvent.self, from: data)
        guard record.recordID.recordName == event.id.uuidString else {
          throw LibraryError.invalid("An iCloud library change has an invalid identifier.")
        }
        events.append(event)
      }
      token = page.changeToken
      if !page.moreComing { break }
    }
    guard let token else {
      throw LibraryError.invalid("iCloud did not return a synchronization token.")
    }
    return CloudExchange(
      events: events, uploaded: uploaded,
      token: try NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true),
      account: owner)
  }
}

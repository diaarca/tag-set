import Foundation

public struct MusicPlaylist: Sendable {
  public var title: String
  public var tracks: [MusicTrack]
  public var skipped: Int
}

public enum YouTubeLink {
  private static func components(_ value: String) throws -> URLComponents {
    guard let url = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
      ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.user == nil,
      url.password == nil, url.port == nil,
      ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].contains(
        url.host?.lowercased() ?? "")
    else { throw LibraryError.invalid("Enter a valid YouTube Music link.") }
    return url
  }
  public static func video(_ value: String) throws -> String {
    let url = try components(value)
    let id =
      url.host?.lowercased() == "youtu.be"
      ? url.path.split(separator: "/").first.map(String.init)
      : url.queryItems?.first { $0.name == "v" }?.value
    guard let id, id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else {
      throw LibraryError.invalid("This link does not identify a song.")
    }
    return id
  }
  public static func playlist(_ value: String) throws -> String {
    let url = try components(value)
    guard url.host?.lowercased() != "youtu.be", ["/playlist", "/watch"].contains(url.path),
      let id = url.queryItems?.first(where: { $0.name == "list" })?.value,
      id.range(of: "^[A-Za-z0-9_-]{10,200}$", options: .regularExpression) != nil
    else { throw LibraryError.invalid("This link does not identify a public playlist.") }
    return id
  }
}

public enum CatalogParser {
  public static func objects(named key: String, in value: Any) -> [[String: Any]] {
    if let dictionary = value as? [String: Any] {
      var result = dictionary[key].flatMap { $0 as? [String: Any] }.map { [$0] } ?? []
      for child in dictionary.values { result += objects(named: key, in: child) }
      return result
    }
    return (value as? [Any] ?? []).flatMap { objects(named: key, in: $0) }
  }
  private static func runs(_ value: Any?) -> [[String: Any]] {
    (value as? [String: Any])?["runs"] as? [[String: Any]] ?? []
  }
  public static func text(_ value: Any?) -> String {
    if let simple = (value as? [String: Any])?["simpleText"] as? String { return simple }
    return runs(value).compactMap { $0["text"] as? String }.joined()
  }
  private static func artistNames(_ values: [[String: Any]]) -> [String] {
    var names: [String] = []
    for run in values {
      let endpoint = run["navigationEndpoint"] as? [String: Any]
      let browse = endpoint?["browseEndpoint"] as? [String: Any]
      if let id = browse?["browseId"] as? String, id.hasPrefix("UC"),
        let name = run["text"] as? String, !name.isEmpty, !names.contains(name)
      {
        names.append(name)
      }
    }
    return names
  }
  public static func tracks(in value: Any, panel: Bool = false) -> [MusicTrack] {
    var seen = Set<String>()
    var result: [MusicTrack] = []
    for row in objects(
      named: panel ? "playlistPanelVideoRenderer" : "musicResponsiveListItemRenderer", in: value)
    {
      let columns = (row["flexColumns"] as? [[String: Any]] ?? []).compactMap {
        ($0["musicResponsiveListItemFlexColumnRenderer"] as? [String: Any])?["text"]
      }
      let title = text(panel ? row["title"] : columns.first)
      let navigation =
        ((runs(columns.first).first?["navigationEndpoint"] as? [String: Any])?["watchEndpoint"]
        as? [String: Any])?["videoId"] as? String
      let id =
        panel
        ? row["videoId"] as? String
        : (row["playlistItemData"] as? [String: Any])?["videoId"] as? String ?? navigation
      let artists = artistNames(
        panel
          ? runs(row["longBylineText"]) + runs(row["shortBylineText"])
          : columns.dropFirst().flatMap { runs($0) })
      guard let id, id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
        !title.isEmpty, !artists.isEmpty, seen.insert(id).inserted
      else { continue }
      result.append(MusicTrack(videoId: id, title: title, artists: artists))
    }
    return result
  }
  public static func continuation(in value: Any) -> String? {
    objects(named: "nextContinuationData", in: value).compactMap { $0["continuation"] as? String }
      .first
      ?? objects(named: "continuationCommand", in: value).compactMap { $0["token"] as? String }
      .first
  }
  static func playlistPage(in value: Any, playlistID: String) throws -> (
    tracks: [MusicTrack], skipped: Int, continuation: String?
  ) {
    let shelves =
      objects(named: "musicPlaylistShelfRenderer", in: value)
      + objects(named: "musicPlaylistShelfContinuation", in: value)
      + objects(named: "musicShelfContinuation", in: value)
    let appended = objects(named: "appendContinuationItemsAction", in: value).filter {
      $0["targetId"] == nil || $0["targetId"] as? String == playlistID
    }
    let containers = shelves + appended
    guard !containers.isEmpty else {
      throw LibraryError.invalid("The playlist page could not be read. No songs were imported.")
    }
    let rows = containers.flatMap { objects(named: "musicResponsiveListItemRenderer", in: $0) }
    let usable = rows.flatMap { tracks(in: ["musicResponsiveListItemRenderer": $0]) }
    // Only follow song-shelf tokens; section-list tokens load recommendations instead.
    return (
      usable, rows.count - usable.count,
      containers.compactMap { continuation(in: $0) }.first
    )
  }
  public static func playlistTitle(in value: Any, id: String) -> String {
    let header =
      objects(named: "musicResponsiveHeaderRenderer", in: value).first
      ?? objects(named: "musicDetailHeaderRenderer", in: value).first
    let title = text(header?["title"])
    if !title.isEmpty { return title }
    // Album playlists omit the header and carry their album title in track credits.
    guard id.hasPrefix("OLA") else { return "" }
    for row in objects(named: "musicResponsiveListItemRenderer", in: value) {
      for column in row["flexColumns"] as? [[String: Any]] ?? [] {
        let text = (column["musicResponsiveListItemFlexColumnRenderer"] as? [String: Any])?["text"]
        for run in runs(text) {
          let browse =
            (run["navigationEndpoint"] as? [String: Any])?["browseEndpoint"] as? [String: Any]
          if let id = browse?["browseId"] as? String, id.hasPrefix("MPRE"),
            let name = run["text"] as? String
          {
            return name
          }
        }
      }
    }
    return ""
  }
}

public actor MusicCatalog {
  private var clientVersion: String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyyMMdd"
    return "1.\(formatter.string(from: Date())).01.00"
  }
  private let session: URLSession
  public init() {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 25
    config.timeoutIntervalForResource = 45
    session = URLSession(configuration: config)
  }
  private func request(_ endpoint: String, body: [String: Any]) async throws -> [String: Any] {
    // Match ytmusicapi's public WEB_REMIX context without a browser consent session.
    let version = clientVersion
    let client: [String: Any] = [
      "clientName": "WEB_REMIX", "clientVersion": version, "hl": "en", "gl": "US",
    ]
    var payload = body
    payload["context"] = ["client": client]
    var request = URLRequest(
      url: URL(string: "https://music.youtube.com/youtubei/v1/\(endpoint)?prettyPrint=false")!)
    request.httpMethod = "POST"
    request.httpBody = try JSONSerialization.data(withJSONObject: payload)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("https://music.youtube.com", forHTTPHeaderField: "Origin")
    request.setValue("67", forHTTPHeaderField: "X-YouTube-Client-Name")
    request.setValue(version, forHTTPHeaderField: "X-YouTube-Client-Version")
    let (data, response) = try await session.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      json["error"] == nil
    else {
      throw LibraryError.invalid(
        "YouTube Music could not return this information. Check that the song or playlist is public."
      )
    }
    return json
  }
  public func search(_ query: String) async throws -> [MusicTrack] {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.count <= 200 else {
      throw LibraryError.invalid("Enter a search query of up to 200 characters.")
    }
    return CatalogParser.tracks(
      in: try await request(
        "search", body: ["query": trimmed, "params": "EgWKAQIIAWoMEA4QChADEAQQCRAF"]))
  }
  public func lookup(_ url: String) async throws -> MusicTrack {
    let id = try YouTubeLink.video(url)
    let response = try await request("next", body: ["videoId": id, "isAudioOnly": true])
    guard let track = CatalogParser.tracks(in: response, panel: true).first(where: { $0.id == id })
    else {
      throw LibraryError.invalid(
        "YouTube Music did not return this song's title and artist credits.")
    }
    return track
  }
  public func playlist(_ url: String) async throws -> MusicPlaylist {
    let id = try YouTubeLink.playlist(url)
    var page = try await request("browse", body: ["browseId": "VL\(id)"])
    let title = CatalogParser.playlistTitle(in: page, id: id)
    guard !title.isEmpty else {
      throw LibraryError.invalid("The playlist is unavailable or its title could not be read.")
    }
    var tracks: [MusicTrack] = []
    var skipped = 0
    var tokens = Set<String>()
    var seen = Set<String>()
    while true {
      let parsed = try CatalogParser.playlistPage(in: page, playlistID: id)
      skipped += parsed.skipped
      tracks += parsed.tracks.filter { seen.insert($0.id).inserted }
      guard let token = parsed.continuation else {
        break
      }
      guard tokens.insert(token).inserted else {
        throw LibraryError.invalid(
          "YouTube returned a repeating playlist page. No songs were imported.")
      }
      page = try await request("browse", body: ["continuation": token])
    }
    return MusicPlaylist(title: title, tracks: tracks, skipped: skipped)
  }
}

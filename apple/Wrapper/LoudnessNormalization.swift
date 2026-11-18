import Foundation

enum LoudnessNormalization {
  private struct Response: Decodable {
    struct VideoDetails: Decodable { let videoId: String }
    struct PlayerConfig: Decodable {
      struct AudioConfig: Decodable {
        let loudnessDb: Double?
        let trackAbsoluteLoudnessLkfs: Double?
        let loudnessTargetLkfs: Double?
      }
      let audioConfig: AudioConfig?
    }
    let videoDetails: VideoDetails?
    let playerConfig: PlayerConfig?
  }

  static func gain(from data: Data, videoID: String) -> Float? {
    guard let response = try? JSONDecoder().decode(Response.self, from: data),
      response.videoDetails?.videoId == videoID,
      let config = response.playerConfig?.audioConfig
    else { return nil }
    let db: Double
    if let value = config.loudnessDb {
      db = value
    } else if let absolute = config.trackAbsoluteLoudnessLkfs,
      let target = config.loudnessTargetLkfs, absolute.isFinite, target.isFinite
    {
      db = absolute - target
    } else {
      return nil
    }
    guard db.isFinite else { return nil }
    return Float(pow(10, -max(0, db) / 20))
  }

  static func load(videoID: String) async throws -> Float? {
    var request = URLRequest(
      url: URL(string: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false")!)
    request.httpMethod = "POST"
    request.httpShouldHandleCookies = false
    request.timeoutInterval = 8
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    // Match the iOS client in the pinned YouTubeKit dependency, without account credentials.
    request.setValue("5", forHTTPHeaderField: "X-YouTube-Client-Name")
    request.setValue("20.10.4", forHTTPHeaderField: "X-YouTube-Client-Version")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "videoId": videoID,
      "context": ["client": ["clientName": "IOS", "clientVersion": "20.10.4"]],
    ])
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 2 * 1024 * 1024
    else { return nil }
    return gain(from: data, videoID: videoID)
  }
}

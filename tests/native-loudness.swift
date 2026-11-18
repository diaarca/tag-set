import Foundation

@main
enum NativeLoudnessTests {
  static func main() {
    func gain(_ config: String, id: String = "EsAQYAeqxD4") -> Float? {
      let json = """
        {"videoDetails":{"videoId":"\(id)"},"playerConfig":{"audioConfig":\(config)}}
        """
      return LoudnessNormalization.gain(from: Data(json.utf8), videoID: "EsAQYAeqxD4")
    }
    let reduced = gain(#"{"loudnessDb":6}"#)!
    precondition(abs(reduced - 0.501187) < 0.000001)
    precondition(gain(#"{"loudnessDb":-6}"#) == 1)
    precondition(gain(#"{"loudnessDb":0}"#) == 1)
    // The iOS client supplies absolute/target loudness instead of loudnessDb.
    let ios = gain(#"{"trackAbsoluteLoudnessLkfs":-11.76,"loudnessTargetLkfs":-14}"#)!
    precondition(abs(ios - 0.772681) < 0.000001)
    precondition(gain(#"{"trackAbsoluteLoudnessLkfs":-20,"loudnessTargetLkfs":-14}"#) == 1)
    precondition(gain(#"{"loudnessDb":6}"#, id: "differentID") == nil)
    for config in [
      "null", "{}", #"{"loudnessDb":true}"#, #"{"loudnessDb":"6"}"#,
      #"{"trackAbsoluteLoudnessLkfs":-11.76}"#, #"{"loudnessDb":1e999}"#,
    ] {
      precondition(gain(config) == nil)
    }
    precondition(
      LoudnessNormalization.gain(from: Data("invalid".utf8), videoID: "EsAQYAeqxD4") == nil)
    print(
      "Passed: native loudness attenuation, iOS metadata, quiet tracks, and invalid/mismatched metadata."
    )
  }
}

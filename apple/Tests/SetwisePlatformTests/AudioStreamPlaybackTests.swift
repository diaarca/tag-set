import AVFoundation
import Testing

@testable import SetwisePlatform

struct AudioStreamPlaybackTests {
  @Test func streamDurationControlsBothPlaybackEndpointAndDisplayedTime() {
    let item = AudioStreamPlayback.item(
      url: URL(string: "https://example.test/audio.m4a?dur=283.376")!)
    #expect(abs(item.forwardPlaybackEndTime.seconds - 283.376) < 0.000001)
    #expect(abs(AudioStreamPlayback.duration(of: item) - 283.376) < 0.000001)
  }

  @Test(arguments: ["", "?dur=nan", "?dur=inf", "?dur=-1", "?dur=0", "?dur=invalid"])
  func invalidOrMissingStreamDurationLeavesNormalPlaybackUnbounded(query: String) {
    let item = AudioStreamPlayback.item(url: URL(string: "https://example.test/audio.m4a\(query)")!)
    #expect(!item.forwardPlaybackEndTime.isNumeric)
    #expect(AudioStreamPlayback.duration(of: item) == 0)
    #expect(AudioStreamPlayback.duration(of: nil) == 0)
  }
}

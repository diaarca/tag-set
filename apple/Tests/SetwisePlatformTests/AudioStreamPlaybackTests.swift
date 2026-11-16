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

@MainActor
struct AudioStreamResolverTests {
  @Test func cachesRecentStreamsButRefreshesRetriesAndExpiredURLs() async throws {
    var date = Date(timeIntervalSince1970: 2_000_000_000)
    var extractions = 0
    let resolver = AudioStreamResolver(now: { date }) { _ in
      extractions += 1
      return URL(string: "https://example.test/audio.m4a?generation=\(extractions)")!
    }
    let first = try await resolver.url(for: "song")
    #expect(try await resolver.url(for: "song") == first)
    #expect(extractions == 1)
    resolver.invalidate("song")
    #expect(try await resolver.url(for: "song") != first)
    #expect(extractions == 2)
    date.addTimeInterval(301)
    _ = try await resolver.url(for: "song")
    #expect(extractions == 3)
  }

  @Test func respectsYouTubeURLExpiryWithSafetyMargin() async throws {
    var date = Date(timeIntervalSince1970: 2_000_000_000)
    var extractions = 0
    let resolver = AudioStreamResolver(now: { date }) { _ in
      extractions += 1
      return URL(string: "https://example.test/audio.m4a?expire=2000000120")!
    }
    _ = try await resolver.url(for: "song")
    date.addTimeInterval(59)
    _ = try await resolver.url(for: "song")
    #expect(extractions == 1)
    date.addTimeInterval(2)
    _ = try await resolver.url(for: "song")
    #expect(extractions == 2)
  }

  @Test func foregroundReusesPreparationEvenWhenItsOriginalWaiterIsCancelled() async throws {
    var extractions = 0
    let resolver = AudioStreamResolver(extract: { _ in
      extractions += 1
      try await Task.sleep(for: .milliseconds(20))
      return URL(string: "https://example.test/audio.m4a")!
    })
    let preparation = Task { try await resolver.url(for: "song") }
    await Task.yield()
    let foreground = Task { try await resolver.url(for: "song") }
    preparation.cancel()
    let url = try await foreground.value
    #expect(url.host == "example.test")
    #expect(extractions == 1)
    let preparationResult = await preparation.result
    #expect(throws: CancellationError.self) { try preparationResult.get() }
  }

  @Test func failedPreparationIsRetriedWhenSongIsSelected() async throws {
    var extractions = 0
    let resolver = AudioStreamResolver(extract: { _ in
      extractions += 1
      if extractions == 1 { throw URLError(.notConnectedToInternet) }
      return URL(string: "https://example.test/audio.m4a")!
    })
    do {
      _ = try await resolver.url(for: "song")
      Issue.record("Expected extraction to fail")
    } catch { #expect(error is URLError) }
    _ = try await resolver.url(for: "song")
    #expect(extractions == 2)
  }
}

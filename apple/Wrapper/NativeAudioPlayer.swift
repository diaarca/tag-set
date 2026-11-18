import AVFoundation
import JavaScriptCore
import MediaPlayer
import UIKit
import YouTubeKit

@MainActor
final class NativeAudioPlayer: NSObject {
  private let context: JSContext
  private let reducer: JSValue
  private let validator: JSValue
  private var state: JSValue
  private var queue: [String: Any]
  private let player = AVPlayer()
  private let publish: ([String: Any]) -> Void
  private var loadTask: Task<Void, Never>?
  private var prefetchTask: Task<Void, Never>?
  private var artworkTask: Task<Void, Never>?
  private var normalizationTask: Task<Void, Never>?
  private var normalizationEnabled = false
  private var normalizedSong: (id: String, gain: Float)?
  private var manifests: [String: (url: URL, date: Date)] = [:]
  private var generation = UUID()
  private var loading = false
  private var ended = false
  private var resumeAfterInterruption = false
  private var timeObserver: Any?
  private var itemObserver: NSKeyValueObservation?
  private var artwork: MPMediaItemArtwork?
  private var remoteTargets: [(MPRemoteCommand, Any)] = []

  init(publish: @escaping ([String: Any]) -> Void) throws {
    // Run the shared queue reducer even while iOS suspends the web interface.
    guard
      let url = Bundle.main.url(forResource: "queue", withExtension: "js", subdirectory: "bundle"),
      let context = JSContext()
    else { throw Self.failure("Build the wrapper web interface before opening this app.") }
    context.setObject([:] as NSDictionary, forKeyedSubscript: "exports" as NSString)
    context.evaluateScript(try String(contentsOf: url, encoding: .utf8))
    guard context.exception == nil,
      let exports = context.objectForKeyedSubscript("exports"),
      let reducer = exports.forProperty("queueReducer"),
      let validator = exports.forProperty("validateQueueAction"),
      let state = exports.forProperty("emptyQueue"),
      let queue = state.toDictionary() as? [String: Any]
    else { throw Self.failure("The native playback queue could not be initialized.") }
    self.context = context
    self.reducer = reducer
    self.validator = validator
    self.state = state
    self.queue = queue
    self.publish = publish
    super.init()
    player.audiovisualBackgroundPlaybackPolicy = .continuesIfPossible
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 1, preferredTimescale: 600), queue: .main
    ) { [weak self] _ in Task { @MainActor in self?.publishPlayback() } }
    NotificationCenter.default.addObserver(
      self, selector: #selector(itemEnded(_:)), name: .AVPlayerItemDidPlayToEndTime, object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification,
      object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification,
      object: nil)
    let commands = MPRemoteCommandCenter.shared()
    commands.skipForwardCommand.isEnabled = false
    commands.skipBackwardCommand.isEnabled = false
    for (command, action) in [
      (commands.playCommand, "play"), (commands.pauseCommand, "pause"),
      (commands.togglePlayPauseCommand, "toggle"), (commands.nextTrackCommand, "next"),
      (commands.previousTrackCommand, "previous"),
    ] {
      let target = command.addTarget { [weak self] _ in
        Task { @MainActor in self?.command(action) }
        return .success
      }
      remoteTargets.append((command, target))
    }
    let seekTarget = commands.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else {
        return .commandFailed
      }
      Task { @MainActor in self?.seek(event.positionTime) }
      return .success
    }
    remoteTargets.append((commands.changePlaybackPositionCommand, seekTarget))
  }

  deinit {
    if let timeObserver { player.removeTimeObserver(timeObserver) }
    for (command, target) in remoteTargets { command.removeTarget(target) }
    loadTask?.cancel()
    prefetchTask?.cancel()
    artworkTask?.cancel()
    normalizationTask?.cancel()
  }

  private var song: [String: Any]? {
    let songs = queue["songs"] as? [[String: Any]] ?? []
    let index = queue["index"] as? Int ?? 0
    return songs.indices.contains(index) ? songs[index] : nil
  }
  private var key: String? {
    song.map { "\($0["id"] ?? 0):\(queue["revision"] ?? 0)" }
  }
  private var playing: Bool { queue["playing"] as? Bool ?? false }

  func dispatch(_ action: [String: Any]) {
    let previous = key
    let wasPlaying = playing
    do { try reduce(action) } catch {
      publish(["error": "Invalid queue command."])
      return
    }
    resumeAfterInterruption = false
    publish(["type": "native-queue", "queue": queue])
    if key != previous {
      loadCurrent()
    } else if playing != wasPlaying {
      if playing { play() } else { player.pause() }
    }
    if ["shuffle", "repeat", "remove"].contains(action["type"] as? String ?? "") {
      prefetchNext()
    }
    publishPlayback()
  }

  func command(_ type: String) {
    switch type {
    case "play", "pause":
      let value = type == "play"
      if value != playing { dispatch(["type": "toggle"]) } else if value { play() }
    case "next", "previous", "toggle": dispatch(["type": type])
    default: break
    }
  }

  func seek(_ seconds: Double) {
    guard seconds.isFinite, seconds >= 0, seconds <= 604800, player.currentItem != nil else {
      return
    }
    let duration = player.currentItem?.duration.seconds ?? 0
    let target = duration.isFinite && duration > 0 ? min(seconds, duration) : seconds
    ended = false
    player.seek(to: CMTime(seconds: target, preferredTimescale: 600))
  }

  func synchronize() {
    publish(["type": "native-queue", "queue": queue])
    publishPlayback()
  }

  func setNormalization(_ enabled: Bool) {
    normalizationEnabled = enabled
    updateNormalization()
  }

  private func updateNormalization() {
    normalizationTask?.cancel()
    player.volume = 1
    guard normalizationEnabled, let id = song?["videoId"] as? String else { return }
    if let cached = normalizedSong, cached.id == id {
      player.volume = cached.gain
      return
    }
    let generation = generation
    normalizationTask = Task { @MainActor [weak self] in
      do {
        let gain = try await LoudnessNormalization.load(videoID: id)
        guard let self, !Task.isCancelled, self.generation == generation,
          self.normalizationEnabled, let gain
        else { return }
        self.normalizedSong = (id, gain)
        self.player.volume = gain
      } catch {
        // Missing metadata or a failed lookup leaves playback at its usual volume.
      }
    }
  }

  private func reduce(_ action: [String: Any]) throws {
    context.exception = nil
    guard let validated = validator.call(withArguments: [action]), context.exception == nil,
      let next = reducer.call(withArguments: [state, validated]), context.exception == nil,
      let value = next.toDictionary() as? [String: Any]
    else { throw Self.failure("Invalid queue command.") }
    state = next
    queue = value
  }

  private func loadCurrent() {
    loadTask?.cancel()
    prefetchTask?.cancel()
    artworkTask?.cancel()
    generation = UUID()
    let generation = generation
    player.pause()
    player.replaceCurrentItem(with: nil)
    updateNormalization()
    itemObserver = nil
    ended = false
    artwork = nil
    guard let id = song?["videoId"] as? String else {
      loading = false
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      return
    }
    loading = true
    loadTask = Task { @MainActor [weak self] in
      guard let self else { return }
      let backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Load song") {
        [weak self] in
        Task { @MainActor in
          guard let self, self.generation == generation else { return }
          self.loadTask?.cancel()
          self.fail("The song could not be loaded in the background. Open TagSet to retry.")
        }
      }
      defer {
        if backgroundTask != .invalid { UIApplication.shared.endBackgroundTask(backgroundTask) }
      }
      do {
        let url = try await self.manifest(for: id)
        let asset = AVURLAsset(url: url)
        guard try await asset.load(.isPlayable) else {
          throw Self.failure("This song has no playable HLS stream. Retry or choose another song.")
        }
        try Task.checkCancellation()
        guard self.generation == generation else { return }
        let item = AVPlayerItem(asset: asset)
        self.itemObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
          Task { @MainActor in
            guard let self, self.player.currentItem === item else { return }
            if item.status == .failed {
              self.manifests.removeValue(forKey: id)
              self.fail("This song could not be played. Retry or choose another song.")
            }
            self.publishPlayback()
          }
        }
        self.player.replaceCurrentItem(with: item)
        self.loading = false
        if self.playing { self.play() }
        self.publishPlayback()
        self.prefetchNext()
        self.artworkTask = Task { @MainActor [weak self] in
          await self?.loadArtwork(id: id, generation: generation)
        }
      } catch {
        guard !Task.isCancelled, self.generation == generation else { return }
        self.manifests.removeValue(forKey: id)
        self.fail(
          (error as NSError).domain == "TagSetAudio"
            ? error.localizedDescription
            : "This song could not be loaded. Retry or choose another song.")
      }
    }
  }

  private func manifest(for id: String) async throws -> URL {
    if let cached = manifests[id], Date().timeIntervalSince(cached.date) < 1800 {
      return cached.url
    }
    // Direct audio files can report doubled durations in AVFoundation; use HLS only.
    let streams = try await YouTube(videoID: id, methods: [.local]).livestreams
    guard let url = streams.first?.url, url.scheme == "https",
      url.user == nil, url.password == nil, url.port == nil,
      let host = url.host, host == "googlevideo.com" || host.hasSuffix(".googlevideo.com")
    else {
      throw Self.failure("This song has no playable HLS stream. Retry or choose another song.")
    }
    try Task.checkCancellation()
    manifests[id] = (url, Date())
    return url
  }

  private func prefetchNext() {
    prefetchTask?.cancel()
    guard !loading, song != nil else { return }
    context.exception = nil
    guard let next = reducer.call(withArguments: [state, ["type": "ended"]]),
      context.exception == nil, next.forProperty("playing")?.toBool() == true,
      let songs = next.forProperty("songs")?.toArray() as? [[String: Any]],
      let index = next.forProperty("index")?.toInt32(), songs.indices.contains(Int(index)),
      let id = songs[Int(index)]["videoId"] as? String
    else { return }
    let current = song?["videoId"] as? String
    manifests = manifests.filter { $0.key == current || $0.key == id }
    prefetchTask = Task { @MainActor [weak self] in
      do { _ = try await self?.manifest(for: id) } catch {
        // A failed prefetch is retried when the song is selected.
      }
    }
  }

  private func play() {
    guard !loading, player.currentItem != nil else { return }
    do {
      try AVAudioSession.sharedInstance().setCategory(
        .playback, mode: .default, policy: .longFormAudio)
      try AVAudioSession.sharedInstance().setActive(true)
      if ended {
        player.seek(to: .zero)
        ended = false
      }
      player.play()
    } catch { fail("The audio session could not be activated. Retry the song.") }
  }

  private func fail(_ message: String) {
    loading = false
    player.pause()
    do { try reduce(["type": "fail", "message": message]) } catch {
      publish(["error": "The native playback queue could not be updated."])
    }
    synchronize()
  }

  @objc private func itemEnded(_ notification: Notification) {
    guard let item = notification.object as? AVPlayerItem, player.currentItem === item else {
      return
    }
    ended = true
    dispatch(["type": "ended"])
  }

  @objc private func interrupted(_ notification: Notification) {
    guard let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else {
      return
    }
    if type == AVAudioSession.InterruptionType.began.rawValue {
      let shouldResume = playing
      command("pause")
      resumeAfterInterruption = shouldResume
    } else {
      let options = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
      let shouldResume =
        resumeAfterInterruption
        && AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume)
      resumeAfterInterruption = false
      if shouldResume { command("play") }
    }
  }

  @objc private func routeChanged(_ notification: Notification) {
    if notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
      == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
    {
      command("pause")
    }
  }

  private func publishPlayback() {
    let position = player.currentTime().seconds
    let duration = player.currentItem?.duration.seconds ?? 0
    let id = song?["videoId"] as? String
    let title = song?["title"] as? String ?? ""
    let artists = song?["artists"] as? [String] ?? []
    if id != nil {
      var info: [String: Any] = [
        MPMediaItemPropertyTitle: title,
        MPMediaItemPropertyArtist: artists.joined(separator: " · "),
        MPNowPlayingInfoPropertyElapsedPlaybackTime: position.isFinite ? position : 0,
        MPMediaItemPropertyPlaybackDuration: duration.isFinite ? duration : 0,
        MPNowPlayingInfoPropertyPlaybackRate: player.rate,
      ]
      if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
      MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
    let commands = MPRemoteCommandCenter.shared()
    for command in [
      commands.playCommand, commands.pauseCommand, commands.togglePlayPauseCommand,
      commands.nextTrackCommand, commands.previousTrackCommand,
    ] { command.isEnabled = id != nil }
    commands.changePlaybackPositionCommand.isEnabled =
      id != nil && duration.isFinite && duration > 0
    publish([
      "type": "playback", "videoId": id as Any? ?? NSNull(), "loadToken": NSNull(),
      "paused": !playing, "advertisement": false, "title": title,
      "loading": loading || (playing && player.currentItem?.status != .readyToPlay),
      "position": position.isFinite ? position : 0, "duration": duration.isFinite ? duration : 0,
    ])
  }

  private func loadArtwork(id: String, generation: UUID) async {
    guard let url = URL(string: "https://i.ytimg.com/vi/\(id)/hqdefault.jpg") else { return }
    do {
      let (data, response) = try await URLSession.shared.data(from: url)
      guard !Task.isCancelled, self.generation == generation,
        (response as? HTTPURLResponse)?.statusCode == 200,
        data.count <= 2 * 1024 * 1024, let image = UIImage(data: data)
      else { return }
      artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
      publishPlayback()
    } catch {
      // Artwork is optional; audio playback does not depend on it.
    }
  }

  private static func failure(_ message: String) -> NSError {
    NSError(domain: "TagSetAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}

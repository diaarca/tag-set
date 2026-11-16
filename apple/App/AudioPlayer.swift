import AVFoundation
import Combine
import MediaPlayer
import SetwiseCore
import YouTubeKit

#if os(iOS)
  import UIKit
#endif

enum AudioStreamPlayback {
  static func item(url: URL) -> AVPlayerItem {
    let item = AVPlayerItem(url: url)
    if let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
      .first(where: { $0.name == "dur" })?.value,
      let seconds = Double(value), seconds.isFinite, seconds > 0
    {
      // YouTube's m4a container can report twice the actual audio duration to AVFoundation.
      item.forwardPlaybackEndTime = CMTime(seconds: seconds, preferredTimescale: 1_000_000)
    }
    return item
  }

  static func duration(of item: AVPlayerItem?) -> Double {
    guard let item else { return 0 }
    let endpoint = item.forwardPlaybackEndTime.seconds
    let seconds = endpoint.isFinite && endpoint > 0 ? endpoint : item.duration.seconds
    return seconds.isFinite && seconds > 0 ? seconds : 0
  }
}

@MainActor
final class AudioStreamResolver {
  private struct Entry {
    let url: URL
    let validUntil: Date
  }
  private var cache: [String: Entry] = [:]
  private var pending: (id: String, token: UUID, task: Task<URL, Error>)?
  private let now: () -> Date
  private let extract: (String) async throws -> URL

  init(now: @escaping () -> Date = Date.init, extract: ((String) async throws -> URL)? = nil) {
    self.now = now
    self.extract =
      extract ?? { id in
        let streams = try await YouTube(videoID: id, methods: [.local]).streams
        guard
          let stream = streams.filterAudioOnly().filter({
            $0.fileExtension == .m4a && $0.isNativelyPlayable
          }).highestAudioBitrateStream()
        else {
          throw LibraryError.invalid("No compatible audio stream is available for this song.")
        }
        try await stream.waitUntilAvailable()
        try Task.checkCancellation()
        return stream.url
      }
  }

  func url(for id: String) async throws -> URL {
    try Task.checkCancellation()
    let date = now()
    cache = cache.filter { $0.value.validUntil > date }
    if let entry = cache[id] { return entry.url }
    let request: (id: String, token: UUID, task: Task<URL, Error>)
    if let pending, pending.id == id {
      request = pending
    } else {
      cancel()
      request = (id, UUID(), Task { try await extract(id) })
      pending = request
    }
    do {
      let url = try await request.task.value
      if pending?.token == request.token {
        let expiry = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
          .first(where: { $0.name == "expire" })?.value.flatMap(Double.init)
        let validUntil = min(
          now().addingTimeInterval(300),
          expiry.flatMap { $0.isFinite ? Date(timeIntervalSince1970: $0 - 60) : nil }
            ?? now().addingTimeInterval(300))
        if cache.count >= 8,
          let oldest = cache.min(by: { $0.value.validUntil < $1.value.validUntil })
        {
          cache.removeValue(forKey: oldest.key)
        }
        cache[id] = Entry(url: url, validUntil: validUntil)
        pending = nil
      }
      try Task.checkCancellation()
      return url
    } catch {
      if pending?.token == request.token { pending = nil }
      throw error
    }
  }

  func invalidate(_ id: String) {
    cache.removeValue(forKey: id)
    if pending?.id == id { cancel() }
  }

  func cancel() {
    pending?.task.cancel()
    pending = nil
  }
}

@MainActor
final class AudioPlayer: ObservableObject {
  enum RepeatMode: String, CaseIterable { case off, all, one }
  @Published private(set) var queue: [SetwiseCore.MusicTrack] = []
  @Published private(set) var index = 0
  @Published private(set) var playing = false
  @Published private(set) var loading = false
  @Published private(set) var position = 0.0
  @Published private(set) var duration = 0.0
  @Published var error: String?
  @Published var shuffle = false {
    didSet {
      guard let song = current else { return }
      if shuffle {
        queue = [song] + queue.filter { $0.id != song.id }.shuffled()
      } else {
        queue.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
      }
      index = queue.firstIndex { $0.id == song.id } ?? 0
      resetPrefetch()
    }
  }
  @Published var repeatMode = RepeatMode.off { didSet { resetPrefetch() } }
  @Published var volume: Float = 0.7 { didSet { player.volume = volume } }
  var current: SetwiseCore.MusicTrack? { queue.indices.contains(index) ? queue[index] : nil }
  private let player = AVPlayer()
  private let resolver = AudioStreamResolver()
  private var prefetchTask: Task<URL, Error>?
  private var prefetchedID: String?
  private var task: Task<Void, Never>?
  private var generation = UUID()
  private var failed = Set<String>()
  private var timeObserver: Any?
  private var statusObserver: NSKeyValueObservation?
  private var transportObserver: NSKeyValueObservation?
  private var notifications: [NSObjectProtocol] = []
  private var interrupted = false
  #if os(iOS)
    private var preparationTask: UIBackgroundTaskIdentifier = .invalid
  #endif

  init() {
    player.volume = volume
    transportObserver = player.observe(\.timeControlStatus, options: [.new]) {
      [weak self] player, _ in
      Task { @MainActor in
        self?.playing = player.timeControlStatus == .playing
        if self?.playing == true { self?.endPreparation() }
        self?.publishNowPlaying()
      }
    }
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
    ) { [weak self] time in
      Task { @MainActor in
        guard let self else { return }
        self.position = time.seconds.isFinite ? time.seconds : 0
        self.duration = AudioStreamPlayback.duration(of: self.player.currentItem)
        self.prepareNextIfNeeded()
        self.publishNowPlaying()
      }
    }
    notifications.append(
      NotificationCenter.default.addObserver(
        forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main
      ) { [weak self] note in
        Task { @MainActor in
          guard let self, let item = note.object as? AVPlayerItem, item === self.player.currentItem
          else { return }
          self.advance(ended: true)
        }
      })
    #if os(iOS)
      notifications.append(
        NotificationCenter.default.addObserver(
          forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
          let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
          let options = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
          Task { @MainActor in
            guard let self else { return }
            if type == AVAudioSession.InterruptionType.began.rawValue {
              self.interrupted = self.playing
              self.player.pause()
            } else if self.interrupted
              && AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume)
            {
              self.resume()
            }
          }
        })
      notifications.append(
        NotificationCenter.default.addObserver(
          forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] note in
          if note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
          {
            Task { @MainActor in self?.pause() }
          }
        })
    #endif
    let commands = MPRemoteCommandCenter.shared()
    commands.playCommand.addTarget { [weak self] _ in
      Task { @MainActor in self?.resume() }
      return .success
    }
    commands.pauseCommand.addTarget { [weak self] _ in
      Task { @MainActor in self?.pause() }
      return .success
    }
    commands.nextTrackCommand.addTarget { [weak self] _ in
      Task { @MainActor in self?.advance() }
      return .success
    }
    commands.previousTrackCommand.addTarget { [weak self] _ in
      Task { @MainActor in self?.previous() }
      return .success
    }
    commands.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else {
        return .commandFailed
      }
      Task { @MainActor in self?.seek(event.positionTime) }
      return .success
    }
  }

  func start(_ tracks: [SetwiseCore.MusicTrack]) {
    queue = shuffle ? tracks.shuffled() : tracks
    index = 0
    failed = []
    resolveCurrent()
  }
  func remove(_ id: String) {
    resetPrefetch()
    let old = current?.id
    let shouldPlay = playing || loading
    queue.removeAll { $0.id == id }
    failed.remove(id)
    if let old, old != id, let newIndex = queue.firstIndex(where: { $0.id == old }) {
      index = newIndex
    } else {
      index = min(index, max(0, queue.count - 1))
      if shouldPlay {
        resolveCurrent()
      } else {
        pause()
        generation = UUID()
        player.replaceCurrentItem(with: nil)
        statusObserver = nil
        position = 0
        duration = 0
        error = nil
        if current == nil {
          MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        } else {
          publishNowPlaying()
        }
      }
    }
  }
  func retry() {
    if let id = current?.id {
      failed.remove(id)
      resolver.invalidate(id)
    }
    resolveCurrent()
  }
  func pause() {
    task?.cancel()
    resetPrefetch()
    resolver.cancel()
    endPreparation()
    if loading && player.currentItem == nil { generation = UUID() }
    loading = false
    player.pause()
    #if os(iOS)
      do {
        try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      } catch { self.error = error.localizedDescription }
    #endif
  }
  func resume() {
    guard current != nil else { return }
    if player.currentItem == nil || player.currentItem?.status == .failed || error != nil {
      retry()
      return
    }
    do {
      try activateSession()
      player.play()
    } catch { self.error = error.localizedDescription }
  }
  func toggle() { if playing || loading { pause() } else { resume() } }
  func seek(_ value: Double) {
    guard value.isFinite else { return }
    let target = max(0, duration > 0 ? min(value, duration) : value)
    player.seek(to: CMTime(seconds: target, preferredTimescale: 600))
    position = target
  }
  func previous() {
    if position > 3 || index == 0 {
      seek(0)
      resume()
    } else {
      index -= 1
      resolveCurrent()
    }
  }
  func advance(ended: Bool = false) {
    guard !queue.isEmpty else { return }
    if ended && repeatMode == .one {
      resolveCurrent()
      return
    }
    for step in 1...queue.count {
      let candidate = index + step
      if candidate >= queue.count && repeatMode != .all { break }
      let next = candidate % queue.count
      if !failed.contains(queue[next].id) {
        index = next
        resolveCurrent()
        return
      }
    }
    pause()
    if !failed.isEmpty {
      error = "No more playable songs. Retry a song or choose another collection."
    }
  }
  private func activateSession() throws {
    #if os(iOS)
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .default)
      try session.setActive(true)
    #endif
  }
  private func resolveCurrent() {
    task?.cancel()
    resetPrefetch()
    endPreparation()
    player.pause()
    player.replaceCurrentItem(with: nil)
    statusObserver = nil
    position = 0
    duration = 0
    error = nil
    generation = UUID()
    guard let song = current else {
      resolver.cancel()
      loading = false
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      return
    }
    let request = generation
    loading = true
    beginPreparation(for: request)
    task = Task { [self] in
      do {
        let url = try await resolver.url(for: song.videoId)
        try Task.checkCancellation()
        guard request == generation else { return }
        try activateSession()
        let item = AudioStreamPlayback.item(url: url)
        duration = AudioStreamPlayback.duration(of: item)
        statusObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
          Task { @MainActor in
            guard let self, request == self.generation else { return }
            if item.status == .failed {
              self.resolver.invalidate(song.videoId)
              self.loading = false
              self.failed.insert(song.id)
              self.error = "This song could not be played. Retry or skip it."
              self.endPreparation()
            }
            if item.status == .readyToPlay { self.loading = false }
          }
        }
        player.replaceCurrentItem(with: item)
        player.play()
        publishNowPlaying()
      } catch is CancellationError {
        if request == generation {
          loading = false
          endPreparation()
        }
      } catch {
        if request == generation {
          loading = false
          failed.insert(song.id)
          self.error = "Audio extraction failed: \(error.localizedDescription)"
          endPreparation()
        }
      }
    }
  }
  private func resetPrefetch() {
    prefetchTask?.cancel()
    prefetchTask = nil
    prefetchedID = nil
  }

  private func prepareNextIfNeeded() {
    guard playing, !loading, duration > 0, duration - position <= 30,
      repeatMode != .one, !queue.isEmpty
    else { return }
    for step in 1...queue.count {
      let candidate = index + step
      if candidate >= queue.count && repeatMode != .all { return }
      let song = queue[candidate % queue.count]
      guard !failed.contains(song.id) else { continue }
      guard prefetchedID != song.videoId else { return }
      resetPrefetch()
      prefetchedID = song.videoId
      // Prepare only the URL. Foreground playback retries a failed speculative extraction.
      prefetchTask = Task { try await resolver.url(for: song.videoId) }
      return
    }
  }
  private func beginPreparation(for request: UUID) {
    #if os(iOS)
      preparationTask = UIApplication.shared.beginBackgroundTask(withName: "Prepare next song") {
        [weak self] in
        Task { @MainActor in
          guard let self, self.generation == request else { return }
          if let song = self.current { self.failed.insert(song.id) }
          self.pause()
          self.error =
            "Preparing audio exceeded the background time available. Open the app and retry."
        }
      }
    #endif
  }
  private func endPreparation() {
    #if os(iOS)
      guard preparationTask != .invalid else { return }
      let identifier = preparationTask
      preparationTask = .invalid
      UIApplication.shared.endBackgroundTask(identifier)
    #endif
  }
  private func publishNowPlaying() {
    guard let song = current else { return }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: song.title,
      MPMediaItemPropertyArtist: song.artists.joined(separator: ", "),
      MPMediaItemPropertyPlaybackDuration: duration,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
      MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
    ]
  }
}

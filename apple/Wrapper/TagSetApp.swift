import AVFoundation
import CoreFoundation
import SwiftUI
import WebKit

@main
struct TagSetApp: App {
  var body: some Scene { WindowGroup { WrapperView().preferredColorScheme(.dark) } }
}

private struct WrapperView: UIViewControllerRepresentable {
  func makeUIViewController(context: Context) -> WrapperController { WrapperController() }
  func updateUIViewController(_ controller: WrapperController, context: Context) {}
}

private final class ScriptHandler: NSObject, WKScriptMessageHandler {
  var receive: ((WKScriptMessage) -> Void)?
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) { receive?(message) }
}

private final class WrapperController: UIViewController, WKNavigationDelegate, WKUIDelegate,
  UIAdaptivePresentationControllerDelegate
{
  private let controls = WKWebView()
  private let music: WKWebView = {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.allowsInlineMediaPlayback = true
    config.allowsAirPlayForMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    return WKWebView(frame: .zero, configuration: config)
  }()
  private let musicContainer = UIView()
  private let handler = ScriptHandler()
  private var controlsURL: URL?
  private var bridge = ""
  private var musicRect: CGRect?
  private var popups: [WKWebView: UIViewController] = [:]
  private static let maxLibraryBytes = 8 * 1024 * 1024
  private static let hosts: Set<String> = [
    "music.youtube.com", "www.youtube.com", "accounts.google.com", "accounts.youtube.com",
    "www.google.com", "consent.google.com", "consent.youtube.com",
  ]

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    handler.receive = { [weak self] in self?.receive($0) }
    controls.configuration.userContentController.add(handler, name: "wrapperCommand")
    music.configuration.userContentController.add(handler, name: "wrapperPlayback")
    for browser in [controls, music] {
      browser.navigationDelegate = self
      browser.uiDelegate = self
    }
    musicContainer.clipsToBounds = true
    musicContainer.addSubview(music)
    view.addSubview(musicContainer)
    controls.isOpaque = true
    controls.backgroundColor = .black
    view.addSubview(controls)
    do {
      guard let folder = Bundle.main.url(forResource: "bundle", withExtension: nil),
        let script = Bundle.main.url(forResource: "player-bridge", withExtension: "js")
      else { throw failure("Build the wrapper web interface before opening this app.") }
      bridge = try String(contentsOf: script, encoding: .utf8)
      let index = folder.appendingPathComponent("index.html")
      controlsURL = index
      controls.loadFileURL(index, allowingReadAccessTo: folder)
      try AVAudioSession.sharedInstance().setCategory(.playback)
      configureBridge(token: nil)
      music.load(URLRequest(url: URL(string: "https://music.youtube.com/")!))
    } catch { showStartupError(error.localizedDescription) }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    controls.frame = view.safeAreaLayoutGuide.layoutFrame
    layoutMusic()
  }

  private func layoutMusic() {
    guard let rect = musicRect else {
      musicContainer.frame = controls.frame
      music.frame = CGRect(x: 0, y: 0, width: controls.bounds.width, height: 600)
      music.isUserInteractionEnabled = false
      music.accessibilityElementsHidden = true
      view.sendSubviewToBack(musicContainer)
      return
    }
    let full = rect.offsetBy(dx: controls.frame.minX, dy: controls.frame.minY)
    let clipped = full.intersection(controls.frame)
    guard !clipped.isNull, clipped.width > 0, clipped.height > 0 else {
      music.isUserInteractionEnabled = false
      music.accessibilityElementsHidden = true
      view.sendSubviewToBack(musicContainer)
      return
    }
    musicContainer.frame = clipped
    music.frame = CGRect(
      origin: CGPoint(x: full.minX - clipped.minX, y: full.minY - clipped.minY), size: full.size)
    music.isUserInteractionEnabled = true
    music.accessibilityElementsHidden = false
    view.bringSubviewToFront(musicContainer)
  }

  private func configureBridge(token: String?) {
    let encoded = token.map { "\"\($0)\"" } ?? "null"
    music.configuration.userContentController.removeAllUserScripts()
    music.configuration.userContentController.addUserScript(
      WKUserScript(
        source: "window.__tagsetLoadToken = \(encoded); \(bridge)", injectionTime: .atDocumentEnd,
        forMainFrameOnly: true))
  }

  private func receive(_ message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any] else { return }
    if message.name == "wrapperPlayback", message.webView === music,
      message.frameInfo.request.url?.host == "music.youtube.com"
    {
      publish(body)
      return
    }
    guard message.name == "wrapperCommand", message.webView === controls,
      message.frameInfo.request.url == controlsURL, let type = body["type"] as? String
    else { return }
    if type == "request", let requestID = body["requestId"] as? String, requestID.count <= 100,
      let operation = body["operation"] as? String
    {
      Task { @MainActor in
        do {
          publish([
            "type": "response", "requestId": requestID,
            "result": try await request(operation, payload: body["payload"]) ?? NSNull(),
          ])
        } catch {
          publish(["type": "response", "requestId": requestID, "error": error.localizedDescription])
        }
      }
      return
    }
    if type == "layout" {
      guard let visible = body["visible"] as? Bool,
        let x = number(body["x"]), let y = number(body["y"]),
        let width = number(body["width"]), let height = number(body["height"]),
        width >= 0, height >= 0
      else { return }
      musicRect = visible ? CGRect(x: x, y: y, width: width, height: height) : nil
      layoutMusic()
      return
    }
    if type == "load", let id = body["videoId"] as? String,
      id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil
    {
      let token = body["token"] as? String
      guard
        token == nil
          || token!.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil
      else { return }
      configureBridge(token: token)
      music.load(URLRequest(url: URL(string: "https://music.youtube.com/watch?v=\(id)")!))
      return
    }
    guard music.url?.host == "music.youtube.com" else {
      report("Return to YouTube Music before controlling playback.")
      return
    }
    var value: Double?
    switch type {
    case "play", "pause": break
    case "seek":
      guard let position = number(body["value"]), position >= 0, position <= 604800 else { return }
      value = position
    case "volume": return
    default: return
    }
    let script = """
      if (!window.__tagsetControl) {
        if (command === 'pause') return true;
        throw new Error('YouTube Music is still loading. Open YouTube Music if playback needs a prompt.');
      }
      return await window.__tagsetControl(command, value);
      """
    Task { @MainActor in
      do {
        _ = try await music.callAsyncJavaScript(
          script, arguments: ["command": type, "value": value as Any? ?? NSNull()], in: nil,
          contentWorld: .page)
      } catch { report(error.localizedDescription) }
    }
  }

  private func number(_ value: Any?) -> Double? {
    guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() else {
      return nil
    }
    let result = value.doubleValue
    guard result.isFinite, abs(result) <= 1_000_000 else { return nil }
    return result
  }
  private func failure(_ message: String) -> NSError {
    NSError(domain: "TagSet", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  private func libraryURL() throws -> URL {
    try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
    )
    .appendingPathComponent("SetwiseWrapper/library.json")
  }
  private func readLibrary() throws -> String? {
    let url = try libraryURL()
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard ((attributes[.size] as? NSNumber)?.intValue ?? Int.max) <= Self.maxLibraryBytes else {
      throw failure("The library is larger than 8 MiB.")
    }
    let data = try Data(contentsOf: url)
    guard let text = String(data: data, encoding: .utf8) else {
      throw failure("The library is not valid UTF-8. Its file has not been changed.")
    }
    return text
  }
  private func libraryData(_ value: Any?) throws -> Data {
    guard let string = value as? String, let data = string.data(using: .utf8),
      data.count <= Self.maxLibraryBytes,
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      number(object["version"]) == 1
    else {
      throw failure("Invalid library data. Files must be at most 8 MiB and use format version 1.")
    }
    return data
  }
  private func request(_ operation: String, payload: Any?) async throws -> Any? {
    switch operation {
    case "readPreferences": return UserDefaults.standard.string(forKey: "preferences")
    case "writePreferences":
      let data = try libraryData(payload)
      guard data.count <= 65536, let value = String(data: data, encoding: .utf8) else {
        throw failure("Invalid settings.")
      }
      UserDefaults.standard.set(value, forKey: "preferences")
      return nil
    case "readLibrary": return try readLibrary()
    case "writeLibrary":
      guard let input = payload as? [String: Any],
        input["previous"] is NSNull || input["previous"] is String
      else { throw failure("Invalid library write.") }
      let data = try libraryData(input["data"])
      guard try readLibrary() == input["previous"] as? String else {
        throw failure("The library changed in another window.")
      }
      let url = try libraryURL()
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: url, options: .atomic)
      return nil
    case "catalog": return try await catalog(payload)
    case "exportLibrary":
      let data = try libraryData(payload)
      let url = FileManager.default.temporaryDirectory.appendingPathComponent(
        "tagset-library-\(UUID()).json")
      try data.write(to: url, options: .atomic)
      let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
      activity.popoverPresentationController?.sourceView = controls
      activity.popoverPresentationController?.sourceRect = CGRect(
        x: controls.bounds.midX, y: 0, width: 1, height: 1)
      activity.completionWithItemsHandler = { [weak self] _, _, _, error in
        if let error { self?.report(error.localizedDescription) }
        do { try FileManager.default.removeItem(at: url) } catch {
          self?.report("The temporary export could not be removed: \(error.localizedDescription)")
        }
      }
      present(activity, animated: true)
      return nil
    default: throw failure("Unsupported native operation.")
    }
  }
  private func catalog(_ value: Any?) async throws -> Any {
    guard let input = value as? [String: Any], let endpoint = input["endpoint"] as? String,
      ["search", "next", "browse"].contains(endpoint), var body = input["body"] as? [String: Any]
    else { throw failure("Invalid catalog request.") }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyyMMdd"
    let version = "1.\(formatter.string(from: Date())).01.00"
    body["context"] = [
      "client": ["clientName": "WEB_REMIX", "clientVersion": version, "hl": "en", "gl": "US"]
    ]
    let data = try JSONSerialization.data(withJSONObject: body)
    guard data.count <= 65536 else { throw failure("The catalog request is too large.") }
    var request = URLRequest(
      url: URL(string: "https://music.youtube.com/youtubei/v1/\(endpoint)?prettyPrint=false")!)
    request.httpMethod = "POST"
    request.httpBody = data
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("https://music.youtube.com", forHTTPHeaderField: "Origin")
    request.setValue("67", forHTTPHeaderField: "X-YouTube-Client-Name")
    request.setValue(version, forHTTPHeaderField: "X-YouTube-Client-Version")
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 25
    config.timeoutIntervalForResource = 45
    let session = URLSession(configuration: config)
    defer { session.finishTasksAndInvalidate() }
    let (responseData, response) = try await session.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      let json = try JSONSerialization.jsonObject(with: responseData) as? [String: Any],
      json["error"] == nil
    else {
      throw failure(
        "YouTube Music could not return this information. Check that the link is public.")
    }
    return json
  }
  private func publish(_ message: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(message),
      let data = try? JSONSerialization.data(withJSONObject: message),
      let json = String(data: data, encoding: .utf8)
    else { return }
    controls.evaluateJavaScript("window.tagsetReceive?.(\(json))")
  }
  private func report(_ error: String) { publish(["error": error]) }
  private func showStartupError(_ message: String) {
    let label = UILabel()
    label.text = message
    label.textColor = .white
    label.numberOfLines = 0
    label.frame = view.bounds.insetBy(dx: 20, dy: 20)
    label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(label)
  }
  private func allowed(_ url: URL) -> Bool {
    url.scheme == "https" && url.user == nil && url.password == nil && url.port == nil
      && Self.hosts.contains(url.host ?? "")
  }
  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url else {
      decisionHandler(.cancel)
      return
    }
    if webView === controls {
      decisionHandler(url == controlsURL ? .allow : .cancel)
    } else if action.targetFrame?.isMainFrame == false || allowed(url) {
      decisionHandler(.allow)
    } else {
      report("The wrapper blocked navigation to \(url.host ?? "an unsupported destination").")
      decisionHandler(.cancel)
    }
  }
  func webView(
    _ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    guard webView === music || popups[webView] != nil, let url = action.request.url, allowed(url)
    else {
      report("This popup cannot be opened inside the player.")
      return nil
    }
    let popup = WKWebView(frame: .zero, configuration: config)
    popup.navigationDelegate = self
    popup.uiDelegate = self
    let controller = UIViewController()
    controller.view = popup
    (popups[webView] ?? self).present(controller, animated: true)
    controller.presentationController?.delegate = self
    popups[popup] = controller
    return popup
  }
  func webViewDidClose(_ webView: WKWebView) {
    popups.removeValue(forKey: webView)?.dismiss(animated: true)
  }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    if let entry = popups.first(where: {
      $0.value === presentationController.presentedViewController
    }) {
      popups.removeValue(forKey: entry.key)
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    report(error.localizedDescription)
  }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    if (error as NSError).code != NSURLErrorCancelled { report(error.localizedDescription) }
  }
}

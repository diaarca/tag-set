import CoreFoundation
import Security
import SwiftUI
import UniformTypeIdentifiers
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

private final class GitHubRedirectGuard: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}

private final class ScopedLibraryFolder {
  let url: URL
  let bookmark: Data
  init(_ url: URL) throws {
    guard url.startAccessingSecurityScopedResource() else {
      throw NSError(
        domain: "TagSet", code: 1,
        userInfo: [
          NSLocalizedDescriptionKey: "The selected folder cannot be accessed. Choose it again."
        ])
    }
    self.url = url
    do {
      bookmark = try url.bookmarkData(
        options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
    } catch {
      url.stopAccessingSecurityScopedResource()
      throw error
    }
  }
  deinit { url.stopAccessingSecurityScopedResource() }
}

private enum LibraryFiles {
  static func failure(_ message: String) -> NSError {
    NSError(domain: "TagSet", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  static func missing(_ error: Error) -> Bool {
    let error = error as NSError
    return error.domain == NSCocoaErrorDomain
      && [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(error.code)
  }
  static func readFile(_ url: URL) throws -> String? {
    do {
      let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      guard ((attributes[.size] as? NSNumber)?.intValue ?? Int.max) <= 8 * 1024 * 1024 else {
        throw failure("The library is larger than 8 MiB.")
      }
      let data = try Data(contentsOf: url)
      guard let text = String(data: data, encoding: .utf8) else {
        throw failure("The library is not valid UTF-8. Its file has not been changed.")
      }
      return text
    } catch {
      if missing(error) { return nil }
      throw error
    }
  }
  static func read(_ url: URL) async throws -> String? {
    try await Task.detached {
      var error: NSError?
      var result: Result<String?, Error>?
      NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &error) { target in
        result = Result { try readFile(target) }
      }
      if let error {
        if missing(error) { return nil }
        throw error
      }
      guard let result else { throw failure("The library could not be read.") }
      return try result.get()
    }.value
  }
  static func write(_ url: URL, data: Data, previous: String?, requireExisting: Bool) async throws {
    try await Task.detached {
      var error: NSError?
      var result: Result<Void, Error>?
      NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &error) {
        target in
        result = Result {
          let current = try readFile(target)
          if requireExisting && current == nil {
            throw failure(
              "The selected library is unavailable. Restore access or choose another folder.")
          }
          guard current == previous else { throw failure("The library changed in another window.") }
          try data.write(to: target, options: .atomic)
        }
      }
      if let error { throw error }
      guard let result else { throw failure("The library could not be saved.") }
      try result.get()
    }.value
  }
}

private final class WrapperController: UIViewController, WKNavigationDelegate,
  UIAdaptivePresentationControllerDelegate, UIDocumentPickerDelegate
{
  private let controls = WKWebView()
  private var audio: NativeAudioPlayer?
  private let handler = ScriptHandler()
  private var controlsURL: URL?
  private var activeFolder: ScopedLibraryFolder?
  private var locationLoaded = false
  private var folderContinuation: CheckedContinuation<URL?, Error>?
  private var pendingFolder: (token: String, folder: ScopedLibraryFolder?, url: URL, data: String?)?
  private static let maxLibraryBytes = 8 * 1024 * 1024
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    handler.receive = { [weak self] in self?.receive($0) }
    controls.configuration.userContentController.add(handler, name: "wrapperCommand")
    controls.configuration.userContentController.addUserScript(
      WKUserScript(
        source: "window.tagsetNativeAudio = true;", injectionTime: .atDocumentStart,
        forMainFrameOnly: true))
    controls.navigationDelegate = self
    controls.isOpaque = true
    controls.backgroundColor = .black
    view.addSubview(controls)
    NotificationCenter.default.addObserver(
      self, selector: #selector(refreshPlayback), name: UIApplication.didBecomeActiveNotification,
      object: nil)
    do {
      guard let folder = Bundle.main.url(forResource: "bundle", withExtension: nil)
      else { throw failure("Build the wrapper web interface before opening this app.") }
      audio = try NativeAudioPlayer { [weak self] message in
        guard UIApplication.shared.applicationState != .background else { return }
        self?.publish(message)
      }
      let index = folder.appendingPathComponent("index.html")
      controlsURL = index
      controls.loadFileURL(index, allowingReadAccessTo: folder)
    } catch { showStartupError(error.localizedDescription) }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    controls.frame = view.safeAreaLayoutGuide.layoutFrame
  }

  @objc private func refreshPlayback() { audio?.synchronize() }

  private func receive(_ message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any] else { return }
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
    if type == "queue", let action = body["action"] as? [String: Any],
      let actionType = action["type"] as? String,
      ["start", "next", "previous", "retry", "toggle", "shuffle", "repeat", "remove"].contains(
        actionType)
    {
      audio?.dispatch(action)
    } else if type == "playback-state" {
      audio?.synchronize()
    } else if type == "play" || type == "pause" {
      audio?.command(type)
    } else if type == "seek", let value = number(body["value"]) {
      audio?.seek(value)
    } else if type == "normalization", let enabled = body["enabled"] as? Bool {
      audio?.setNormalization(enabled)
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
  private func defaultLibraryURL() throws -> URL {
    try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
    )
    .appendingPathComponent("SetwiseWrapper/library.json")
  }
  private func libraryURL() throws -> URL {
    if !locationLoaded {
      if let data = UserDefaults.standard.data(forKey: "libraryFolderBookmark") {
        var stale = false
        let url = try URL(
          resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        let folder = try ScopedLibraryFolder(url)
        if stale { UserDefaults.standard.set(folder.bookmark, forKey: "libraryFolderBookmark") }
        activeFolder = folder
      }
      locationLoaded = true
    }
    return try activeFolder?.url.appendingPathComponent("library.json") ?? defaultLibraryURL()
  }
  private func readLibrary() async throws -> String? {
    let data = try await LibraryFiles.read(libraryURL())
    if activeFolder != nil && data == nil {
      throw failure("The selected library is unavailable. Restore access or choose another folder.")
    }
    return data
  }
  private func libraryLocation() throws -> [String: Any] {
    ["path": try libraryURL().path, "isDefault": activeFolder == nil]
  }
  private func prepareLibraryFolder(_ folder: ScopedLibraryFolder?) async throws -> [String: Any] {
    pendingFolder = nil
    let url = try folder?.url.appendingPathComponent("library.json") ?? defaultLibraryURL()
    let data = try await LibraryFiles.read(url)
    if let data { _ = try libraryData(data) }
    let token = UUID().uuidString
    pendingFolder = (token, folder, url, data)
    return ["token": token, "path": url.path, "data": data as Any? ?? NSNull()]
  }
  private func chooseLibraryFolder() async throws -> Any? {
    guard folderContinuation == nil, presentedViewController == nil else {
      throw failure("Close the current native dialog before choosing a folder.")
    }
    pendingFolder = nil
    let url: URL? = try await withCheckedThrowingContinuation { continuation in
      folderContinuation = continuation
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
      picker.delegate = self
      picker.allowsMultipleSelection = false
      present(picker, animated: true)
      picker.presentationController?.delegate = self
    }
    guard let url else { return nil }
    return try await prepareLibraryFolder(ScopedLibraryFolder(url))
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL])
  {
    folderContinuation?.resume(returning: urls.first)
    folderContinuation = nil
  }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    folderContinuation?.resume(returning: nil)
    folderContinuation = nil
  }
  private func activateLibraryLocation(_ value: Any?) async throws -> String {
    guard let input = value as? [String: Any], let token = input["token"] as? String,
      let selected = pendingFolder, selected.token == token
    else { throw failure("Choose the library folder again.") }
    guard try await LibraryFiles.read(selected.url) == selected.data else {
      throw failure("The folder library changed. Choose the folder again.")
    }
    let data: String
    if let existing = selected.data {
      data = existing
    } else {
      guard input["previous"] is NSNull || input["previous"] is String else {
        throw failure("Invalid library write.")
      }
      guard try await readLibrary() == input["previous"] as? String else {
        throw failure("The current library changed. Reload it before switching folders.")
      }
      let bytes = try libraryData(input["data"])
      guard let text = String(data: bytes, encoding: .utf8) else {
        throw failure("Invalid library data.")
      }
      data = text
      if selected.folder == nil {
        try FileManager.default.createDirectory(
          at: selected.url.deletingLastPathComponent(), withIntermediateDirectories: true)
      }
      try await LibraryFiles.write(selected.url, data: bytes, previous: nil, requireExisting: false)
    }
    if let folder = selected.folder {
      UserDefaults.standard.set(folder.bookmark, forKey: "libraryFolderBookmark")
    } else {
      UserDefaults.standard.removeObject(forKey: "libraryFolderBookmark")
    }
    activeFolder = selected.folder
    locationLoaded = true
    pendingFolder = nil
    return data
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
    case "hasGitHubToken": return try githubToken() != nil
    case "saveGitHubToken":
      guard let token = payload as? String, token.count <= 1024,
        token.range(of: "^[A-Za-z0-9_]+$", options: .regularExpression) != nil,
        let data = token.data(using: .utf8)
      else { throw failure("Invalid GitHub token.") }
      let query = tokenQuery()
      var status = SecItemUpdate(
        query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
      if status == errSecItemNotFound {
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        status = SecItemAdd(item as CFDictionary, nil)
      }
      guard status == errSecSuccess else {
        throw failure("The GitHub token could not be saved in Keychain.")
      }
      return nil
    case "removeGitHubToken":
      let status = SecItemDelete(tokenQuery() as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else {
        throw failure("The GitHub token could not be removed.")
      }
      return nil
    case "githubPull": return try await githubPull(payload)
    case "githubPush": return try await githubPush(payload)
    case "readPreferences": return UserDefaults.standard.string(forKey: "preferences")
    case "writePreferences":
      let data = try libraryData(payload)
      guard data.count <= 65536, let value = String(data: data, encoding: .utf8) else {
        throw failure("Invalid settings.")
      }
      UserDefaults.standard.set(value, forKey: "preferences")
      return nil
    case "libraryLocation": return try libraryLocation()
    case "chooseLibraryFolder": return try await chooseLibraryFolder()
    case "defaultLibraryFolder": return try await prepareLibraryFolder(nil)
    case "cancelLibraryLocation":
      pendingFolder = nil
      return nil
    case "activateLibraryLocation": return try await activateLibraryLocation(payload)
    case "readLibrary": return try await readLibrary()
    case "writeLibrary":
      guard let input = payload as? [String: Any],
        input["previous"] is NSNull || input["previous"] is String
      else { throw failure("Invalid library write.") }
      let data = try libraryData(input["data"])
      let url = try libraryURL()
      if activeFolder == nil {
        try FileManager.default.createDirectory(
          at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      }
      try await LibraryFiles.write(
        url, data: data, previous: input["previous"] as? String,
        requireExisting: activeFolder != nil)
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
  private func tokenQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "dev.dylan.Setwise.Wrapper.github",
      kSecAttrAccount as String: "token",
    ]
  }
  private func githubToken() throws -> String? {
    var query = tokenQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data,
      let token = String(data: data, encoding: .utf8)
    else { throw failure("The GitHub token could not be unlocked. Save it again.") }
    return token
  }
  private func githubConfig(_ value: Any?) throws -> (String, String) {
    guard let input = value as? [String: Any], let repo = input["repository"] as? String,
      repo.range(of: "^[A-Za-z0-9-]{1,39}/[A-Za-z0-9_.-]{1,100}$", options: .regularExpression)
        != nil,
      ![".", ".."].contains(String(repo.split(separator: "/").last ?? "")),
      let branch = input["branch"] as? String, !branch.isEmpty, branch.count <= 200,
      branch.rangeOfCharacter(
        from: .controlCharacters.union(.whitespacesAndNewlines).union(
          CharacterSet(charactersIn: "?#\\"))) == nil,
      let encoded = branch.addingPercentEncoding(withAllowedCharacters: .alphanumerics)
    else { throw failure("Enter a repository as owner/repo and a valid branch.") }
    return ("/repos/\(repo)", encoded)
  }
  private func githubCall(
    _ path: String, method: String = "GET", body: [String: Any]? = nil,
    allowMissing: Bool = false
  ) async throws -> [String: Any]? {
    guard let token = try githubToken() else { throw failure("Save a GitHub token first.") }
    guard let url = URL(string: "https://api.github.com\(path)") else {
      throw failure("Invalid GitHub request.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 30
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/vnd.github.object+json", forHTTPHeaderField: "Accept")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
    if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForResource = 30
    let session = URLSession(
      configuration: config, delegate: GitHubRedirectGuard(), delegateQueue: nil)
    defer { session.finishTasksAndInvalidate() }
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 404 && allowMissing { return nil }
    if [409, 422].contains(status) {
      throw failure(
        "GitHub rejected the update. Pull again before pushing; check branch permissions.")
    }
    guard (200...299).contains(status) else {
      throw failure(
        "GitHub request failed (\(status)). Check the repository, branch, token, and its Contents permission."
      )
    }
    guard data.count <= 12 * 1024 * 1024,
      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw failure("Invalid GitHub response.") }
    return json
  }
  private func validSHA(_ value: Any?) -> String? {
    guard let sha = value as? String,
      sha.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil
    else { return nil }
    return sha
  }
  private func githubPull(_ value: Any?) async throws -> [String: Any] {
    let (path, branch) = try githubConfig(value)
    _ = try await githubCall("\(path)/branches/\(branch)")
    guard
      let file = try await githubCall(
        "\(path)/contents/tagset-library.json?ref=\(branch)", allowMissing: true)
    else { return ["data": NSNull(), "sha": NSNull()] }
    guard file["type"] as? String == "file", let size = number(file["size"]),
      size <= Double(Self.maxLibraryBytes),
      let sha = validSHA(file["sha"])
    else { throw failure("Invalid shared library file.") }
    let blob: [String: Any]?
    if file["encoding"] as? String == "base64" {
      blob = file
    } else {
      blob = try await githubCall("\(path)/git/blobs/\(sha)")
    }
    guard blob?["encoding"] as? String == "base64", let encoded = blob?["content"] as? String,
      let bytes = Data(base64Encoded: encoded, options: .ignoreUnknownCharacters),
      let text = String(data: bytes, encoding: .utf8)
    else { throw failure("Invalid GitHub library response.") }
    _ = try libraryData(text)
    return ["data": text, "sha": sha]
  }
  private func githubPush(_ value: Any?) async throws -> [String: Any] {
    let (path, _) = try githubConfig(value)
    guard let input = value as? [String: Any], let branch = input["branch"] as? String,
      input["sha"] is NSNull || validSHA(input["sha"]) != nil
    else { throw failure("Pull before pushing.") }
    let data = try libraryData(input["data"])
    var body: [String: Any] = [
      "message": "Update TagSet library", "branch": branch, "content": data.base64EncodedString(),
    ]
    if let sha = validSHA(input["sha"]) { body["sha"] = sha }
    let result = try await githubCall(
      "\(path)/contents/tagset-library.json", method: "PUT", body: body)
    guard let content = result?["content"] as? [String: Any], let sha = validSHA(content["sha"])
    else { throw failure("GitHub did not confirm the library update. Pull before pushing again.") }
    return ["sha": sha]
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
  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    decisionHandler(webView === controls && action.request.url == controlsURL ? .allow : .cancel)
  }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    if presentationController.presentedViewController is UIDocumentPickerViewController {
      folderContinuation?.resume(returning: nil)
      folderContinuation = nil
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    report(error.localizedDescription)
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    if (error as NSError).code != NSURLErrorCancelled { report(error.localizedDescription) }
  }
}

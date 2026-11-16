# Setwise wrapper

Setwise's React interface and tag library, packaged with Electron for desktop and WKWebView for iOS 17+. Both shells use the same JavaScript library engine and load the full YouTube Music website in a separate native view for playback. Each device works independently without the local web server, Python, or a stream extractor.

The wrapper supports song search and automatic metadata, public playlist import, artist tags, direct and inherited assignments, multiple parents, cycle prevention, renaming, pins, song/tag deletion, and collection queues with shuffle and repeat. The server-backed web client and separate SwiftUI clients remain available with their existing storage.

## Desktop

Install the project's npm dependencies once, using the default Nix development shell:

```sh
nix develop --command npm ci
```

Then launch from the repository root:

```sh
nix develop .#wrapper --command npm run wrapper
```

The command builds the shared interface and opens Electron. The optional `wrapper` shell supplies Node.js, Electron, and XcodeGen on macOS. Electron is pinned by `flake.lock`; the current version is 45.2.3. No local server needs to stay running.

On macOS, quit fully with **Command-Q** before relaunching to load source changes. Launching a second instance focuses the existing one. Google sign-in may open a child window within the same application. The persistent YouTube Music session is retained between launches.

Desktop source targets macOS, Windows, and Linux; only macOS has had live playback checks. On Windows, install npm dependencies with Node.js 24+, run `npm run build:wrapper`, then use the matching [Windows Electron distribution](https://github.com/electron/electron/releases/tag/v45.2.3) to run `electron.exe wrapper/desktop/main.mjs`. Installers and distribution signing are not provided. Android packaging is not implemented.

## iPhone and iPad

Full Xcode is required. After installing npm dependencies, run:

```sh
nix develop .#wrapper --command npm run build:wrapper
nix develop .#wrapper --command xcodegen generate --spec apple/wrapper.yml
open apple/SetwiseWrapper.xcodeproj
```

Select **SetwiseWrapper-iOS** and your simulator or connected iPhone. For a physical device, enable automatic signing and choose your Personal Team under the target's **Signing & Capabilities**, then press **Command-R**. The default identifier is `dev.dylan.Setwise.Wrapper`; choose another unique identifier if necessary. **Setwise Wrapper** installs alongside the separate SwiftUI Setwise app. The generated project is independent of `apple/Setwise.xcodeproj`.

After changing shared UI code, run `npm run build:wrapper` before building in Xcode again. Regenerating the project replaces signing choices made only in Xcode; the ignored `apple/Config/Signing.local.xcconfig` can retain your `DEVELOPMENT_TEAM`, as described in the [Apple setup guide](../apple/README.md).

The iOS shell uses local files and the same library engine as desktop. Its audio-session category and background audio mode are configured, but physical-device sign-in and lock-screen playback still need verification. Use the device's volume buttons on iOS.

## Your library

Use **Add song** to search YouTube Music, paste a song link, import a public playlist as a tag, or enter metadata manually. Titles and structured artist credits come from the public catalog through anonymous requests made by the native host. Catalog access needs internet; browsing and editing saved library data work offline. Tag behavior and editors match the [main app documentation](../README.md#how-tags-work).

To bring across an existing library, choose **Export library** in the web client, then **Import library** in the wrapper. Version-1 JSON exports merge songs by video ID and tags by name. Existing local song metadata and pin choices are retained; new songs, tags, assignments, and relationships are added. Invalid files or relationships that would introduce a cycle reject the entire import. The import does not replace the source SQLite database or Swift journal.

**Export library** opens a desktop save dialog or the iOS share sheet. Exported JSON includes artist/manual assignment sources, relationships, and pins, and can be imported into another wrapper or the SwiftUI client. Library changes are not automatically synchronized between devices or with YouTube account playlists.

Desktop saves `library.json` in Electron's `userData` directory. iOS saves `SetwiseWrapper/library.json` in the app's Application Support directory. Writes replace the file atomically and check that it has not changed since loading. A failed write requires reopening the app before further edits; a loading failure never creates an empty replacement. Files are limited to 8 MiB and contain metadata, not downloaded music. Keep app data when updating or renewing device signing.

## Playback and accounts

Select a song or tag and choose **Play collection**. The player shows the song's cover above Setwise's controls; the YouTube Music website stays loaded behind the interface, hidden by default. Setwise controls queue selection, pause/resume, seeking, shuffle, and repeat. The website handles audio, availability, ads, and account features. Advertisement endings do not advance the queue. A queue is a snapshot; later library changes apply when you start the collection again. Queues and playback position are not persisted across launches.

Next/Previous media keys and system media-session controls navigate Setwise's queue rather than YouTube Music's recommendations. The bridge preserves these handlers when the website registers its own again. Both media actions and on-screen skips ignore playback reports from the previous track while loading the next one. Playing a single song starts a one-song queue; use **Play collection** to queue the selected tag or library.

Desktop track changes proceed past the playing page's leave-page confirmation. This applies only to explicit Setwise track loads from YouTube Music; account pages and ordinary website navigation retain their protection. A failed current load is reported, while requests canceled by a later skip are ignored. Loading without a track acknowledgement times out after 45 seconds, pauses playback, and offers retry or website access; advertisements suspend that timeout.

Choose **Open YouTube Music** for sign-in, consent, or playback prompts, then close it to return to the compact player. Controls identify the track from the actual player even when the website navigates elsewhere. Closing the website after selecting another track restores the active Setwise queue when playing. Unexpected track changes while the website is closed also restore that queue.

Covers come from the website's current artwork, with a YouTube thumbnail as fallback. Images use the browser's normal cache and are not added to library exports. Hiding the website does not convert playback to an audio-only stream or download songs for offline use. Full-site integration is unofficial and may require maintenance when the website changes. Background behavior remains subject to YouTube Music, the operating system, and the account's available features.

Credentials and cookies stay in the website's persistent Electron partition or WebKit store. Desktop sign-in, including two-step verification, has been confirmed by the user. Sign-in popups preserve their opener and session. The wrapper reports blocked destinations by hostname and denied permission requests without exposing credential-bearing URL parameters. It does not spoof the browser or transfer cookies from another browser.

## Verification

`npm run check` checks types, lint, formatting, tests, and both web and wrapper builds. Tests compare the portable library with SQLite through graph and artist edits, cover merge/import transactions, persistence, write failures, stale writes, corrupt files, playlist continuations, the playback message boundary, artwork URL validation, player identity and commands after website navigation, and media handlers surviving website re-registration.

Run `nix develop .#wrapper --command npm run test:wrapper-navigation` for an isolated, hidden Electron regression test. It reproduces a real Chromium leave-page block, verifies consecutive track changes through the production navigation handler, and checks that ordinary navigation remains protected. It uses local fixture pages and a separate test profile without contacting YouTube or using your account.

Live catalog checks retrieved the reported [#Hulahoop track](https://music.youtube.com/watch?v=EsAQYAeqxD4), search results, and a public playlist. The desktop playback integration previously played that track and advanced a queue; its embedded player returned error 150. An isolated Electron UI check with simulated playback verified button skips, media navigation, stale reports, and skipping while paused. Physical macOS media-key delivery still needs live verification. The full interface loads in the iPhone Simulator, and a native UI check created a tag, pinned it, restarted the app, and verified persistence. Playback with the website hidden needs live verification. Physical iPhone background playback and desktop platforms other than macOS remain unverified.

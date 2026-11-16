# Native Apple clients

Shared SwiftUI client source for **iOS 17+ and macOS 14+**. Both targets run independently: the Mac web server and Python catalog bridge are not used. Search, song-link lookup, and public playlist import call YouTube Music directly. Library management works locally; playback and catalog access need internet.

The default project is a local-only build for free Personal Team signing on iPhone and local signing on Mac. It includes native audio playback, lock-screen commands, and a local library journal. CloudKit is an optional configuration requiring the appropriate paid developer capabilities. Physical-device installation, real lock-screen playback, and two-device CloudKit behavior still need verification; see `.todo`.

## Build and configure

Install full Xcode with Swift 6+ and select its developer tools in Xcode's settings. Apple's command-line tools alone do not contain the required iOS SDK and all SwiftUI build components.

From the repository root:

```sh
nix develop path:.
xcodegen generate --spec apple/project.yml
```

Open `apple/Setwise.xcodeproj` in Xcode. The generated project is ignored by Git; shared source, configuration, and the dependency lock are intended for version control. The default bundle identifier is `dev.dylan.Setwise`. The local Mac build and iPhone Simulator build have been checked, and the simulator app's library screen launches successfully.

For the simulator, select the **Setwise-iOS** scheme and an iPhone Simulator destination, then press **Command-R**. No Apple account is needed. For the Mac app, select **Setwise-macOS**, **My Mac**, and press **Command-R**. The Mac target defaults to **Sign to Run Locally**.

### Install on your iPhone with a free account

1. In **Xcode > Settings > Apple Accounts**, add your Apple Account. Keep account credentials in Xcode; no passwords or tokens belong in project files.
2. Select the blue **Setwise** project, then **TARGETS > Setwise-iOS > Signing & Capabilities**.
3. Leave **Automatically manage signing** enabled and choose your **Personal Team** in the Team menu. Keep `dev.dylan.Setwise`, or choose another unique bundle identifier if Xcode reports it unavailable.
4. Connect and unlock your iPhone, trust the Mac if prompted, and enable **Settings > Privacy & Security > Developer Mode** on the phone when requested.
5. Select your physical iPhone as the destination for **Setwise-iOS** and press **Command-R**. Follow any developer-trust prompts on the device.

This installs directly on your phone without an App Store listing. The app runs independently after installation; the Mac can be turned off. YouTube access still requires internet. Free Personal Team provisioning expires after seven days; rebuild and reinstall with the same team and bundle identifier to renew it. Do not uninstall the app as part of renewal, since that can remove its local library.

### Keep signing choices across regeneration

Xcode UI changes to the generated project are replaced by regeneration. `Config/Signing.xcconfig` optionally includes the ignored file `apple/Config/Signing.local.xcconfig`. Create that local file to preserve your settings:

```xcconfig
DEVELOPMENT_TEAM = YOUR_TEN_CHARACTER_TEAM_ID
PRODUCT_BUNDLE_IDENTIFIER = dev.dylan.Setwise
```

Replace the sample Team ID with your actual identifier; never put an account password in this file. You can also choose the team in Xcode again after regenerating if you prefer not to create local overrides.

### Optional CloudKit build

The default build has no iCloud entitlements and hides the iCloud controls. It does not require an iCloud container. To enable sync with a developer membership supporting CloudKit, register a private container and add `SETWISE_CLOUD_CONTAINER = iCloud.your.registered.container` to the local signing file, then generate:

```sh
nix develop path:. --command xcodegen generate --spec apple/project-cloud.yml
```

Use the same bundle identifier, team, and registered container on both targets. Verify their iCloud/CloudKit capabilities and provisioning profiles in Xcode. To return to free/local signing, regenerate with `apple/project.yml`.

The iOS target declares the `audio` background mode in both configurations. The Mac target enables sandboxed outgoing networking and user-selected file reads. Cloud builds use the CloudKit Development environment. Before distributing signed cloud builds, deploy the schema to Production and use the entitlement environment required by the distribution profile. No publishing or Apple account configuration is performed by repository tooling.

## Library and sync

The native clients provide song search/import, playlist-as-tag import, artist tags, direct assignments, inherited tag collections, tag renaming and pinning, graph editing, and song/tag deletion. Song editors distinguish direct and artist assignments from membership inherited through child tags. Tag collections are deduplicated and playable with one song; two songs qualify as an automatic playlist.

Each client keeps `Setwise/library.json` in its own Application Support directory. Writes are atomic. A loading failure is shown and prevents overwriting the existing library. The journal contains immutable changes and a local upload queue. CloudKit stores those changes in the user's private `SetwiseLibrary` zone, with incremental change tokens; it never synchronizes the local file itself. Edits made during a sync remain queued for the next pass.

In CloudKit builds, sync runs when the app is active, after edits, every minute while active, and when **Sync now** is pressed. It is eventually consistent and needs internet. Errors appear in the sync status; local edits stay available. Changing iCloud accounts pauses sync to avoid mixing accounts. Sync is off until explicitly enabled; the default local build has no sync controls.

Changes replay in a deterministic logical-clock/device order. Concurrent tag creations with the same normalized name share a tag and retain their song assignments. Concurrent edits to an existing field follow replay order; edits to deleted entities do not recreate them. Concurrent relationships that would create a cycle, or renames that would duplicate another tag's name, are ignored and reported in the conflict count. The original change history is retained; it is not compacted in this version.

To move the existing browser library, choose **Export library** in the web app, transfer the JSON file, and choose **Import web library** in either native client. This preserves songs, artist credits, pins, direct/artist assignment sources, and tag relationships. Existing native song edits are retained. Enable iCloud sync to carry the imported library to the other native device. Subsequent browser edits require another explicit import.

## Playback

Audio streams are resolved on the device by a pinned YouTubeKit revision using its local extractor; its optional remote fallback is disabled. Only natively playable m4a audio-only streams are selected. AVPlayer handles streaming and seeking. When available, the stream URL's duration bounds playback and supplies the displayed and lock-screen duration, avoiding inflated m4a container durations and a silent tail. Without a valid stream duration, AVPlayer supplies the duration and endpoint. The app configures the iOS playback audio session, background audio capability, Now Playing metadata, lock-screen play/pause/next/previous/seek commands, interruption handling, and pausing when headphones disconnect. A limited background task covers stream preparation between tracks; expiration stops preparation and shows a retry message.

The unofficial extractor may fail for restricted songs, account requirements, region restrictions, or YouTube changes. Retry re-resolves the stream. Failed songs can be skipped; the queue stops when no playable songs remain. The library journal stores metadata and changes, without music files or resolved stream URLs. The browser client continues using its visible official embed.

An on-device stream resolution and a short audio-range fetch can validate the extractor, but do not establish that iOS background playback works. Hardware verification remains required.

## Verification

The Nix Swift toolchain can run the shared tests and compile the platform services without full Xcode:

```sh
nix develop path:. --command swift test --package-path apple --build-system native --disable-xctest --enable-swift-testing
```

The explicit native build-system flag works around the incomplete command-line-only Apple installation used during development; SwiftPM currently marks that flag deprecated. With full Xcode, use the supported default build system (`swift test --package-path apple --disable-xctest --enable-swift-testing`).

The Swift tests cover nested inheritance, direct and alternative paths, deterministic offline merge, concurrent cycles and tag creation, deletion/rename behavior, artist-name reuse, journal persistence, web-library migration, URL validation, catalog artist parsing, playlist continuation formats, and playback duration bounds. Playlist tests keep recommendation tokens separate from song pagination. `SetwisePlatform` compiles the audio, storage, and CloudKit service code; the SwiftUI application is built through the generated Xcode project.

Before considering the native clients complete, verify:

- Build both Xcode schemes and install the iOS app on a physical device.
- Play a collection, lock the iPhone, leave it locked through several track transitions, and check lock-screen transport and seeking.
- Exercise calls/audio interruptions, headphones disconnecting, expired or unavailable streams, and network loss/recovery.
- Import a public playlist, restart both apps, and check library/tag persistence.
- Edit songs, pins, assignments, and relationships on both devices, including offline edits; reconnect and check convergence and reported conflicts.
- Change iCloud availability/accounts and verify errors preserve the local library and pending edits.

# TagSet

A local music library with tags, inherited playlists, and YouTube Music playback. Electron runs the desktop app. iPhone/iPad use the same web interface with native AVPlayer audio and queue handling. No local server is required. [Source code](https://github.com/diaarca/tag-set).

Songs inherit artist tags. Parent tags include their descendants' songs, without duplicates or cycles. Tags support pins, renaming, and deletion. Search/import songs and playlists, play collections in order or shuffled, and transfer libraries through JSON import/export. Repeat-all is enabled by default; Space toggles playback while the app is focused. The player’s **Sleep timer** pauses playback after a chosen duration, including in the background on iOS. Change the duration to restart it or choose **Cancel timer**. Timers count elapsed time even while paused and reset when the app quits.

Use the song checkboxes to select songs, then **Edit tags** to add or remove a tag in bulk. The header checkbox selects all visible search results; changing the search or collection clears selection. Delete/Backspace asks to remove the current tag, or permanently delete selected songs from **All songs**. Removing a tag excludes those songs even from inherited or artist membership, without changing artist credits or shared relationships. Exclusions also apply when propagating to parent tags; another membership path can still include the song. Add the tag again to restore membership. Exclusions are saved in library exports and sharing; older app versions cannot read libraries containing them.

On phones, a fixed bottom bar shows the song and playback controls. Tap its cover/title to open Now Playing; use **Back to library** or swipe down from the top of the panel to return. Desktop and iPad layouts keep the existing player panel. This also prepares the interface for Android phones; Android packaging is not yet available.

## Run

```sh
git clone https://github.com/diaarca/tag-set.git
cd tag-set
nix develop
npm ci
npm start
```

Direnv loads the same environment automatically. Nix provides Node.js, Electron, and XcodeGen on macOS. Quit fully with **Command-Q** before relaunching changes on Mac.

| Command                 | Usage                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `npm start`             | Build and launch the desktop app.                                                  |
| `npm run build`         | Build the shared interface into `wrapper/bundle`.                                  |
| `npm run check`         | Check types, lint, formatting, tests, and build.                                   |
| `npm run test:desktop`  | Run isolated Electron navigation and interface checks; requires a desktop session. |
| `nix run .#dmg`         | Build an Apple Silicon macOS disk image.                                           |
| `nix run .#windows`     | Build a Windows x64 installer.                                                     |
| `nix run .#linux`       | Build a Linux x64 archive.                                                         |
| `nix run .#linux-arm64` | Build a Linux ARM64 archive.                                                       |
| `nix run .#ios`         | Build an unsigned iOS archive; use Xcode or the install command below to install.  |
| `nix run .#xcode`       | Build the current interface and open the iOS project in Xcode.                     |

Packages are written to `dist/releases` and include their runtime. Windows/Linux packages can be built on macOS or Linux. The DMG requires Apple Silicon macOS; Intel Mac build hosts are unsupported by the pinned Nixpkgs. Installed apps need no Nix or Node.js. Linux also requires desktop libraries and Chromium sandbox support.

## Releases

Published packages will be available on [GitHub Releases](https://github.com/diaarca/tag-set/releases): macOS Apple Silicon DMG, Windows x64 installer, Linux x64/ARM64 archives, and an unsigned iOS Xcode archive ZIP. The iOS archive is not directly installable; use the source and Xcode instructions below to sign and install. Each release includes `SHA256SUMS.txt` for verifying downloads. Android and Intel Mac packages are not available.

To prepare a release, merge the desired changes and set `package.json` and its lockfile to the release version. Tag that commit as `vVERSION` and push the tag, then open **Actions → Release → Run workflow** on `main` and enter the existing tag. The tag must match the package version, for example `v0.1.0`. The workflow checks source, builds all five packages, and creates a **draft** only after both build jobs succeed. Review its notes and packages before publishing manually. An existing release is never overwritten; if a failed upload leaves a partial draft, delete that draft before retrying. Release builds do not run on ordinary pushes or pull requests.

## iPhone and iPad

Requires full Xcode and iOS 17+. From the repository root:

```sh
nix run .#xcode
```

The command builds the interface and updates the generated project when needed. Select **TagSet-iOS**, your connected iPhone, automatic signing, and your Personal Team. Press **Command-R** to install and launch. Enable Developer Mode on the phone. Keep signing overrides in the ignored `apple/Config/Signing.local.xcconfig`; an existing project team is preserved there on the first update. Other settings made only in Xcode may be replaced. The first build downloads the pinned YouTubeKit Swift package.

iOS resolves HLS streams locally and plays them natively, including while locked or using another app. The native queue handles next/previous, shuffle, repeat, and lock-screen controls with cover artwork. Returning to TagSet refreshes the displayed track and position. Force-quitting the app stops playback. No Google sign-in is used on iOS, so restricted songs or songs without a playable HLS stream may be unavailable. Extraction is unofficial and may need updates when YouTube changes.

For command-line installation using the configured team:

```sh
nix run .#ios -- --list-devices
nix run .#ios -- --device DEVICE_ID --allow-provisioning-updates
```

`--team TEAM_ID` overrides the configured team. `--allow-provisioning-updates` lets Xcode manage signing profiles. Free Personal Team profiles expire after seven days; reinstall to renew.

## Settings

Open **Settings** in the sidebar. Choose English (default) or French for the interface. Automatic loudness normalization on desktop and iOS reduces loud tracks using available YouTube metadata. Quiet tracks are not amplified; tracks without metadata keep their usual volume. On iOS, metadata loads independently of playback, so the reduction may apply shortly after a song starts. Normalization does not change the device volume.

Set a minimum song count to hide small artist tags from the sidebar. The default `0` shows all tags; pinned and created tags are always shown. Hidden tags remain available in editors.

**Library folder** selects where `library.json` is stored. Choose a local folder or one synced by iCloud Drive or another file provider; on iOS, use the Files picker. An empty folder receives a copy of your current library. An existing library requires **Replace current library** or **Cancel**; the previous file stays in its original folder. Switching stops playback and makes GitHub sharing use the selected library. **Use default folder** returns to device storage using the same confirmation flow.

Choose the folder separately on each device. Wait for the provider to finish syncing, then use **Reload library** or reopen TagSet to read external changes. Avoid simultaneous edits: cloud-provider conflicts are not merged automatically. Settings and credentials stay private on each device.

**Reset library** asks for confirmation, then removes all songs and tags from the selected file and stops playback. Export a backup first if needed. Cloud folders sync this reset; GitHub changes only when you push. Settings and credentials are kept.

For GitHub sharing, create an initialized repository and a fine-grained personal access token with **Contents: read and write** for that repository. Enter `owner/repo`, its branch, and the token, then save the connection. Use **Pull from GitHub** before **Push to GitHub**, including before the first push to an empty library repository. A private repository keeps your library private. No Git installation is needed.

Pull merges additions and preserves local edits; deletions do not propagate. Push writes `tagset-library.json` and rejects unseen remote changes. Tokens are stored using the desktop system keychain or iOS Keychain, separately from library exports; Linux requires an available system keyring. GitHub sharing is manual.

## Data and limits

Default libraries use `Setwise Wrapper/library.json` in Electron's application-data directory, or `SetwiseWrapper/library.json` in iOS Application Support. Settings can select another folder. Legacy storage/encryption identities and Apple bundle IDs are retained to preserve libraries and sign-in through the rename. Use **Export library** for backups and transfer. Offline music downloads are not implemented.

On desktop, YouTube Music stays hidden behind the player. **Open YouTube Music** provides sign-in and playback prompts. Playback and catalog access require internet. Neither playback path guarantees audio-only network transfers.

macOS playback and integrated iPhone background playback, queue controls, and seeking have been verified. Windows/Linux runtime behavior still needs device testing. Desktop packages have no distribution signing or notarization, so downloaded copies may trigger OS security prompts.

## Contributing and license

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities privately through [SECURITY.md](SECURITY.md). Never share cookies, personal libraries, HAR files, or signing files.

TagSet's code is [MIT licensed](LICENSE). [NOTICE](NOTICE) covers bundled dependencies and third-party media; TagSet is not affiliated with YouTube or Google.

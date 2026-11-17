# TagSet

A local music library with tags, inherited playlists, and YouTube Music playback. Electron runs the desktop app; WKWebView runs the same interface on iPhone/iPad. No local server is required. [Source code](https://github.com/diaarca/tag-set).

Songs inherit artist tags. Parent tags include their descendants' songs, without duplicates or cycles. Tags support pins, renaming, and deletion. Search/import songs and playlists, play collections in order or shuffled, and transfer libraries through JSON import/export. Repeat-all is enabled by default; Space toggles playback while the app is focused.

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

Packages are written to `dist/releases` and include their runtime. Windows/Linux packages can be built on macOS or Linux. The DMG requires Apple Silicon macOS; Intel Mac build hosts are unsupported by the pinned Nixpkgs. Installed apps need no Nix or Node.js. Linux also requires desktop libraries and Chromium sandbox support.

## iPhone and iPad

Requires full Xcode and iOS 17+. Build the interface, then open the project:

```sh
npm run build
xcodegen generate --spec apple/wrapper.yml  # Only if the project is missing.
open apple/TagSet.xcodeproj
```

Select **TagSet-iOS**, your connected iPhone, automatic signing, and your Personal Team. Press **Command-R** to install and launch. Enable Developer Mode on the phone. Keep signing overrides in the ignored `apple/Config/Signing.local.xcconfig`; regenerating the project replaces settings made only in Xcode.

For command-line installation using the configured team:

```sh
nix run .#ios -- --list-devices
nix run .#ios -- --device DEVICE_ID --allow-provisioning-updates
```

`--team TEAM_ID` overrides the configured team. `--allow-provisioning-updates` lets Xcode manage signing profiles. Free Personal Team profiles expire after seven days; reinstall to renew.

## Data and limits

Libraries remain on each device: `Setwise Wrapper/library.json` in Electron's application-data directory, or `SetwiseWrapper/library.json` in iOS Application Support. Legacy storage/encryption identities and Apple bundle IDs are retained to preserve libraries and sign-in through the rename. Use **Export library** for backups and transfer. Automatic synchronization and offline music downloads are not implemented.

YouTube Music stays hidden behind the player. **Open YouTube Music** provides sign-in and playback prompts. Playback and catalog access require internet; the unofficial integration may need updates when YouTube changes. Hiding the website does not guarantee audio-only downloads or background playback.

macOS playback and signed iPhone installation have been verified. Windows/Linux runtime behavior and iPhone background playback still need device testing. Desktop packages have no distribution signing or notarization, so downloaded copies may trigger OS security prompts.

## Contributing and license

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities privately through [SECURITY.md](SECURITY.md). Never share cookies, personal libraries, HAR files, or signing files.

TagSet's code is [MIT licensed](LICENSE). [NOTICE](NOTICE) covers bundled dependencies and third-party media; TagSet is not affiliated with YouTube or Google.

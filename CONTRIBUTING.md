# Contributing

Check existing [issues](https://github.com/diaarca/tag-set/issues) before reporting a bug or proposing a feature. Discuss larger changes first; small fixes can go straight to a pull request.

## Development

Fork the repository and create a branch from `main`. Run commands from its root:

```sh
nix develop
npm ci
npm run check
npm run security
npm run test:desktop  # Requires a graphical desktop session.
```

Nix provides Node.js, Electron, Gitleaks, and XcodeGen on macOS. `npm start` launches the desktop app. See [README.md](README.md) for packaging and iPhone installation. The npm package is private to prevent accidental registry publication; the source is MIT licensed.

CI uses the smaller `nix develop .#ci` shell with Node.js and Gitleaks. One Linux job checks source, unit tests, the interface build, and repository security; desktop tests and native packaging stay manual.

The shared React interface, library engine, and catalog parser live in `wrapper/src`; `wrapper/desktop` and `apple/Wrapper` provide the native hosts. Preserve the JSON library format, inherited tag behavior, and native bridge boundaries. Legacy storage and encryption identifiers intentionally survive the TagSet rename.

## Changes and pull requests

- Follow nearby TypeScript, JavaScript, Swift, and formatting conventions. Keep changes focused and dependencies justified.
- Test observable behavior with small synthetic fixtures. Tests must not require a Google account or live YouTube responses.
- Run `npm run check` and `npm run security`. Run the Electron checks for interface, bridge, or playback changes; verify affected native builds when possible.
- Describe the problem, resulting behavior, and checks performed. State skipped platform checks; add screenshots for visual changes when useful.

Never commit credentials, cookies, HAR files, personal libraries, signing keys/profiles, generated Xcode projects, or build outputs. Ignore rules do not remove previously committed files. Run the security check before pushing and inspect `git diff --cached`; use **Export library** for personal backups outside the repository. Report suspected leaks privately through [SECURITY.md](SECURITY.md).

Participation follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Contributions use the [MIT license](LICENSE); preserve [third-party notices](NOTICE).

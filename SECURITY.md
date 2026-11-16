# Security

Report vulnerabilities privately to **grousson.dylan@gmail.com**, the maintainer contact also used by the related projects. Include the affected commit/version, impact, and a minimal reproduction using synthetic or sanitized data. Do not publish exploit details or credentials in an issue.

Never attach passwords, cookies, tokens, raw HAR files, personal library exports, signing certificates, provisioning profiles, or generated Xcode archives. Screenshots and logs can expose account names and device identifiers. If a credential was committed, revoke or rotate it first; deleting the current file does not remove it from history. Coordinate any history cleanup privately.

## Trust and storage

TagSet runs locally without a project-operated server or automatic library synchronization. Libraries and exports contain listening preferences and tags; they are JSON, not encrypted backups. YouTube Music runs separately from the local interface, with persistent Google sign-in data managed by Electron or WebKit. Catalog requests and playback contact Google; cover images contact their image hosts.

Desktop remote content runs sandboxed with Node.js disabled and context isolation enabled. Native library operations are restricted to the bundled interface. Preserve those boundaries, URL restrictions, and library validation when contributing. A repository scan cannot establish that the application or its dependencies have no vulnerabilities.

## Checks and support

`npm run security` rejects tracked files covered by repository ignore rules, scans candidate files and all local Git refs with Gitleaks, and runs npm's dependency audit. It does not inspect ignored personal files or upload source/library contents; npm audit submits dependency information to the npm registry. CI runs this check alongside the normal tests. No scanner detects every secret: review changes before sharing them.

The npm audit does not cover Electron supplied by Nix or Apple's WebKit. Keep `flake.lock` and the device operating system up to date alongside npm dependencies.

Use the latest code on `main` when checking a report; older versions have no separate security-maintenance commitment. Report ordinary bugs through the [issue tracker](https://github.com/diaarca/tag-set/issues).

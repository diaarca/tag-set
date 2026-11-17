# Security

Report vulnerabilities privately to **grousson.dylan@gmail.com**. Include the affected commit/version, impact, and a minimal reproduction using synthetic or sanitized data. Do not publish exploit details or credentials in an issue.

Never attach passwords, cookies, tokens, raw HAR files, personal library exports, signing certificates, provisioning profiles, or generated Xcode archives. Screenshots and logs can expose account names and device identifiers. If a credential was committed, revoke or rotate it first; deleting the current file does not remove it from history. Coordinate any history cleanup privately.

## Trust and storage

TagSet runs locally without a project-operated server. Libraries and exports contain listening preferences and tags; they are JSON, not encrypted backups. A folder selected in Settings may be synced by its cloud provider. Only the library file is placed there; credentials and preferences remain in private device storage. Native folder pickers grant access, with security-scoped bookmarks and coordinated file access on iOS. Changes detected before writing are rejected; avoid simultaneous edits because cloud-provider conflicts are not merged automatically.

YouTube Music runs separately from the local interface, with persistent Google sign-in data managed by Electron or WebKit. Catalog requests and playback contact Google; cover images contact their image hosts.

Desktop remote content runs sandboxed with Node.js disabled and context isolation enabled. Native library operations are restricted to the bundled interface. Preserve those boundaries, URL restrictions, and library validation when contributing.

Optional library sharing contacts `api.github.com` only through native operations. GitHub tokens are protected by Electron's OS-backed encryption or iOS Keychain, never included in library exports or sent to YouTube. Linux plaintext credential storage is rejected. Use a fine-grained token scoped to the chosen library repository with Contents read/write permission. Published library files are readable by anyone who can access that repository.

## Maintenance and support

Review staged changes before committing; keep personal files covered by `.gitignore` outside Git. Dependabot proposes dependency updates. Run `npm audit` when reviewing npm dependencies; it does not cover Electron supplied by Nix or Apple's WebKit. Keep `flake.lock` and the device operating system up to date as well.

Use the latest code on `main` when checking a report; older versions have no separate security-maintenance commitment. Report ordinary bugs through the [issue tracker](https://github.com/diaarca/tag-set/issues).

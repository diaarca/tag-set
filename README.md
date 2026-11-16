# Setwise

A music library where tags connect songs, artists, and other tags. Search YouTube Music, import song links or playlists, and organize the results through inherited tags.

The local web app runs on macOS and Linux, or in WSL with a Windows browser. Native clients target iOS 17+ and macOS 14+, with independent local storage and unofficial native audio playback. Their default configuration supports free Personal Team installation on iPhone and local signing on Mac. CloudKit sync is a separate optional build. Physical-device playback and CloudKit sync still need validation; see [Apple app setup](apple/README.md).

## Run locally

From the project directory, enter the pinned Nix development environment:

```sh
nix develop path:.
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3210**. Keep the server running while using the app. Stop it with Ctrl+C.

The `path:.` flake reference includes newly created files without staging them in Git. Nix's `nix-command` and `flakes` features must be enabled in your configuration. The shell provisions Node.js, Python, and the `ytmusicapi` catalog client on macOS and Linux, plus XcodeGen and Swift tools on macOS. On Windows, run the web server in WSL using these same Nix instructions and open the local URL in your Windows browser. If a native SQLite binary is unavailable, its installation needs platform C++ build tools and Python. The Nix shell provisions these tools on Linux; on macOS, Apple's Command Line Tools may be needed for a source build.

Start the server inside this Nix shell so it can find the catalog client. A separately provisioned runtime needs Node.js 24+, Python with the pinned `ytmusicapi` version from `flake.nix`/`flake.lock`, and npm dependencies. `SETWISE_PYTHON` can specify the Python executable used for catalog access.

For development:

```sh
npm run dev
```

Open **http://127.0.0.1:5173**. Vite reloads the interface, proxies API requests to the local server, and the server restarts when its source changes. Both servers bind only to loopback. Ports 3210 and 5173 must be available.

## Find and import music

Choose **Add song** to search YouTube Music by title or artist. Each result shows the song's title and credited artists. Choose **+ Add** to import it and open its details for tagging. Songs already in the library offer **In library** instead.

Alternatively, choose **Paste a link** and **Import song**. The app looks up the exact YouTube/YouTube Music video ID and imports its title and artist list without manual entry. Existing links open the existing song without another lookup. Artist tags are created or reused automatically.

Choose **Import playlist** to add a public or unlisted YouTube Music playlist as a tag. The tag defaults to the playlist title; you can enter another name, including an existing tag's name. Import creates missing songs and artist tags, preserves existing song edits, and reports unavailable entries skipped. Reimporting adds songs without removing assignments. This is a snapshot import; later YouTube playlist changes are applied only when you import again. Empty or inaccessible playlists create no tag, and database writes roll back together if import fails.

Search and link metadata use the public YouTube Music catalog through the unofficial `ytmusicapi` client; no API key or YouTube sign-in is needed. Catalog access requires internet and may need a dependency update when YouTube changes. It uses structured artist credits rather than guessing names from a video title or treating the uploading channel as the artist. If credits are unavailable, the app shows an error and offers **Enter them manually**. Imported titles and artists remain editable.

## How tags work

- Each imported artist automatically receives a tag; an existing tag with the same name is reused. Manual entry requires a YouTube/YouTube Music URL, title, and at least one artist, with multiple artists on separate lines. Duplicate video links open the existing song instead of creating another copy.
- In the web app, click a song title to edit its details, assign existing tags, or create a tag directly on the song. Play a song with its numbered play button, or play the selected collection in title order.
- In the web app, create tags with **New tag** or the **+** beside Your Library. Select a tag and choose **Edit tag** to rename it, pin it, or connect parent and child tags. The native clients provide the same operations through their sidebar and editors.
- A parent contains songs assigned directly to it and every song in its children and descendants. For example, making `Daft Punk` a child of `atmosphere` brings all Daft Punk songs into atmosphere. A song can also have atmosphere directly.
- Tags can have several parents. Each song appears once in a collection, even if several paths lead to it. Self-links and indirect loops are rejected.
- Removing a relationship removes only that source of inheritance. Direct assignments and other paths continue to apply. Song details show both direct membership and the child tags responsible for inherited membership.
- Every tag stays visible, including empty tags. A tag with two or more distinct songs is an automatic playlist; a tag with one song is also playable. The playlist is a view of the tag, so membership and names stay current automatically.
- Pinned tags appear first; both pinned and remaining tags are sorted alphabetically. Search tags or search songs within the current collection.
- Deleting a tag removes its assignments and relationships, while preserving songs, artist credits, and other tags. Children are not reconnected to the deleted tag's parents. Deleting a song preserves its tags for reuse.

Artist credits and tag names are separate. Renaming an artist tag changes the collection name, not song credits. Editing a song's artist list rebuilds its artist-generated assignments while preserving manual assignments. Deleting an artist tag does not recreate it on page load or title-only edits; changing the artist list may recreate it.

## Playback

Web playback uses the visible YouTube embedded player, with play/pause, previous/next, seeking, volume, shuffle, and repeat off/all/one. The player remains mounted while navigating the library. A collection starts a snapshot queue; later tag edits apply the next time you play the collection. Deleting a song removes it from the active queue. Queues and playback position are not saved across page reloads.

Internet access is required for playback. YouTube may show ads or restrict videos by region, availability, account requirements, or embedding settings. Unavailable songs show Retry and Skip controls. Failed songs are skipped in subsequent queue navigation; exhausting the playable queue stops playback. Browser autoplay restrictions may require pressing Play or using the embedded player directly.

The web embedded player stays visible: it does not expose YouTube Music's audio-only Song/Video switch, and hiding it would still download the video. Browsers may limit background or locked-screen playback. Native clients use AVPlayer with locally resolved audio-only streams through the pinned YouTubeKit dependency; iOS background audio and lock-screen commands are configured, but need real-device validation. No remote extraction service is enabled.

Neither client signs in to YouTube, continuously synchronizes YouTube playlists, downloads music for offline use, or offers offline playback. Library management and searching saved songs work without internet access; catalog search, metadata import, and playback contact YouTube. The unofficial catalog and native stream integrations can need updates when YouTube changes.

## Data and backup

The web server stores the library in **`data/library.sqlite`**, relative to the project directory. It is excluded from Git along with SQLite's companion files. Keep this directory when updating the app. The server applies versioned database migrations on startup.

To back up, stop the server cleanly with Ctrl+C and copy `data/library.sqlite` to a safe location. To restore, stop the server and restore that file into the data directory. Do not replace the database while the app is running. A live SQLite database may also have `-wal` and `-shm` files; copying just the main file while running is not a reliable backup.

Set `SETWISE_DB` to use another database location. Relative paths resolve from the directory where the server starts. Do not expose the server through a public proxy: this version has no accounts or authentication and is intended for one person on one computer.

Use **Export library** in the web app to save a versioned JSON export containing songs, tags, pins, explicit assignments, and tag relationships. Import that file with **Import web library** in a native client. The default native build keeps its journal locally; optional CloudKit builds can synchronize changes through a shared private iCloud container after developer-account setup. The browser library remains independent after export; it is not automatically synchronized with the native clients. Live SQLite files should not be placed in Git or an iCloud Drive sync folder.

## Development checks

Run inside the Nix shell (including WSL on Windows):

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Tests exercise the actual SQLite library and Fastify API, catalog import and duplicate behavior, the Python catalog bridge with mocked responses, and queue behavior and player commands with a mock YouTube player. Automated tests do not call YouTube. Real catalog availability, video playback, browser autoplay, keyboard interaction, and responsive layout need live verification.

Native graph, offline-merge, migration, and catalog parser tests use Swift Testing. Native build and verification instructions are in [apple/README.md](apple/README.md).

The web stack is React and TypeScript, Vite, Fastify, better-sqlite3, and a small Python bridge to `ytmusicapi`. The local server serves both the built UI and JSON API. Native clients use SwiftUI, AVFoundation, CloudKit, and a Foundation-only catalog client; they do not require the web server or Python. Nix inputs and Python dependencies are pinned through `flake.lock`; npm dependencies are pinned in `package-lock.json`, and the Swift dependency is pinned in `apple/Package.resolved` and `apple/project.yml`. A scoped minimatch override keeps the TypeScript lint parser's dependency patched until its upstream dependency range catches up.

# Setwise

A local music player where tags connect your library. Add YouTube or YouTube Music song links, enter their titles and artists, and organize music through tags that can include other tags.

## Run locally

From the project directory, enter the pinned Nix development environment:

```sh
nix --extra-experimental-features 'nix-command flakes' develop path:.
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3210**. Keep the server running while using the app. Stop it with Ctrl+C.

The `path:.` flake reference includes newly created files without staging them in Git. The shell supports macOS and Linux. On Windows, use Node.js 24 or newer with npm, then run the same npm commands from the project directory; Nix is not required at runtime. If a native SQLite binary is unavailable for your system, its installation needs platform C++ build tools and Python. The Nix shell provisions these tools on Linux; on macOS, install Apple's Command Line Tools if a source build is needed.

For development:

```sh
npm run dev
```

Open **http://127.0.0.1:5173**. Vite reloads the interface, proxies API requests to the local server, and the server restarts when its source changes. Both servers bind only to loopback. Ports 3210 and 5173 must be available.

## How tags work

- Add a song using its YouTube/YouTube Music URL, title, and at least one artist. Enter multiple artists on separate lines. Each artist automatically receives a tag; an existing tag with the same name is reused. Duplicate video links open the existing song instead of creating another copy.
- Click a song title to edit its details, assign existing tags, or create a tag directly on the song. Play a song with its numbered play button, or play the selected collection in title order.
- Create tags with **New tag** or the **+** beside Your Library. Select a tag and choose **Edit tag** to rename it, pin it, or connect parent and child tags.
- A parent contains songs assigned directly to it and every song in its children and descendants. For example, making `Daft Punk` a child of `atmosphere` brings all Daft Punk songs into atmosphere. A song can also have atmosphere directly.
- Tags can have several parents. Each song appears once in a collection, even if several paths lead to it. Self-links and indirect loops are rejected.
- Removing a relationship removes only that source of inheritance. Direct assignments and other paths continue to apply. Song details show both direct membership and the child tags responsible for inherited membership.
- Every tag stays visible, including empty tags. A tag with two or more distinct songs is an automatic playlist; a tag with one song is also playable. The playlist is a view of the tag, so membership and names stay current automatically.
- Pinned tags appear first; both pinned and remaining tags are sorted alphabetically. Search tags or search songs within the current collection.
- Deleting a tag removes its assignments and relationships, while preserving songs, artist credits, and other tags. Children are not reconnected to the deleted tag's parents. Deleting a song preserves its tags for reuse.

Artist credits and tag names are separate. Renaming an artist tag changes the collection name, not song credits. Editing a song's artist list rebuilds its artist-generated assignments while preserving manual assignments. Deleting an artist tag does not recreate it on page load or title-only edits; changing the artist list may recreate it.

## Playback

Playback uses the visible YouTube embedded player, with play/pause, previous/next, seeking, volume, shuffle, and repeat off/all/one. The player remains mounted while navigating the library. A collection starts a snapshot queue; later tag edits apply the next time you play the collection. Deleting a song removes it from the active queue. Queues and playback position are not saved across page reloads.

Internet access is required for playback. YouTube may show ads or restrict videos by region, availability, account requirements, or embedding settings. Unavailable songs show Retry and Skip controls. Failed songs are skipped in subsequent queue navigation; exhausting the playable queue stops playback. Browser autoplay restrictions may require pressing Play or using the embedded player directly.

The app does not sign in to YouTube, synchronize account playlists, search the YouTube catalog, download audio, or offer offline playback. No API key is needed. Library management and local search work without internet access; playback contacts YouTube. Browsers may limit background or locked-screen playback.

## Data and backup

The server stores the library in **`data/library.sqlite`**, relative to the project directory. It is excluded from Git along with SQLite's companion files. Keep this directory when updating the app. The server applies versioned database migrations on startup.

To back up, stop the server cleanly with Ctrl+C and copy `data/library.sqlite` to a safe location. To restore, stop the server and restore that file into the data directory. Do not replace the database while the app is running. A live SQLite database may also have `-wal` and `-shm` files; copying just the main file while running is not a reliable backup.

Set `SETWISE_DB` to use another database location. Relative paths resolve from the directory where the server starts. Do not expose the server through a public proxy: this version has no accounts or authentication and is intended for one person on one computer.

## Development checks

Run inside the Nix shell, or with Node.js 24+ and npm on Windows:

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Tests exercise the actual SQLite library and Fastify API, and test queue behavior and player commands with a mock YouTube player. Real video playback, browser autoplay, keyboard interaction, and responsive layout need browser verification.

The stack is React and TypeScript, Vite, Fastify, and better-sqlite3. The local server serves both the built UI and the JSON API. Nix inputs are pinned in `flake.lock`; npm dependencies are pinned in `package-lock.json`. A scoped minimatch override keeps the TypeScript lint parser's dependency patched until its upstream dependency range catches up.

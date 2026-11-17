import { Fragment, useEffect, useRef, useState } from 'react';
import type { Library, Song, Tag } from '../../shared/types.js';
import { api, exportLibrary } from './api';
import { Player, type PlayerHandle } from './Player';
import { Modal } from './Modal';
import { SongEditor, TagEditor } from './Editors';
import { ImportSongs } from './ImportSongs';
import { Settings } from './Settings';

type Editor = { kind: 'song' | 'tag' | 'manual'; id?: number };
const emptyLibrary: Library = { songs: [], tags: [], edges: [] };

export function App() {
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const [songs, setSongs] = useState<Song[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [songSearch, setSongSearch] = useState('');
  const [editor, setEditor] = useState<Editor>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const player = useRef<PlayerHandle>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const [transferring, setTransferring] = useState(false);
  const tag = library.tags.find((item) => item.id === selected);
  const refresh = () => setRevision((value) => value + 1);
  const importLibrary = async (file: File) => {
    setTransferring(true);
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error('A library file must be at most 8 MiB.');
      const result = await api<{ imported: number; existing: number }>(
        '/library/import',
        'POST',
        JSON.parse(await file.text()),
      );
      refresh();
      setNotice(
        `Library imported: ${result.imported} new songs; ${result.existing} existing songs preserved.`,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not import this library.',
      );
    } finally {
      setTransferring(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      api<Library>('/library'),
      api<Song[]>(selected === null ? '/songs' : `/songs?tagId=${selected}`),
    ])
      .then(([library, songs]) => {
        if (cancelled) return;
        setLibrary(library);
        setSongs(songs);
        setError('');
        setLoading(false);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [revision, selected]);

  const chooseTag = (id: number | null) => {
    setSelected(id);
    setSongSearch('');
  };
  const filteredTags = library.tags.filter((tag) =>
    tag.name.toLowerCase().includes(tagSearch.toLowerCase()),
  );
  const tagGroups = [
    { label: 'PINNED TAGS', tags: filteredTags.filter((tag) => tag.pinned) },
    {
      label: 'CREATED TAGS',
      tags: filteredTags.filter((tag) => !tag.pinned && !tag.artist),
    },
    {
      label: 'ARTISTS',
      tags: filteredTags.filter((tag) => !tag.pinned && tag.artist),
    },
  ];
  const visibleSongs = songs.filter((song) =>
    `${song.title} ${song.artists.join(' ')}`
      .toLowerCase()
      .includes(songSearch.toLowerCase()),
  );
  const children = library.tags.filter((item) =>
    library.edges.some(
      (edge) => edge.parentId === selected && edge.childId === item.id,
    ),
  );
  const parents = library.tags.filter((item) =>
    library.edges.some(
      (edge) => edge.childId === selected && edge.parentId === item.id,
    ),
  );
  const pin = async () => {
    if (!tag) return;
    try {
      await api(`/tags/${tag.id}`, 'PATCH', { pinned: !tag.pinned });
      refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not pin tag.');
    }
  };
  const tagList = (tags: Tag[]) =>
    tags.map((item) => (
      <button
        key={item.id}
        className={`nav-item ${selected === item.id ? 'selected' : ''}`}
        onClick={() => chooseTag(item.id)}
        title={`${item.name} · ${item.songCount >= 2 ? 'automatic playlist' : 'tag'}`}
      >
        <span className="nav-symbol">{item.pinned ? '↗' : '#'}</span>
        <span className="nav-name">{item.name}</span>
        <span className="nav-count">{item.songCount}</span>
      </button>
    ));

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Library navigation">
        <a
          className="brand"
          href="/"
          aria-label="TagSet home"
          onClick={(event) => {
            event.preventDefault();
            chooseTag(null);
          }}
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          TagSet<span className="brand-period">.</span>
        </a>
        <div className="library-heading">
          <span className="eyebrow">YOUR LIBRARY</span>
          <button
            className="icon-button"
            aria-label="Create tag"
            onClick={() => setEditor({ kind: 'tag' })}
          >
            +
          </button>
        </div>
        <button
          className={`nav-item all-songs ${selected === null ? 'selected' : ''}`}
          onClick={() => chooseTag(null)}
        >
          <span className="nav-symbol">▤</span>
          <span className="nav-name">All songs</span>
          <span className="nav-count">{library.songs.length}</span>
        </button>
        <label className="tag-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Find a tag"
            placeholder="Find a tag"
            value={tagSearch}
            onChange={(event) => setTagSearch(event.target.value)}
          />
        </label>
        <nav className="tag-navigation" aria-label="Tags">
          {tagGroups
            .filter((group) => group.tags.length)
            .map((group) => (
              <Fragment key={group.label}>
                <div className="nav-group-title">
                  {group.label} <span>{group.tags.length}</span>
                </div>
                {tagList(group.tags)}
              </Fragment>
            ))}
          {!filteredTags.length && (
            <p className="sidebar-hint">
              {tagSearch
                ? 'No matching tags.'
                : 'Your artists, genres, and little obsessions will live here.'}
            </p>
          )}
        </nav>
        <button className="new-tag" onClick={() => setEditor({ kind: 'tag' })}>
          <span>+</span> New tag
        </button>
        <button
          className="text-button settings-button"
          onClick={() => setSettingsOpen(true)}
        >
          Settings
        </button>
        <div className="local-label">
          <span className="live-dot" />
          <div>
            Local by design
            <small>Your library. Your device.</small>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        {notice && (
          <div className="notice" role="status">
            {notice}{' '}
            <button className="text-button" onClick={() => setNotice('')}>
              Dismiss
            </button>
          </div>
        )}
        <header className="topbar">
          <div className="breadcrumb">
            Library <span>/</span> <strong>{tag?.name ?? 'All songs'}</strong>
          </div>
          <div className="library-transfer">
            <input
              ref={importFile}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importLibrary(file);
              }}
            />
            <button
              className="text-button"
              disabled={transferring}
              onClick={() => importFile.current?.click()}
            >
              Import library
            </button>
            <button
              className="text-button"
              disabled={transferring}
              onClick={() => {
                setTransferring(true);
                void exportLibrary()
                  .catch((error) =>
                    setError(
                      error instanceof Error
                        ? error.message
                        : 'Could not export the library.',
                    ),
                  )
                  .finally(() => setTransferring(false));
              }}
            >
              Export library
            </button>
          </div>
          <button
            className="primary add-song"
            onClick={() => setEditor({ kind: 'song' })}
          >
            <span>+</span> Add song
          </button>
        </header>
        <section className="collection-header">
          <div className="collection-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <span>{selected === null ? 's' : '#'}</span>
            <i />
          </div>
          <div className="collection-intro">
            <span className="eyebrow">
              {selected === null
                ? 'THE WHOLE COLLECTION'
                : (tag?.songCount ?? 0) >= 2
                  ? 'AUTOMATIC PLAYLIST'
                  : 'TAG COLLECTION'}
            </span>
            <h1>{tag?.name ?? 'All songs'}</h1>
            <p>
              {selected === null
                ? 'Every song, a new connection.'
                : 'A collection that grows with your connections.'}
            </p>
            <div className="collection-meta">
              <span>
                {songs.length} {songs.length === 1 ? 'song' : 'songs'}
              </span>
              <span>·</span>
              <span>
                {selected === null
                  ? `${library.tags.length} tags to explore`
                  : `${children.length} child ${children.length === 1 ? 'tag' : 'tags'}`}
              </span>
            </div>
          </div>
        </section>
        <div className="collection-actions">
          <button
            className="primary play-collection"
            disabled={!songs.length || loading}
            onClick={() => player.current?.start(songs, { shuffle: false })}
          >
            ▶ <span>Play collection</span>
          </button>
          <button
            className="play-collection"
            disabled={!songs.length || loading}
            onClick={() => player.current?.start(songs, { shuffle: true })}
          >
            ⤨ <span>Shuffle play</span>
          </button>
          {tag && (
            <>
              <button onClick={() => void pin()} aria-pressed={tag.pinned}>
                {tag.pinned ? '↗ Pinned' : '↗ Pin tag'}
              </button>
              <button onClick={() => setEditor({ kind: 'tag', id: tag.id })}>
                Edit tag
              </button>
            </>
          )}
        </div>
        {tag && (parents.length > 0 || children.length > 0) && (
          <div className="collection-connections">
            {parents.length > 0 && (
              <div>
                <span>ALSO PART OF</span>
                {parents.map((item) => (
                  <button
                    className="chip"
                    key={item.id}
                    onClick={() => chooseTag(item.id)}
                  >
                    # {item.name}
                  </button>
                ))}
              </div>
            )}
            {children.length > 0 && (
              <div>
                <span>INCLUDES</span>
                {children.map((item) => (
                  <button
                    className="chip"
                    key={item.id}
                    onClick={() => chooseTag(item.id)}
                  >
                    # {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="songs-toolbar">
          <h2>{selected === null ? 'Your songs' : 'Songs in this tag'}</h2>
          <input
            className="song-search"
            aria-label="Search songs"
            placeholder="Search this collection…"
            value={songSearch}
            onChange={(event) => setSongSearch(event.target.value)}
          />
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error} <button onClick={refresh}>Try again</button>
          </div>
        )}
        {loading ? (
          <div role="status" className="empty-state">
            <span className="empty-symbol">◎</span>
            <h2>Opening your collection…</h2>
          </div>
        ) : visibleSongs.length > 0 ? (
          <div className="song-table" role="table" aria-label="Songs">
            <div className="song-table-head" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">TITLE / ARTIST</span>
              <span role="columnheader">SOURCE</span>
              <span role="columnheader" className="sr-only">
                Actions
              </span>
            </div>
            {visibleSongs.map((song, index) => (
              <div className="song-row" role="row" key={song.id}>
                <div role="cell">
                  <button
                    className="row-play"
                    aria-label={`Play ${song.title}`}
                    onClick={() => player.current?.start([song])}
                  >
                    <span className="row-index">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="row-play-icon">▶</span>
                  </button>
                </div>
                <div role="cell" className="song-title-cell">
                  <button
                    className="song-name"
                    onClick={() => setEditor({ kind: 'song', id: song.id })}
                  >
                    {song.title}
                  </button>
                  <span className="song-artists">
                    {song.artists.join(' · ')}
                  </span>
                </div>
                <span role="cell" className="source-label">
                  <i /> YouTube
                </span>
                <div role="cell">
                  <button
                    className="icon-button"
                    aria-label={`Edit ${song.title}`}
                    onClick={() => setEditor({ kind: 'song', id: song.id })}
                  >
                    ···
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-symbol">{songSearch ? '⌕' : '♫'}</span>
            <h2>
              {songSearch
                ? 'Nothing here by that name.'
                : selected === null
                  ? 'Good music finds a home here.'
                  : 'Make the first connection.'}
            </h2>
            <p>
              {songSearch
                ? 'Try another song title or artist.'
                : selected === null
                  ? 'Add a song, give it a tag, and start connecting your music.'
                  : 'Add this tag to a song, or connect a child tag to include its music.'}
            </p>
            {!songSearch && (
              <button
                onClick={() =>
                  setEditor({
                    kind: selected === null ? 'song' : 'tag',
                    id: selected ?? undefined,
                  })
                }
              >
                {selected === null
                  ? '+ Add your first song'
                  : 'Connect this tag →'}
              </button>
            )}
          </div>
        )}
        <footer className="library-footer">
          <span className="mini-mark">◎</span> Less sorting. More listening.
        </footer>
      </main>

      <Player ref={player} />
      {settingsOpen && (
        <Modal title="Settings" onClose={() => setSettingsOpen(false)}>
          <Settings onImported={refresh} />
        </Modal>
      )}
      {editor && (
        <Modal
          title={
            editor.kind === 'song' || editor.kind === 'manual'
              ? editor.id === undefined
                ? 'Add a song'
                : 'Song details'
              : editor.id === undefined
                ? 'Create a tag'
                : 'Tag connections'
          }
          onClose={() => setEditor(undefined)}
        >
          {editor.kind === 'song' && editor.id === undefined ? (
            <ImportSongs
              library={library}
              onImported={(id) => {
                refresh();
                setEditor({ kind: 'song', id });
              }}
              onManual={() => setEditor({ kind: 'manual' })}
              onPlaylistImported={(result) => {
                refresh();
                chooseTag(result.tagId);
                setEditor(undefined);
                setNotice(
                  `Playlist imported: ${result.imported} new songs, ${result.existing} existing songs, ${result.skipped} unavailable entries skipped.`,
                );
              }}
            />
          ) : editor.kind === 'song' || editor.kind === 'manual' ? (
            <SongEditor
              key={`song-${editor.id ?? 'new'}`}
              id={editor.id}
              library={library}
              onChange={refresh}
              onCreated={(id) => setEditor({ kind: 'song', id })}
              onOpenTag={(id) => setEditor({ kind: 'tag', id })}
              onDeleted={(id) => {
                player.current?.remove(id);
                setEditor(undefined);
                refresh();
              }}
            />
          ) : editor.id !== undefined &&
            !library.tags.some((tag) => tag.id === editor.id) ? (
            <p className="muted">Loading tag…</p>
          ) : (
            <TagEditor
              key={`tag-${editor.id ?? 'new'}`}
              tag={library.tags.find((tag) => tag.id === editor.id)}
              library={library}
              onChange={refresh}
              onCreated={(id) => setEditor({ kind: 'tag', id })}
              onOpenTag={(id) => setEditor({ kind: 'tag', id })}
              onDeleted={() => {
                if (selected === editor.id) setSelected(null);
                setEditor(undefined);
                refresh();
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

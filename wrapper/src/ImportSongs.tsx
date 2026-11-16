import { useState, type FormEvent } from 'react';
import type {
  CatalogSong,
  Library,
  SongDetails,
  PlaylistImportResult,
} from '../../shared/types.js';
import { api } from './api';
import { AppError } from '../../shared/errors.js';

export function ImportSongs({
  library,
  onImported,
  onManual,
  onPlaylistImported,
}: {
  library: Library;
  onImported(id: number): void;
  onManual(): void;
  onPlaylistImported(result: PlaylistImportResult): void;
}) {
  const [mode, setMode] = useState<'search' | 'link' | 'playlist'>('search');
  const [tagName, setTagName] = useState('');
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [results, setResults] = useState<CatalogSong[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      if (error instanceof AppError && error.songId) onImported(error.songId);
      else
        setError(
          error instanceof Error
            ? error.message
            : 'Could not reach YouTube Music.',
        );
    } finally {
      setBusy(false);
    }
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      setResults([]);
      setSearched(false);
      const tracks = await api<CatalogSong[]>(
        `/catalog/search?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(tracks);
      setSearched(true);
    });
  };
  const importResult = (track: CatalogSong) =>
    void run(async () => {
      const song = await api<SongDetails>('/songs', 'POST', {
        url: `https://music.youtube.com/watch?v=${track.videoId}`,
        title: track.title,
        artists: track.artists,
      });
      onImported(song.id);
    });
  return (
    <>
      <p className="form-intro">
        Search YouTube Music, paste a song link, or import a playlist as a tag.
        Titles, artists, and their tags come along automatically.
      </p>
      <div className="import-modes" role="group" aria-label="How to add music">
        <button
          aria-pressed={mode === 'search'}
          disabled={busy}
          className={mode === 'search' ? 'primary' : ''}
          onClick={() => {
            setMode('search');
            setError('');
          }}
        >
          Search music
        </button>
        <button
          aria-pressed={mode === 'link'}
          disabled={busy}
          className={mode === 'link' ? 'primary' : ''}
          onClick={() => {
            setMode('link');
            setError('');
          }}
        >
          Paste a link
        </button>
        <button
          aria-pressed={mode === 'playlist'}
          disabled={busy}
          className={mode === 'playlist' ? 'primary' : ''}
          onClick={() => {
            setMode('playlist');
            setError('');
          }}
        >
          Import playlist
        </button>
      </div>
      {mode === 'search' ? (
        <>
          <form onSubmit={search}>
            <fieldset disabled={busy}>
              <label>
                Search YouTube Music
                <input
                  required
                  maxLength={200}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Song title, artist, or both…"
                />
              </label>
              <button
                type="submit"
                className="primary"
                disabled={!query.trim()}
              >
                {busy ? 'Working…' : 'Search'}
              </button>
            </fieldset>
          </form>
          {searched && results.length === 0 && (
            <p className="notice" role="status">
              No songs found. Try another title or artist.
            </p>
          )}
          <ul
            className="catalog-results"
            aria-label="YouTube Music search results"
          >
            {results.map((track) => {
              const existing = library.songs.find(
                (song) => song.videoId === track.videoId,
              );
              return (
                <li key={track.videoId}>
                  <div>
                    <strong>{track.title}</strong>
                    <span>{track.artists.join(' · ')}</span>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      existing ? onImported(existing.id) : importResult(track)
                    }
                    aria-label={`${existing ? 'Open' : 'Import'} ${track.title}`}
                  >
                    {existing ? 'In library ↗' : '+ Add'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : mode === 'playlist' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await api<PlaylistImportResult>(
                '/playlists/import',
                'POST',
                { url, ...(tagName.trim() ? { tagName: tagName.trim() } : {}) },
              );
              onPlaylistImported(result);
            });
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Public YouTube Music playlist URL
              <input
                required
                type="url"
                maxLength={2048}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://music.youtube.com/playlist?list=…"
              />
            </label>
            <label>
              Tag name <span className="field-hint">optional</span>
              <input
                maxLength={200}
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder="Use the playlist title"
              />
            </label>
            <p className="field-note">
              Songs are added to this tag. Existing songs and tags are reused;
              your edits are preserved. Unavailable tracks are skipped.
              Reimporting adds songs without removing existing assignments.
            </p>
            <button className="primary">
              {busy ? 'Importing playlist…' : 'Import as tag'}
            </button>
          </fieldset>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const song = await api<SongDetails>('/songs/import', 'POST', {
                url,
              });
              onImported(song.id);
            });
          }}
        >
          <fieldset disabled={busy}>
            <label>
              YouTube / YouTube Music song URL
              <input
                required
                type="url"
                maxLength={2048}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://music.youtube.com/watch?v=…"
              />
            </label>
            <button className="primary" type="submit">
              {busy ? 'Importing…' : 'Import song'}
            </button>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="field-note" role="status">
          Connecting to YouTube Music…
        </p>
      )}
      <p className="field-note import-footer">
        Can’t find the right details?{' '}
        <button disabled={busy} className="text-button" onClick={onManual}>
          Enter them manually
        </button>
      </p>
    </>
  );
}

import { useState, type FormEvent } from 'react';
import type { CatalogSong, Library, SongDetails } from '../shared/types.js';
import { api, ApiError } from './api';

export function ImportSongs({
  library,
  onImported,
  onManual,
}: {
  library: Library;
  onImported(id: number): void;
  onManual(): void;
}) {
  const [mode, setMode] = useState<'search' | 'link'>('search');
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
      if (error instanceof ApiError && error.songId) onImported(error.songId);
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
        Find a song on YouTube Music or paste a link. Titles, artists, and their
        tags come along automatically.
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

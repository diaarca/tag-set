import { useTranslation } from './Preferences';
import { useState, type FormEvent } from 'react';
import type {
  CatalogSong,
  Library,
  SongDetails,
  PlaylistImportResult,
} from '../../shared/types.js';
import { api } from './api';
import { TrackCover } from './CoverImage';
import { AppError } from '../../shared/errors.js';

export function ImportSongs({
  library,
  onAdded,
  onImported,
  onManual,
  onPlaylistImported,
}: {
  library: Library;
  onAdded(): void;
  onImported(id: number): void;
  onManual(): void;
  onPlaylistImported(result: PlaylistImportResult): void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'search' | 'link' | 'playlist'>('search');
  const [tagName, setTagName] = useState('');
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [results, setResults] = useState<CatalogSong[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const libraryVideoIds = new Set(library.songs.map((song) => song.videoId));
  const availableResults = results.filter(
    (track) => !libraryVideoIds.has(track.videoId),
  );

  const run = async (action: () => Promise<void>, onDuplicate = onImported) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      if (error instanceof AppError && error.songId) onDuplicate(error.songId);
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
      await api('/songs', 'POST', {
        url: `https://music.youtube.com/watch?v=${track.videoId}`,
        title: track.title,
        artists: track.artists,
      });
      onAdded();
    }, onAdded);
  return (
    <>
      <p className="form-intro">
        {t(
          'Search YouTube Music, paste a song link, or import a playlist as a tag. Titles, artists, and their tags come along automatically.',
        )}
      </p>
      <div
        className="import-modes"
        role="group"
        aria-label={t('How to add music')}
      >
        <button
          aria-pressed={mode === 'search'}
          disabled={busy}
          className={mode === 'search' ? 'primary' : ''}
          onClick={() => {
            setMode('search');
            setError('');
          }}
        >
          {t('Search music')}
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
          {t('Paste a link')}
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
          {t('Import playlist')}
        </button>
      </div>
      {mode === 'search' ? (
        <>
          <form onSubmit={search}>
            <fieldset disabled={busy}>
              <label>
                {t('Search YouTube Music')}
                <input
                  required
                  maxLength={200}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('Song title, artist, or both…')}
                />
              </label>
              <button
                type="submit"
                className="primary"
                disabled={!query.trim()}
              >
                {busy ? t('Working…') : t('Search')}
              </button>
            </fieldset>
          </form>
          {searched && availableResults.length === 0 && (
            <p className="notice" role="status">
              {results.length
                ? t('All matching songs are already in your library.')
                : t('No songs found. Try another title or artist.')}
            </p>
          )}
          <ul
            className="catalog-results"
            aria-label={t('YouTube Music search results')}
          >
            {availableResults.map((track) => (
              <li key={track.videoId}>
                <div className="track-info">
                  <TrackCover videoId={track.videoId} />
                  <div className="track-details">
                    <strong>{track.title}</strong>
                    <span>{track.artists.join(' · ')}</span>
                  </div>
                </div>
                <button
                  disabled={busy}
                  onClick={() => importResult(track)}
                  aria-label={t('{0} {1}', t('Import'), track.title)}
                >
                  {t('+ Add')}
                </button>
              </li>
            ))}
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
              {t('Public YouTube Music playlist URL')}
              <input
                required
                type="url"
                maxLength={2048}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t('https://music.youtube.com/playlist?list=…')}
              />
            </label>
            <label>
              {t('Tag name ')}
              <span className="field-hint">{t('optional')}</span>
              <input
                maxLength={200}
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder={t('Use the playlist title')}
              />
            </label>
            <p className="field-note">
              {t(
                'Songs are added to this tag. Existing songs and tags are reused; your edits are preserved. Unavailable tracks are skipped. Reimporting adds songs without removing existing assignments.',
              )}
            </p>
            <button className="primary">
              {busy ? t('Importing playlist…') : t('Import as tag')}
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
              {t('YouTube / YouTube Music song URL')}
              <input
                required
                type="url"
                maxLength={2048}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t('https://music.youtube.com/watch?v=…')}
              />
            </label>
            <button className="primary" type="submit">
              {busy ? t('Importing…') : t('Import song')}
            </button>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
      {busy && (
        <p className="field-note" role="status">
          {t('Connecting to YouTube Music…')}
        </p>
      )}
      <p className="field-note import-footer">
        {t('Can’t find the right details?')}{' '}
        <button disabled={busy} className="text-button" onClick={onManual}>
          {t('Enter them manually')}
        </button>
      </p>
    </>
  );
}

import { useState } from 'react';
import { api } from './api';
import { usePreferences, useTranslation } from './Preferences';
import { GitHubSharing } from './GitHubSharing';
import { LibraryLocation } from './LibraryLocation';
import { nativeAudio } from './host';

export function Settings({
  onImported,
  onLibraryChanged,
  libraryVersion,
}: {
  onImported(): void;
  onLibraryChanged(): void;
  libraryVersion: number;
}) {
  const { t } = useTranslation();
  const { preferences, busy, error, save } = usePreferences();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetDone, setResetDone] = useState(false);
  const reset = async () => {
    setResetting(true);
    setResetError('');
    try {
      await api('/library', 'DELETE');
      onLibraryChanged();
      setConfirmReset(false);
      setResetDone(true);
    } catch (error) {
      setResetError(
        error instanceof Error
          ? error.message
          : 'The library could not be reset.',
      );
    } finally {
      setResetting(false);
    }
  };
  return (
    <>
      <section className="editor-section settings-section">
        <label>
          {t('Language')}
          <select
            aria-label={t('Language')}
            value={preferences.language}
            disabled={busy}
            onChange={(event) =>
              void save({
                ...preferences,
                language: event.target.value as 'en' | 'fr',
              })
            }
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </label>
      </section>
      <section className="editor-section settings-section">
        <h3>{t('Playback')}</h3>
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={preferences.normalizeVolume}
            disabled={busy || (!window.tagsetHost && !nativeAudio)}
            onChange={(event) =>
              void save({
                ...preferences,
                normalizeVolume: event.target.checked,
              })
            }
          />
          {t('Automatic loudness normalization')}
        </label>
        <p className="field-note">
          {t(
            'Reduce loud tracks using YouTube loudness metadata. Quiet tracks are not amplified; tracks without metadata keep their usual volume.',
          )}
        </p>
      </section>
      <section className="editor-section">
        <h3>{t('Library visibility')}</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get(
              'minimumArtistSongs',
            );
            void save({ ...preferences, minimumArtistSongs: Number(value) });
          }}
        >
          <fieldset disabled={busy}>
            <label>
              {t('Minimum songs for unpinned artist tags')}
              <input
                key={preferences.minimumArtistSongs}
                aria-label={t('Minimum songs for unpinned artist tags')}
                name="minimumArtistSongs"
                type="number"
                min="0"
                max="50000"
                step="1"
                required
                defaultValue={preferences.minimumArtistSongs}
              />
            </label>
            <p className="field-note">
              {t(
                'Zero shows every artist tag. Pinned tags and created tags are always shown. Hidden tags remain available in editors and keep their songs.',
              )}
            </p>
            <button>{t('Save visibility')}</button>
          </fieldset>
        </form>
      </section>
      <LibraryLocation onChanged={onLibraryChanged} />
      <GitHubSharing
        key={`${preferences.githubRepository}/${preferences.githubBranch}/${libraryVersion}`}
        onImported={onImported}
      />
      <section className="editor-section library-reset">
        <h3>{t('Reset library')}</h3>
        <p className="field-note">
          {t(
            'Remove all songs and tags from the selected library. Settings and credentials are kept.',
          )}
        </p>
        <fieldset disabled={resetting}>
          {confirmReset ? (
            <div className="notice" role="alert">
              <p>
                {t(
                  'This cannot be undone. Export a backup first if needed. The selected library file will be emptied, including in a cloud-synced folder. GitHub is only changed by a manual push.',
                )}
              </p>
              <div className="button-row">
                <button type="button" onClick={() => void reset()}>
                  {t('Delete all songs and tags')}
                </button>
                <button type="button" onClick={() => setConfirmReset(false)}>
                  {t('Cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirmReset(true);
                setResetDone(false);
              }}
            >
              {t('Reset library')}
            </button>
          )}
        </fieldset>
        {resetDone && (
          <p className="notice" role="status">
            {t('Library reset.')}
          </p>
        )}
        {resetError && (
          <p className="notice error" role="alert">
            {t(resetError)}
          </p>
        )}
      </section>
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
    </>
  );
}

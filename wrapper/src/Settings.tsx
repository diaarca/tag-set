import { usePreferences, useTranslation } from './Preferences';
import { GitHubSharing } from './GitHubSharing';

export function Settings({ onImported }: { onImported(): void }) {
  const { t } = useTranslation();
  const { preferences, busy, error, save } = usePreferences();
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
            disabled={busy || !window.tagsetHost}
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
        {!window.tagsetHost && (
          <p className="field-note">
            {t(
              'Unavailable on iOS with the current player. Use the device volume controls.',
            )}
          </p>
        )}
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
      <GitHubSharing
        key={`${preferences.githubRepository}/${preferences.githubBranch}`}
        onImported={onImported}
      />
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
    </>
  );
}

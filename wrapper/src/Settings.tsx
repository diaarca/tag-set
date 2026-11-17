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

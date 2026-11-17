import { usePreferences } from './Preferences';

export function Settings() {
  const { preferences, busy, error, save } = usePreferences();
  return (
    <>
      <section className="editor-section settings-section">
        <h3>Playback</h3>
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
          Automatic loudness normalization
        </label>
        <p className="field-note">
          Reduce loud tracks using YouTube loudness metadata. Quiet tracks are
          not amplified; tracks without metadata keep their usual volume.
        </p>
        {!window.tagsetHost && (
          <p className="field-note">
            Unavailable on iOS with the current player. Use the device volume
            controls.
          </p>
        )}
      </section>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

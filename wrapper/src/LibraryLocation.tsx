import { useEffect, useState } from 'react';
import { api } from './api';
import { request } from './host';
import { LibraryStore } from './library';
import { useTranslation } from './Preferences';

interface Location {
  path: string;
  isDefault: boolean;
}
interface Selection {
  token: string;
  path: string;
  data: string | null;
}

export function LibraryLocation({ onChanged }: { onChanged(): void }) {
  const { t } = useTranslation();
  const [location, setLocation] = useState<Location>();
  const [selection, setSelection] = useState<Selection>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    void request('libraryLocation')
      .then((value) => {
        if (!cancelled) setLocation(value as Location);
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      void request('cancelLibraryLocation').catch(() =>
        console.error('Could not release the pending library folder.'),
      );
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'The library folder could not be changed.',
      );
    } finally {
      setBusy(false);
    }
  };
  const activate = async (value: Selection) => {
    await api('/library/location', 'PUT', {
      token: value.token,
      library: value.data,
    });
    setSelection(undefined);
    onChanged();
    setLocation((await request('libraryLocation')) as Location);
    setNotice('Library folder updated.');
  };
  const choose = async (
    operation: 'chooseLibraryFolder' | 'defaultLibraryFolder',
  ) => {
    setSelection(undefined);
    const value = (await request(operation)) as Selection | null;
    if (!value) return;
    if (value.data !== null) {
      new LibraryStore(JSON.parse(value.data));
      setSelection(value);
    } else await activate(value);
  };
  return (
    <section className="editor-section library-location">
      <h3>{t('Library folder')}</h3>
      {location && <p className="field-note library-path">{location.path}</p>}
      <p className="field-note">
        {t(
          'Choose a local or cloud-synced folder. TagSet reads and writes library.json there; settings and credentials stay on this device. GitHub pull and push use the selected library.',
        )}
      </p>
      <fieldset disabled={busy}>
        <div className="button-row">
          <button
            type="button"
            onClick={() => void run(() => choose('chooseLibraryFolder'))}
          >
            {t('Choose library folder')}
          </button>
          {(!location || !location.isDefault) && (
            <button
              type="button"
              onClick={() => void run(() => choose('defaultLibraryFolder'))}
            >
              {t('Use default folder')}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                await api('/library/reload', 'POST');
                onChanged();
                setNotice('Library reloaded.');
              })
            }
          >
            {t('Reload library')}
          </button>
        </div>
        {selection && (
          <div className="notice" role="alert">
            <p>
              {t(
                'A library already exists in this folder. Replace the current library with it? The previous file will be kept in its original folder.',
              )}
            </p>
            <p className="library-path">{selection.path}</p>
            <div className="button-row">
              <button
                type="button"
                onClick={() => void run(() => activate(selection))}
              >
                {t('Replace current library')}
              </button>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await request('cancelLibraryLocation');
                    setSelection(undefined);
                  })
                }
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        )}
      </fieldset>
      <p className="field-note">
        {t(
          'Wait for your cloud provider to finish syncing before opening another device. Reload to read external changes; avoid editing on two devices at once.',
        )}
      </p>
      {busy && (
        <p className="field-note" role="status">
          {t('Working…')}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
    </section>
  );
}

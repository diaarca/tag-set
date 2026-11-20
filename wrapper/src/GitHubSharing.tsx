import { useEffect, useState } from 'react';
import { api } from './api';
import { request } from './host';
import { usePreferences, useTranslation } from './Preferences';

export function GitHubSharing({ onImported }: { onImported(): void }) {
  const { t } = useTranslation();
  const { preferences, busy: saving, save } = usePreferences();
  const [repository, setRepository] = useState(preferences.githubRepository);
  const [branch, setBranch] = useState(preferences.githubBranch);
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sha, setSha] = useState<string | null>();
  const [replacementSha, setReplacementSha] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void request('hasGitHubToken')
      .then((value) => {
        if (!cancelled) setHasToken(value === true);
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
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
        error instanceof Error ? error.message : 'GitHub operation failed.',
      );
    } finally {
      setBusy(false);
    }
  };
  const config = {
    repository: preferences.githubRepository,
    branch: preferences.githubBranch,
  };
  const changed =
    repository.trim() !== config.repository ||
    branch.trim() !== config.branch ||
    !!token;
  const disabled = busy || saving || changed || !hasToken || !config.repository;
  const push = async (previous: string | null) => {
    setReplacementSha(undefined);
    setSha(undefined);
    const result = (await request('githubPush', {
      ...config,
      sha: previous,
      data: JSON.stringify(await api('/library/export')),
    })) as { sha: string };
    setSha(result.sha);
    setNotice('Library pushed to GitHub.');
  };
  return (
    <section className="editor-section">
      <h3>{t('GitHub library sharing')}</h3>
      <p className="field-note">
        {t(
          'Use your own initialized repository and a fine-grained token with Contents read/write permission for that repository. A private repository keeps your library private.',
        )}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const next = globalThis.tagsetProtocol.validateGitHubConfig({
              repository: repository.trim(),
              branch: branch.trim(),
            });
            if (token) {
              await request('saveGitHubToken', token.trim());
              setToken('');
              setHasToken(true);
            }
            setSha(undefined);
            setReplacementSha(undefined);
            await save({
              ...preferences,
              githubRepository: next.repository,
              githubBranch: next.branch,
            });
          });
        }}
      >
        <fieldset disabled={busy || saving}>
          <label>
            {t('Repository')}
            <input
              aria-label={t('GitHub repository')}
              placeholder={t('owner/repo')}
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              required
              maxLength={140}
            />
          </label>
          <label>
            {t('Branch')}
            <input
              aria-label={t('GitHub branch')}
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label>
            {t('Personal access token')}
            <input
              aria-label={t('GitHub token')}
              type="password"
              autoComplete="off"
              placeholder={
                hasToken
                  ? t('Token saved; leave blank to keep it')
                  : t('GitHub token')
              }
              value={token}
              onChange={(event) => setToken(event.target.value)}
              maxLength={1024}
            />
          </label>
          <button type="submit">{t('Save connection')}</button>
          {hasToken && (
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await request('removeGitHubToken');
                  setHasToken(false);
                  setSha(undefined);
                  setReplacementSha(undefined);
                  setToken('');
                })
              }
            >
              {t('Forget token')}
            </button>
          )}
        </fieldset>
      </form>
      <p className="field-note">
        {t(
          'Pull merges songs and tags into this device’s library and may restore deleted items. Push sends this device’s current library, including deletions.',
        )}
      </p>
      <div className="button-row">
        <button
          disabled={disabled}
          onClick={() =>
            void run(async () => {
              setReplacementSha(undefined);
              setSha(undefined);
              const remote = (await request('githubPull', config)) as {
                data: string | null;
                sha: string | null;
              };
              if (remote.data !== null) {
                await api('/library/import', 'POST', JSON.parse(remote.data));
                onImported();
              }
              setSha(remote.sha);
              setNotice(
                remote.data === null
                  ? 'No shared library yet. Push to create it.'
                  : 'Library pulled. Local edits were preserved.',
              );
            })
          }
        >
          {t('Pull from GitHub')}
        </button>
        <button
          disabled={disabled || replacementSha !== undefined}
          onClick={() =>
            void run(async () => {
              if (sha !== undefined) {
                await push(sha);
                return;
              }
              const remote = (await request('githubPull', config)) as {
                sha: string | null;
              };
              if (remote.sha === null) await push(null);
              else setReplacementSha(remote.sha);
            })
          }
        >
          {t('Push to GitHub')}
        </button>
      </div>
      {replacementSha !== undefined && (
        <div className="notice" role="alert">
          <p>
            {t(
              'Replace the GitHub library with this device’s library? Songs and tags found only on GitHub will be removed from the shared file.',
            )}
          </p>
          <div className="button-row">
            <button
              disabled={disabled}
              onClick={() => void run(() => push(replacementSha))}
            >
              {t('Replace GitHub library')}
            </button>
            <button onClick={() => setReplacementSha(undefined)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
      {busy && (
        <p role="status" className="field-note">
          {t('Working…')}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {t(notice)}
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {t(error)}
        </p>
      )}
    </section>
  );
}

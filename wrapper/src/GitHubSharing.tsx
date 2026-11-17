import { useEffect, useState } from 'react';
import { api } from './api';
import { request } from './host';
import { usePreferences } from './Preferences';

export function GitHubSharing({ onImported }: { onImported(): void }) {
  const { preferences, busy: saving, save } = usePreferences();
  const [repository, setRepository] = useState(preferences.githubRepository);
  const [branch, setBranch] = useState(preferences.githubBranch);
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sha, setSha] = useState<string | null>();
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
  return (
    <section className="editor-section">
      <h3>GitHub library sharing</h3>
      <p className="field-note">
        Use your own initialized repository and a fine-grained token with
        Contents read/write permission for that repository. A private repository
        keeps your library private.
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
            Repository
            <input
              aria-label="GitHub repository"
              placeholder="owner/repo"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              required
              maxLength={140}
            />
          </label>
          <label>
            Branch
            <input
              aria-label="GitHub branch"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label>
            Personal access token
            <input
              aria-label="GitHub token"
              type="password"
              autoComplete="off"
              placeholder={
                hasToken
                  ? 'Token saved; leave blank to keep it'
                  : 'GitHub token'
              }
              value={token}
              onChange={(event) => setToken(event.target.value)}
              maxLength={1024}
            />
          </label>
          <button type="submit">Save connection</button>
          {hasToken && (
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await request('removeGitHubToken');
                  setHasToken(false);
                  setSha(undefined);
                  setToken('');
                })
              }
            >
              Forget token
            </button>
          )}
        </fieldset>
      </form>
      <p className="field-note">
        Pull merges additions and keeps local edits. Deletions do not propagate.
        Push publishes your current library as tagset-library.json. Pull before
        pushing in each session; newer remote changes are rejected.
      </p>
      <div className="button-row">
        <button
          disabled={
            busy || saving || changed || !hasToken || !config.repository
          }
          onClick={() =>
            void run(async () => {
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
          Pull from GitHub
        </button>
        <button
          disabled={busy || saving || changed || !hasToken || sha === undefined}
          onClick={() =>
            void run(async () => {
              const previous = sha;
              setSha(undefined);
              const result = (await request('githubPush', {
                ...config,
                sha: previous,
                data: JSON.stringify(await api('/library/export')),
              })) as { sha: string };
              setSha(result.sha);
              setNotice('Library pushed to GitHub.');
            })
          }
        >
          Push to GitHub
        </button>
      </div>
      {busy && (
        <p role="status" className="field-note">
          Working…
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </section>
  );
}

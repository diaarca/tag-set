import '../protocol.js';
import { libraryText, maxLibraryBytes } from './storage.mjs';

export function createGitHubClient(readToken, fetcher = fetch) {
  const call = async (path, options = {}, allowMissing = false) => {
    const token = await readToken();
    if (!token) throw new Error('Save a GitHub token first.');
    const response = await fetcher(`https://api.github.com${path}`, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/vnd.github.object+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (response.status === 404 && allowMissing) return null;
    if (!response.ok) {
      if ([409, 422].includes(response.status))
        throw new Error(
          'GitHub rejected the update. Pull again before pushing; check branch permissions.',
        );
      throw new Error(
        `GitHub request failed (${response.status}). Check the repository, branch, token, and its Contents permission.`,
      );
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > 12 * 1024 * 1024)
      throw new Error('GitHub response is too large.');
    return JSON.parse(text);
  };
  const config = (value) => {
    const { repository, branch } =
      globalThis.tagsetProtocol.validateGitHubConfig(value);
    return { path: `/repos/${repository}`, branch };
  };
  return {
    async pull(value) {
      const { path, branch } = config(value);
      await call(`${path}/branches/${encodeURIComponent(branch)}`);
      const file = await call(
        `${path}/contents/tagset-library.json?ref=${encodeURIComponent(branch)}`,
        {},
        true,
      );
      if (!file) return { data: null, sha: null };
      if (
        file.type !== 'file' ||
        typeof file.size !== 'number' ||
        file.size > maxLibraryBytes ||
        !/^[a-f0-9]{40}$/.test(file.sha)
      )
        throw new Error('Invalid shared library file.');
      const blob =
        file.encoding === 'base64'
          ? file
          : await call(`${path}/git/blobs/${file.sha}`);
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string')
        throw new Error('Invalid GitHub library response.');
      const bytes = Buffer.from(blob.content, 'base64');
      const data = libraryText(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
      return { data, sha: file.sha };
    },
    async push(value, data, sha) {
      const { path, branch } = config(value);
      if (
        sha !== null &&
        (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha))
      )
        throw new Error('Pull before pushing.');
      const result = await call(`${path}/contents/tagset-library.json`, {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Update TagSet library',
          branch,
          content: Buffer.from(libraryText(data)).toString('base64'),
          ...(sha ? { sha } : {}),
        }),
      });
      if (!/^[a-f0-9]{40}$/.test(result?.content?.sha))
        throw new Error(
          'GitHub did not confirm the library update. Pull before pushing again.',
        );
      return { sha: result.content.sha };
    },
  };
}

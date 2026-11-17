import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../wrapper/desktop/github.mjs';

test('GitHub sharing reads libraries and rejects a push when the remote revision changed', async () => {
  let sha = 'a'.repeat(40),
    written;
  const data = JSON.stringify({
    version: 1,
    songs: [],
    tags: [],
    edges: [],
    assignments: [],
  });
  const client = createGitHubClient(
    async () => 'unit-test',
    async (url, options) => {
      assert.equal(new URL(url).origin, 'https://api.github.com');
      assert.equal(options.redirect, 'error');
      if (url.includes('/branches/')) return Response.json({});
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body);
        if (body.sha !== sha) return new Response(null, { status: 409 });
        written = Buffer.from(body.content, 'base64').toString();
        sha = 'c'.repeat(40);
        return Response.json({ content: { sha } });
      }
      return Response.json({
        type: 'file',
        size: data.length,
        sha,
        encoding: 'base64',
        content: Buffer.from(data).toString('base64'),
      });
    },
  );
  const config = { repository: 'example/library', branch: 'main' };
  const remote = await client.pull(config);
  assert.equal(remote.data, data);
  sha = 'b'.repeat(40);
  await assert.rejects(client.push(config, data, remote.sha), /Pull again/);
  assert.equal(written, undefined);
  const latest = await client.pull(config);
  assert.equal(
    (await client.push(config, data, latest.sha)).sha,
    'c'.repeat(40),
  );
  assert.equal(written, data);
  await assert.rejects(
    client.pull({ repository: '../private', branch: 'main' }),
    /repository/,
  );
});

test('GitHub sharing distinguishes a missing file from an inaccessible branch and reads large blobs by SHA', async () => {
  const config = { repository: 'example/library', branch: 'main' };
  const missing = createGitHubClient(
    async () => 'unit-test',
    async (url) =>
      url.includes('/branches/')
        ? Response.json({})
        : new Response(null, { status: 404 }),
  );
  assert.deepEqual(await missing.pull(config), { data: null, sha: null });
  const denied = createGitHubClient(
    async () => 'unit-test',
    async () => new Response(null, { status: 404 }),
  );
  await assert.rejects(denied.pull(config), /404/);
  const data = JSON.stringify({ version: 1 });
  const large = createGitHubClient(
    async () => 'unit-test',
    async (url) => {
      if (url.includes('/branches/')) return Response.json({});
      if (url.includes('/git/blobs/'))
        return Response.json({
          encoding: 'base64',
          content: Buffer.from(data).toString('base64'),
        });
      return Response.json({
        type: 'file',
        size: 2 * 1024 * 1024,
        sha: 'a'.repeat(40),
        encoding: 'none',
      });
    },
  );
  assert.equal((await large.pull(config)).data, data);
});

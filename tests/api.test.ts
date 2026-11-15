import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LibraryStore } from '../server/database.js';
import { createApp } from '../server/app.js';

test('API supports the library workflow and returns actionable input and conflict errors', async (t) => {
  const store = new LibraryStore(':memory:');
  const app = createApp(store);
  t.after(async () => {
    await app.close();
    store.close();
  });
  const input = {
    url: 'https://music.youtube.com/watch?v=abcdefghijk&list=ignored',
    title: 'A song',
    artists: ['An artist'],
  };
  const added = await app.inject({
    method: 'POST',
    url: '/api/songs',
    payload: input,
  });
  assert.equal(added.statusCode, 201);
  const songId = added.json().id as number;
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/songs',
    payload: { ...input, url: 'https://youtu.be/abcdefghijk' },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().songId, songId);
  for (const url of [
    'https://youtube.com.evil.test/watch?v=abcdefghijk',
    'https://evil.test/abcdefghijk',
    'https://youtube.com/playlist?list=abcdefghijk',
    'file:///abcdefghijk',
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/songs',
          payload: { ...input, url },
        })
      ).statusCode,
      400,
    );
  }
  for (const payload of [
    null,
    {},
    { ...input, title: '  ' },
    { ...input, artists: [] },
    { ...input, artists: [42] },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/songs',
          payload: JSON.stringify(payload),
          headers: { 'content-type': 'application/json' },
        })
      ).statusCode,
      400,
    );
  }
  assert.equal((await app.inject('/api/songs/-1')).statusCode, 400);
  assert.equal((await app.inject('/api/songs/9999')).statusCode, 404);
  const tag = await app.inject({
    method: 'POST',
    url: '/api/tags',
    payload: { name: 'Mood' },
  });
  const tagId = tag.json().id as number;
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/songs/${songId}/tags/${tagId}`,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await app.inject(`/api/songs?tagId=${tagId}`)).json().length,
    1,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/tags/${tagId}`,
        payload: { name: 'Changed', pinned: 'yes' },
      })
    ).statusCode,
    400,
  );
  assert.equal(store.tags().find((tag) => tag.id === tagId)!.name, 'Mood');
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/tags/${tagId}`,
        payload: { pinned: true },
      })
    ).statusCode,
    204,
  );
  const artistId = store.tags().find((tag) => tag.name === 'An artist')!.id;
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/tags/${tagId}/children/${artistId}`,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/tags/${artistId}/children/${tagId}`,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await app.inject({ method: 'DELETE', url: `/api/tags/${tagId}` }))
      .statusCode,
    204,
  );
  assert.equal(store.songs().length, 1);
});

test('local service rejects hostile hosts, cross-origin mutations and oversized bodies', async (t) => {
  const store = new LibraryStore(':memory:');
  const app = createApp(store);
  t.after(async () => {
    await app.close();
    store.close();
  });
  assert.equal(
    (
      await app.inject({
        url: '/api/library',
        headers: { host: 'attacker.example' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/tags',
        headers: { origin: 'https://attacker.example' },
        payload: { name: 'No' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/tags/1',
        headers: { 'sec-fetch-site': 'cross-site' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/tags',
        headers: { origin: 'http://localhost:5173' },
        payload: { name: 'Okay' },
      })
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/tags',
        payload: { name: 'x'.repeat(40_000) },
      })
    ).statusCode,
    413,
  );
});

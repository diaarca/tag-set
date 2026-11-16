import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { LibraryStore } from '../server/database.js';
import type { MusicCatalog } from '../server/catalog.js';

const first = { videoId: 'abcdefghijk', title: 'First', artists: ['Artist'] };
const second = {
  videoId: 'lmnopqrstuv',
  title: 'Second',
  artists: ['Other Artist'],
};

test('playlist import creates a tag, preserves existing edits, and is additive and idempotent', async (t) => {
  const store = new LibraryStore(':memory:');
  const original = store.saveSong({
    url: `https://youtu.be/${first.videoId}`,
    title: 'My edited title',
    artists: ['My edited artist'],
  });
  const calls: string[] = [];
  const catalog: MusicCatalog = {
    search: async () => [],
    lookup: async () => first,
    playlist: async (id) => {
      calls.push(id);
      return { title: 'Road Trip', tracks: [first, second], skipped: 2 };
    },
  };
  const app = createApp(store, undefined, catalog);
  t.after(async () => {
    await app.close();
    store.close();
  });
  const request = {
    method: 'POST' as const,
    url: '/api/playlists/import',
    payload: { url: 'https://music.youtube.com/playlist?list=PLabcdefghijk' },
  };
  const imported = await app.inject(request);
  assert.equal(imported.statusCode, 200);
  const result = imported.json();
  assert.deepEqual(result, {
    tagId: result.tagId,
    imported: 1,
    existing: 1,
    skipped: 2,
  });
  assert.equal(store.song(original).title, 'My edited title');
  assert.deepEqual(store.song(original).artists, ['My edited artist']);
  assert.equal(
    store.tags().find((tag) => tag.id === result.tagId)!.name,
    'Road Trip',
  );
  assert.equal(store.songs(result.tagId).length, 2);
  assert.deepEqual((await app.inject(request)).json(), {
    ...result,
    imported: 0,
    existing: 2,
  });
  const other = await app.inject({
    ...request,
    payload: { ...request.payload, tagName: 'Another tag' },
  });
  assert.equal(other.statusCode, 200);
  assert.equal(store.songs(other.json().tagId).length, 2);
  assert.equal(
    (
      await app.inject({
        ...request,
        payload: { url: 'https://evil.test/playlist?list=PLabcdefghijk' },
      })
    ).statusCode,
    400,
  );
  assert.equal(calls.length, 3);
  const exported = (await app.inject('/api/library/export')).json();
  assert.equal(exported.version, 1);
  assert.equal(exported.songs.length, 2);
  assert.ok(
    exported.assignments.some(
      (assignment: { origin: string }) => assignment.origin === 'artist',
    ),
  );
  assert.ok(
    exported.assignments.some(
      (assignment: { origin: string }) => assignment.origin === 'manual',
    ),
  );
});

test('playlist writes roll back as a unit, and empty playlists create no tag', (t) => {
  const store = new LibraryStore(':memory:');
  t.after(() => store.close());
  assert.throws(() =>
    store.importPlaylist({
      title: 'Broken',
      tracks: [first, { ...second, title: '' }],
      skipped: 0,
    }),
  );
  assert.deepEqual(store.songs(), []);
  assert.deepEqual(store.tags(), []);
  assert.throws(
    () => store.importPlaylist({ title: 'Empty', tracks: [], skipped: 3 }),
    /no importable songs/,
  );
  assert.deepEqual(store.tags(), []);
});

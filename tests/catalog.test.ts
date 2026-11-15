import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { LibraryStore } from '../server/database.js';
import { catalogSong, type MusicCatalog } from '../server/catalog.js';
import { AppError } from '../server/errors.js';

const track = {
  videoId: 'abcdefghijk',
  title: 'A collaboration',
  artists: ['Artist One', 'Artist Two'],
};

test('catalog search and link import preserve titles, full artist lists and automatic tags', async (t) => {
  const store = new LibraryStore(':memory:');
  const queries: string[] = [];
  const lookups: string[] = [];
  const catalog: MusicCatalog = {
    search: async (query) => {
      queries.push(query);
      return [track];
    },
    lookup: async (videoId) => {
      lookups.push(videoId);
      return track;
    },
  };
  const app = createApp(store, undefined, catalog);
  t.after(async () => {
    await app.close();
    store.close();
  });
  const search = await app.inject(
    '/api/catalog/search?q=%20a%20collaboration%20',
  );
  assert.equal(search.statusCode, 200);
  assert.deepEqual(search.json(), [track]);
  assert.deepEqual(queries, ['a collaboration']);
  assert.equal((await app.inject('/api/catalog/search?q=')).statusCode, 400);
  assert.equal((await app.inject('/api/catalog/search')).statusCode, 400);
  assert.equal(
    (await app.inject(`/api/catalog/search?q=${'x'.repeat(201)}`)).statusCode,
    400,
  );
  const imported = await app.inject({
    method: 'POST',
    url: '/api/songs/import',
    payload: {
      url: `https://music.youtube.com/watch?v=${track.videoId}&list=ignored`,
    },
  });
  assert.equal(imported.statusCode, 201);
  assert.equal(imported.json().title, track.title);
  assert.deepEqual(imported.json().artists, track.artists);
  assert.deepEqual(
    store.tags().map((tag) => tag.name),
    track.artists,
  );
  assert.ok(
    imported
      .json()
      .memberships.every((member: { artist: boolean }) => member.artist),
  );
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/songs/import',
    payload: { url: `https://youtu.be/${track.videoId}` },
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().id, imported.json().id);
  assert.deepEqual(lookups, [track.videoId]);
  assert.equal(store.songs().length, 1);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/songs/import',
        payload: { url: 'https://evil.example/watch?v=abcdefghijk' },
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(lookups, [track.videoId]);
});

test('catalog failures and mismatched songs never create library entries', async (t) => {
  const store = new LibraryStore(':memory:');
  let mismatch = false;
  const catalog: MusicCatalog = {
    search: async () => {
      throw new AppError(503, 'Catalog unavailable');
    },
    lookup: async () => {
      if (mismatch) return { ...track, videoId: 'different12' };
      throw new AppError(503, 'Catalog unavailable');
    },
  };
  const app = createApp(store, undefined, catalog);
  t.after(async () => {
    await app.close();
    store.close();
  });
  assert.equal(
    (await app.inject('/api/catalog/search?q=music')).statusCode,
    503,
  );
  const request = {
    method: 'POST' as const,
    url: '/api/songs/import',
    payload: { url: `https://youtu.be/${track.videoId}` },
  };
  assert.equal((await app.inject(request)).statusCode, 503);
  mismatch = true;
  assert.equal((await app.inject(request)).statusCode, 502);
  assert.deepEqual(store.songs(), []);
  assert.deepEqual(store.tags(), []);
});

test('catalog metadata rejects incomplete credits instead of substituting an uploader', () => {
  assert.deepEqual(catalogSong(track), track);
  for (const invalid of [
    null,
    { ...track, artists: [] },
    { ...track, title: '' },
    { ...track, videoId: 'invalid' },
    { ...track, artists: undefined, author: 'Uploader' },
  ]) {
    assert.throws(
      () => catalogSong(invalid),
      (error: unknown) => error instanceof AppError && error.statusCode === 502,
    );
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LibraryStore } from '../wrapper/src/library.js';
import { LibraryApi, type LibraryHost } from '../wrapper/src/library-api.js';
import { MusicCatalog } from '../wrapper/src/catalog.js';
import { createLibraryStorage } from '../wrapper/desktop/storage.mjs';

const song = (index: number, artists = ['Daft Punk']) => ({
  url: `https://music.youtube.com/watch?v=${String(index).padStart(11, '0')}`,
  title: `Song ${index}`,
  artists,
});
function memoryHost(initial: string | null = null) {
  let value = initial,
    writes = 0,
    fail = false;
  const host: LibraryHost = {
    async read() {
      return value;
    },
    async write(data, previous) {
      if (fail) throw new Error('Disk full');
      assert.equal(previous, value);
      value = data;
      writes++;
    },
  };
  return {
    host,
    get value() {
      return value;
    },
    get writes() {
      return writes;
    },
    set fail(value: boolean) {
      fail = value;
    },
  };
}
const offlineCatalog = new MusicCatalog(async () => {
  throw new Error('Network unavailable');
});

test('bulk edits persist once, validate every song, and preserve the library on write failure', async () => {
  const original = new LibraryStore();
  const first = original.saveSong(song(1));
  const second = original.saveSong(song(2));
  const tagId = original.createTag({ name: 'Focus' });
  const disk = memoryHost(JSON.stringify(original.snapshot()));
  const client = new LibraryApi(disk.host, offlineCatalog);
  const songIds = [first, second, first];
  await client.request('/songs/batch', 'POST', {
    songIds,
    action: 'add-tag',
    tagId,
  });
  assert.equal(disk.writes, 1);
  assert.equal(
    new LibraryStore(JSON.parse(disk.value!)).songs(tagId).length,
    2,
  );
  const before = disk.value;
  for (const body of [
    { songIds: [first, 999], action: 'delete' },
    { songIds: [], action: 'delete' },
    { songIds: [first], action: 'other' },
    { songIds: [first], action: 'remove-tag', tagId: 999 },
    { songIds: [false], action: 'delete' },
  ]) {
    await assert.rejects(client.request('/songs/batch', 'POST', body));
    assert.equal(disk.value, before);
    assert.equal(disk.writes, 1);
  }
  disk.fail = true;
  await assert.rejects(
    client.request('/songs/batch', 'POST', { songIds, action: 'delete' }),
    /Disk full/,
  );
  assert.equal(disk.value, before);
  const restarted = new LibraryApi(disk.host, offlineCatalog);
  disk.fail = false;
  await restarted.request('/songs/batch', 'POST', {
    songIds,
    action: 'remove-tag',
    tagId,
  });
  const removed = new LibraryStore(JSON.parse(disk.value!));
  assert.equal(removed.songs(tagId).length, 0);
  assert.equal(removed.songs().length, 2);
  await restarted.request('/songs/batch', 'POST', {
    songIds,
    action: 'delete',
  });
  const deleted = new LibraryStore(JSON.parse(disk.value!));
  assert.equal(deleted.songs().length, 0);
  assert.equal(deleted.snapshot().assignments.length, 0);
  assert.equal(deleted.tags().length, 2);
});

test('library API serializes writes, persists a restart, and keeps saved data on failed writes', async () => {
  const disk = memoryHost(),
    client = new LibraryApi(disk.host, offlineCatalog);
  await Promise.all(
    ['one', 'two', 'three'].map((name) =>
      client.request('/tags', 'POST', { name }),
    ),
  );
  const saved = new LibraryStore(JSON.parse(disk.value!));
  assert.equal(saved.tags().length, 3);
  const reloaded = new LibraryApi(disk.host, offlineCatalog);
  assert.deepEqual(await reloaded.request('/library'), saved.library());
  disk.fail = true;
  await assert.rejects(client.request('/songs', 'POST', song(1)), /Disk full/);
  assert.equal(disk.writes, 3);
  assert.equal(new LibraryStore(JSON.parse(disk.value!)).songs().length, 0);
  disk.fail = false;
  await assert.rejects(
    client.request('/tags', 'POST', { name: 'four' }),
    /Reopen/,
  );
  assert.equal(disk.writes, 3);
});

test('library import merges without overwriting edits and rejects combined cycles atomically', async () => {
  const original = new LibraryStore();
  const first = original.saveSong(song(1));
  const parent = original.createTag({ name: 'parent' });
  const child = original.createTag({ name: 'child' });
  original.relate(parent, child, true);
  original.assign(first, child, true);
  original.updateTag(parent, { pinned: true });
  const incoming = new LibraryStore(original.exportLibrary());
  incoming.saveSong(
    { ...song(1), title: 'Remote title', artists: ['Another artist'] },
    first,
  );
  incoming.saveSong(song(2));
  const disk = memoryHost(JSON.stringify(original.snapshot()));
  const client = new LibraryApi(disk.host, offlineCatalog);
  await client.request('/library/import', 'POST', incoming.exportLibrary());
  const merged = new LibraryStore(JSON.parse(disk.value!));
  assert.equal(merged.song(first).title, 'Song 1');
  assert.deepEqual(merged.song(first).artists, ['Daft Punk']);
  assert.equal(merged.songs(parent).length, 1);
  assert.equal(merged.tags().find((tag) => tag.id === parent)!.pinned, true);
  const before = disk.value;
  const conflicting = new LibraryStore();
  const a = conflicting.createTag({ name: 'parent' }),
    b = conflicting.createTag({ name: 'child' });
  conflicting.relate(b, a, true);
  await assert.rejects(
    client.request('/library/import', 'POST', conflicting.exportLibrary()),
    /cycle/,
  );
  assert.equal(disk.value, before);
});

test('library reset persists an empty library and preserves saved data if writing fails', async () => {
  const original = new LibraryStore();
  const track = original.saveSong(song(1));
  const parent = original.createTag({ name: 'Pinned' });
  original.updateTag(parent, { pinned: true });
  const child = original.createTag({ name: 'Child' });
  original.relate(parent, child, true);
  original.assign(track, child, true);
  const before = JSON.stringify(original.snapshot());
  const disk = memoryHost(before);
  const client = new LibraryApi(disk.host, offlineCatalog);
  const empty = { songs: [], tags: [], edges: [] };
  assert.deepEqual(await client.request('/library', 'DELETE'), empty);
  assert.deepEqual(JSON.parse(disk.value!), new LibraryStore().snapshot());
  const restarted = new LibraryApi(disk.host, offlineCatalog);
  assert.deepEqual(await restarted.request('/library'), empty);
  await restarted.request('/songs', 'POST', song(2));
  assert.equal(((await restarted.request('/songs')) as unknown[]).length, 1);

  const failing = memoryHost(before);
  failing.fail = true;
  const failedClient = new LibraryApi(failing.host, offlineCatalog);
  await assert.rejects(failedClient.request('/library', 'DELETE'), /Disk full/);
  assert.equal(failing.value, before);
  assert.equal(failing.writes, 0);
});

test('unreadable or newer saved libraries are never replaced with an empty library', async () => {
  for (const raw of ['{broken', '{"version":2}', '{"version":1,"songs":[]}']) {
    const disk = memoryHost(raw),
      client = new LibraryApi(disk.host, offlineCatalog);
    await assert.rejects(client.request('/library'));
    await assert.rejects(client.request('/songs', 'POST', song(1)));
    assert.equal(disk.value, raw);
    assert.equal(disk.writes, 0);
  }
});

test('device JSON storage rejects stale writes and preserves the last complete library', async () => {
  await mkdir('.build', { recursive: true });
  const folder = await mkdtemp(join('.build', 'storage-'));
  try {
    const path = join(folder, 'library.json'),
      storage = createLibraryStorage(path);
    const first = JSON.stringify(new LibraryStore().snapshot());
    assert.equal(await storage.read(), null);
    await storage.write(first, null);
    await assert.rejects(storage.write('{broken', first));
    await assert.rejects(storage.write(first, null), /another window/);
    assert.equal(await readFile(path, 'utf8'), first);
    const client = new LibraryApi(storage, offlineCatalog);
    await client.request('/songs', 'POST', song(1));
    const parent = (await client.request('/tags', 'POST', {
      name: 'Pinned',
    })) as { id: number };
    await client.request(`/tags/${parent.id}`, 'PATCH', { pinned: true });
    await client.request(`/tags/${parent.id}/children/1`, 'PUT');
    const reloaded = new LibraryApi(createLibraryStorage(path), offlineCatalog);
    const snapshot = await reloaded.request('/library');
    assert.deepEqual(
      snapshot,
      new LibraryStore(JSON.parse((await storage.read())!)).library(),
    );
    const restored = new LibraryStore(JSON.parse((await storage.read())!));
    assert.equal(restored.tags()[0].pinned, true);
    assert.equal(restored.songs(parent.id).length, 1);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('library catalog reads complete playlist continuations without importing recommendation rows', async () => {
  const row = (videoId: string, credits = true) => ({
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId },
      flexColumns: [
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: 'Song' }] },
          },
        },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: {
              runs: credits
                ? [
                    {
                      text: 'Artist',
                      navigationEndpoint: {
                        browseEndpoint: { browseId: 'UCartist' },
                      },
                    },
                  ]
                : [],
            },
          },
        },
      ],
    },
  });
  let requests = 0;
  const catalog = new MusicCatalog(async (_endpoint, body) => {
    requests++;
    if (body.browseId)
      return {
        musicResponsiveHeaderRenderer: { title: { simpleText: 'Playlist' } },
        musicPlaylistShelfRenderer: {
          contents: [
            row('abcdefghijk'),
            {
              continuationItemRenderer: {
                continuationEndpoint: {
                  continuationCommand: { token: 'next-page' },
                },
              },
            },
          ],
        },
        nextContinuationData: { continuation: 'recommendations' },
      };
    assert.equal(body.continuation, 'next-page');
    return {
      onResponseReceivedActions: [
        {
          appendContinuationItemsAction: {
            targetId: 'PL123456789',
            continuationItems: [
              row('abcdefghijk'),
              row('lmnopqrstuv'),
              row('00000000000', false),
            ],
          },
        },
      ],
    };
  });
  const playlist = await catalog.playlist('PL123456789');
  assert.equal(requests, 2);
  assert.equal(playlist.tracks.length, 2);
  assert.equal(playlist.skipped, 1);
  const disk = memoryHost(),
    client = new LibraryApi(disk.host, catalog);
  await client.request('/songs', 'POST', {
    url: 'https://youtu.be/abcdefghijk',
    title: 'Edited title',
    artists: ['My artist'],
  });
  const result = await client.request('/playlists/import', 'POST', {
    url: 'https://music.youtube.com/playlist?list=PL123456789',
  });
  assert.deepEqual(result, { tagId: 2, imported: 1, existing: 1, skipped: 1 });
  const library = new LibraryStore(JSON.parse(disk.value!));
  assert.equal(library.song(1).title, 'Edited title');
  assert.deepEqual(library.song(1).artists, ['My artist']);
  assert.equal(
    library.tags().find((tag) => tag.name === 'Playlist')!.songCount,
    2,
  );
  await client.request('/playlists/import', 'POST', {
    url: 'https://music.youtube.com/playlist?list=PL123456789',
  });
  assert.equal(new LibraryStore(JSON.parse(disk.value!)).songs().length, 2);
});

test('catalog imports preserve artist credits and reject failures without saving', async () => {
  const track = {
    videoId: 'abcdefghijk',
    title: 'A collaboration',
    artists: ['First', 'Second'],
  };
  const credits = track.artists.map((text, index) => ({
    text,
    navigationEndpoint: { browseEndpoint: { browseId: `UC${index}` } },
  }));
  let mode = 'valid';
  const lookups: string[] = [];
  const disk = memoryHost();
  const client = new LibraryApi(
    disk.host,
    new MusicCatalog(async (endpoint, body) => {
      if (mode === 'offline') throw new Error('Network unavailable');
      if (endpoint === 'search')
        return {
          musicResponsiveListItemRenderer: {
            playlistItemData: { videoId: track.videoId },
            flexColumns: [
              {
                musicResponsiveListItemFlexColumnRenderer: {
                  text: { simpleText: track.title },
                },
              },
              {
                musicResponsiveListItemFlexColumnRenderer: {
                  text: { runs: credits },
                },
              },
            ],
          },
        };
      lookups.push(String(body.videoId));
      return {
        playlistPanelVideoRenderer: {
          videoId: mode === 'mismatch' ? 'lmnopqrstuv' : track.videoId,
          title: { simpleText: track.title },
          longBylineText: { runs: mode === 'no-credits' ? [] : credits },
        },
      };
    }),
  );
  assert.deepEqual(await client.request('/catalog/search?q=collaboration'), [
    track,
  ]);
  for (mode of ['offline', 'mismatch', 'no-credits']) {
    await assert.rejects(
      client.request('/songs/import', 'POST', {
        url: `https://youtu.be/${track.videoId}`,
      }),
    );
    assert.equal(disk.writes, 0);
  }
  mode = 'valid';
  const imported = await client.request('/songs/import', 'POST', {
    url: `https://youtu.be/${track.videoId}`,
  });
  const store = new LibraryStore(JSON.parse(disk.value!));
  assert.deepEqual(store.song(1).artists, track.artists);
  assert.deepEqual(
    store.tags().map((tag) => tag.name),
    track.artists,
  );
  assert.ok(store.details(1).memberships.every((member) => member.artist));
  const count = lookups.length;
  assert.deepEqual(
    await client.request('/songs/import', 'POST', {
      url: `https://youtu.be/${track.videoId}`,
    }),
    imported,
  );
  assert.equal(lookups.length, count);
});

test('an empty playlist never creates a tag or writes the library', async () => {
  const disk = memoryHost();
  const catalog = new MusicCatalog(async () => ({
    musicResponsiveHeaderRenderer: { title: { simpleText: 'Empty' } },
    musicPlaylistShelfRenderer: { contents: [] },
  }));
  const client = new LibraryApi(disk.host, catalog);
  await assert.rejects(
    client.request('/playlists/import', 'POST', {
      url: 'https://music.youtube.com/playlist?list=PLabcdefghijk',
    }),
    /no importable songs/,
  );
  assert.equal(disk.writes, 0);
  assert.deepEqual(await client.request('/library'), {
    songs: [],
    tags: [],
    edges: [],
  });
});

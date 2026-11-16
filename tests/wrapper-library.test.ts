import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryStore } from '../server/database.js';
import { PortableLibrary } from '../wrapper/src/library.js';
import { LocalLibraryApi, type LibraryHost } from '../wrapper/src/api.js';
import { PortableCatalog } from '../wrapper/src/catalog.js';
import { createLibraryStorage } from '../wrapper/desktop/storage.mjs';

const song = (index: number, artists = ['Daft Punk']) => ({
  url: `https://music.youtube.com/watch?v=${String(index).padStart(11, '0')}`,
  title: `Song ${index}`,
  artists,
});
function canonical(value: unknown) {
  const data = new PortableLibrary(value).snapshot();
  data.tags.sort((a, b) => a.id - b.id);
  data.songs.sort((a, b) => a.id - b.id);
  data.edges.sort((a, b) => a.parentId - b.parentId || a.childId - b.childId);
  data.assignments.sort(
    (a, b) =>
      a.songId - b.songId ||
      a.tagId - b.tagId ||
      a.origin.localeCompare(b.origin),
  );
  return data;
}
test('portable library matches the SQLite library through graph, artist, rename and deletion edits', (t) => {
  const sql = new LibraryStore(':memory:'),
    portable = new PortableLibrary();
  t.after(() => sql.close());
  const both = <T>(action: (store: LibraryStore | PortableLibrary) => T): T => {
    const expected = action(sql),
      actual = action(portable);
    assert.deepEqual(actual, expected);
    assert.deepEqual(
      canonical(portable.exportLibrary()),
      canonical(sql.exportLibrary()),
    );
    for (const track of sql.songs()) {
      const details = (store: LibraryStore | PortableLibrary) =>
        store
          .details(track.id)
          .memberships.map((row) => ({
            ...row,
            inheritedVia: row.inheritedVia.sort((a, b) => a - b),
          }))
          .sort((a, b) => a.tagId - b.tagId);
      assert.deepEqual(details(portable), details(sql));
    }
    return actual;
  };
  const first = both((store) => store.saveSong(song(1)));
  const second = both((store) => store.saveSong(song(2, ['Guest'])));
  const artist = portable.tags().find((tag) => tag.name === 'Daft Punk')!.id;
  const root = both((store) => store.createTag({ name: 'atmosphere' }));
  const left = both((store) => store.createTag({ name: 'electronic' }));
  const right = both((store) => store.createTag({ name: 'french' }));
  both((store) => store.relate(root, left, true));
  both((store) => store.relate(root, right, true));
  both((store) => store.relate(left, artist, true));
  both((store) => store.relate(right, artist, true));
  both((store) => store.assign(first, root, true));
  both((store) => store.assign(second, root, true));
  assert.equal(portable.tags().find((tag) => tag.id === root)!.songCount, 2);
  both((store) => store.assign(first, root, false));
  both((store) => store.relate(root, left, false));
  assert.deepEqual(
    portable.songs(root).map((song) => song.id),
    [first, second],
  );
  both((store) =>
    assert.throws(() => store.relate(artist, root, true), /cycle/),
  );
  both((store) => assert.throws(() => store.relate(root, root, true), /cycle/));
  both((store) => store.updateTag(root, { name: 'mood', pinned: true }));
  assert.equal(portable.tags()[0].id, root);
  both((store) => store.assign(first, artist, true));
  both((store) => store.saveSong(song(1, ['Guest']), first));
  both((store) => store.deleteTag(artist));
  both((store) =>
    store.saveSong({ ...song(1, ['Guest']), title: 'Edited' }, first),
  );
  const guest = portable.tags().find((tag) => tag.name === 'Guest')!.id;
  both((store) => store.deleteTag(guest));
  both((store) =>
    store.saveSong(
      { ...song(1, ['Guest']), title: 'Changed title only' },
      first,
    ),
  );
  assert.ok(!portable.tags().some((tag) => tag.name === 'Guest'));
  both((store) => store.deleteTag(root));
  both((store) => store.deleteSong(second));
  const restored = new PortableLibrary(portable.snapshot());
  assert.equal(restored.saveSong(song(3)) > second, true);
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
const offlineCatalog = new PortableCatalog(async () => {
  throw new Error('Network unavailable');
});

test('portable API serializes writes, persists a restart, and keeps saved data on failed writes', async () => {
  const disk = memoryHost(),
    client = new LocalLibraryApi(disk.host, offlineCatalog);
  await Promise.all(
    ['one', 'two', 'three'].map((name) =>
      client.request('/tags', 'POST', { name }),
    ),
  );
  const saved = new PortableLibrary(JSON.parse(disk.value!));
  assert.equal(saved.tags().length, 3);
  const reloaded = new LocalLibraryApi(disk.host, offlineCatalog);
  assert.deepEqual(await reloaded.request('/library'), saved.library());
  disk.fail = true;
  await assert.rejects(client.request('/songs', 'POST', song(1)), /Disk full/);
  assert.equal(disk.writes, 3);
  assert.equal(new PortableLibrary(JSON.parse(disk.value!)).songs().length, 0);
  disk.fail = false;
  await assert.rejects(
    client.request('/tags', 'POST', { name: 'four' }),
    /Reopen/,
  );
  assert.equal(disk.writes, 3);
});

test('web-library import merges without overwriting edits and rejects combined cycles atomically', async () => {
  const original = new PortableLibrary();
  const first = original.saveSong(song(1));
  const parent = original.createTag({ name: 'parent' });
  const child = original.createTag({ name: 'child' });
  original.relate(parent, child, true);
  original.assign(first, child, true);
  original.updateTag(parent, { pinned: true });
  const incoming = new PortableLibrary(original.exportLibrary());
  incoming.saveSong(
    { ...song(1), title: 'Remote title', artists: ['Another artist'] },
    first,
  );
  incoming.saveSong(song(2));
  const disk = memoryHost(JSON.stringify(original.snapshot()));
  const client = new LocalLibraryApi(disk.host, offlineCatalog);
  await client.request('/library/import', 'POST', incoming.exportLibrary());
  const merged = new PortableLibrary(JSON.parse(disk.value!));
  assert.equal(merged.song(first).title, 'Song 1');
  assert.deepEqual(merged.song(first).artists, ['Daft Punk']);
  assert.equal(merged.songs(parent).length, 1);
  assert.equal(merged.tags().find((tag) => tag.id === parent)!.pinned, true);
  const before = disk.value;
  const conflicting = new PortableLibrary();
  const a = conflicting.createTag({ name: 'parent' }),
    b = conflicting.createTag({ name: 'child' });
  conflicting.relate(b, a, true);
  await assert.rejects(
    client.request('/library/import', 'POST', conflicting.exportLibrary()),
    /cycle/,
  );
  assert.equal(disk.value, before);
});

test('unreadable or newer saved libraries are never replaced with an empty library', async () => {
  for (const raw of ['{broken', '{"version":2}', '{"version":1,"songs":[]}']) {
    const disk = memoryHost(raw),
      client = new LocalLibraryApi(disk.host, offlineCatalog);
    await assert.rejects(client.request('/library'));
    await assert.rejects(client.request('/songs', 'POST', song(1)));
    assert.equal(disk.value, raw);
    assert.equal(disk.writes, 0);
  }
});

test('device JSON storage rejects stale writes and preserves the last complete library', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'setwise-wrapper-'));
  try {
    const path = join(folder, 'library.json'),
      storage = createLibraryStorage(path);
    const first = JSON.stringify(new PortableLibrary().snapshot());
    assert.equal(await storage.read(), null);
    await storage.write(first, null);
    await assert.rejects(storage.write('{broken', first));
    await assert.rejects(storage.write(first, null), /another window/);
    assert.equal(await readFile(path, 'utf8'), first);
    const client = new LocalLibraryApi(storage, offlineCatalog);
    await client.request('/songs', 'POST', song(1));
    const reloaded = new LocalLibraryApi(
      createLibraryStorage(path),
      offlineCatalog,
    );
    const snapshot = await reloaded.request('/library');
    assert.deepEqual(
      snapshot,
      new PortableLibrary(JSON.parse((await storage.read())!)).library(),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('portable catalog reads complete playlist continuations without importing recommendation rows', async () => {
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
  const catalog = new PortableCatalog(async (_endpoint, body) => {
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
    client = new LocalLibraryApi(disk.host, catalog);
  await client.request('/playlists/import', 'POST', {
    url: 'https://music.youtube.com/playlist?list=PL123456789',
  });
  const library = new PortableLibrary(JSON.parse(disk.value!));
  assert.equal(
    library.tags().find((tag) => tag.name === 'Playlist')!.songCount,
    2,
  );
  await client.request('/playlists/import', 'POST', {
    url: 'https://music.youtube.com/playlist?list=PL123456789',
  });
  assert.equal(new PortableLibrary(JSON.parse(disk.value!)).songs().length, 2);
});

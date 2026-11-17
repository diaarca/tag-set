import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  createLibraryLocationStorage,
  createLibraryStorage,
} from '../wrapper/desktop/storage.mjs';
import { LibraryStore } from '../wrapper/src/library';
import { LibraryApi } from '../wrapper/src/library-api';
import { MusicCatalog } from '../wrapper/src/catalog';

const catalog = new MusicCatalog(async () => {
  throw new Error('Offline');
});
const client = (storage: ReturnType<typeof createLibraryLocationStorage>) =>
  new LibraryApi(
    {
      read: storage.read,
      write: storage.write,
      activateLocation: storage.activate,
    },
    catalog,
  );
const library = (name: string) => {
  const store = new LibraryStore();
  store.createTag({ name });
  return JSON.stringify(store.snapshot());
};
async function fixture() {
  await mkdir('.build', { recursive: true });
  const root = await mkdtemp(resolve('.build/library-location-'));
  const original = join(root, 'private', 'library.json'),
    config = join(root, 'config', 'location.json');
  const data = library('Original');
  await createLibraryStorage(original).write(data, null);
  const storage = createLibraryLocationStorage(original, config);
  return { root, original, config, data, storage, api: client(storage) };
}

test('an empty library folder receives the current library and subsequent imports/writes survive restart there', async () => {
  const f = await fixture();
  try {
    const folder = join(f.root, 'cloud');
    await mkdir(folder);
    const selected = await f.storage.prepare(folder);
    await f.api.request('/library/location', 'PUT', {
      token: selected.token,
      library: selected.data,
    });
    assert.deepEqual(
      JSON.parse(await readFile(join(folder, 'library.json'), 'utf8')),
      JSON.parse(f.data),
    );
    const remote = new LibraryStore();
    remote.createTag({ name: 'From GitHub' });
    await f.api.request('/library/import', 'POST', remote.exportLibrary());
    const restarted = client(
      createLibraryLocationStorage(f.original, f.config),
    );
    assert.deepEqual(
      await restarted.request('/library/export'),
      await f.api.request('/library/export'),
    );
    assert.equal(await readFile(f.original, 'utf8'), f.data);
    assert.deepEqual(await readdir(folder), ['library.json']);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('existing libraries require a live selection, are validated before switching, and cannot change after preview', async () => {
  const f = await fixture();
  try {
    const folder = join(f.root, 'existing');
    await mkdir(folder);
    const target = join(folder, 'library.json'),
      remote = library('Other library');
    await writeFile(target, remote);
    const cancelled = await f.storage.prepare(folder);
    await f.storage.cancel();
    await assert.rejects(
      f.api.request('/library/location', 'PUT', {
        token: cancelled.token,
        library: cancelled.data,
      }),
      /Choose/,
    );
    assert.equal((await f.storage.location()).path, f.original);
    await writeFile(target, '{"version":1}');
    const invalid = await f.storage.prepare(folder);
    await assert.rejects(
      f.api.request('/library/location', 'PUT', {
        token: invalid.token,
        library: invalid.data,
      }),
      /Invalid library/,
    );
    assert.equal((await f.storage.location()).path, f.original);
    await writeFile(target, remote);
    const raced = await f.storage.prepare(folder);
    await writeFile(target, library('Changed remotely'));
    await assert.rejects(
      f.api.request('/library/location', 'PUT', {
        token: raced.token,
        library: raced.data,
      }),
      /changed/,
    );
    assert.equal((await f.storage.location()).path, f.original);
    const selected = await f.storage.prepare(folder);
    await f.api.request('/library/location', 'PUT', {
      token: selected.token,
      library: selected.data,
    });
    assert.equal(await readFile(target, 'utf8'), selected.data);
    assert.equal(await readFile(f.original, 'utf8'), f.data);
    await rm(target);
    await assert.rejects(
      f.api.request('/library/reload', 'POST'),
      /unavailable/,
    );
    const restored = await f.storage.prepare(null);
    await f.api.request('/library/location', 'PUT', {
      token: restored.token,
      library: restored.data,
    });
    assert.equal((await f.storage.location()).isDefault, true);
    assert.equal(await f.storage.read(), f.data);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('source changes and location-setting failures leave the original library selected', async () => {
  const f = await fixture();
  try {
    const folder = join(f.root, 'new');
    await mkdir(folder);
    await f.api.request('/library');
    const stale = await f.storage.prepare(folder);
    await writeFile(f.original, library('External change'));
    await assert.rejects(f.api.request('/library/export'), /Reload/);
    await assert.rejects(
      f.api.request('/library/location', 'PUT', {
        token: stale.token,
        library: null,
      }),
      /current library changed/,
    );
    assert.equal(
      await createLibraryStorage(join(folder, 'library.json')).read(),
      null,
    );
    await f.api.request('/library/reload', 'POST');
    const selected = await f.storage.prepare(folder);
    await mkdir(join(f.root, 'config'));
    await rm(join(f.root, 'config'), { recursive: true });
    await writeFile(join(f.root, 'config'), 'Not a directory');
    await assert.rejects(
      f.api.request('/library/location', 'PUT', {
        token: selected.token,
        library: null,
      }),
    );
    assert.equal((await f.storage.location()).path, f.original);
    assert.equal(await f.storage.read(), library('External change'));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

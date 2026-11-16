import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LibraryStore } from '../wrapper/src/library.js';

const songInput = (index: number, artists = ['Daft Punk']) => ({
  url: `https://music.youtube.com/watch?v=${String(index).padStart(11, '0')}`,
  title: `Song ${index}`,
  artists,
});

test('nested and diamond-shaped inheritance deduplicates songs and preserves other sources', () => {
  const store = new LibraryStore();
  const first = store.saveSong(songInput(1));
  const second = store.saveSong(songInput(2, ['Other Artist']));
  const artist = store.tags().find((tag) => tag.name === 'Daft Punk')!.id;
  const atmosphere = store.createTag({ name: 'atmosphere' });
  const electronic = store.createTag({ name: 'electronic' });
  const french = store.createTag({ name: 'french' });
  store.relate(atmosphere, electronic, true);
  store.relate(atmosphere, french, true);
  store.relate(electronic, artist, true);
  store.relate(french, artist, true);
  store.assign(second, atmosphere, true);
  store.assign(first, atmosphere, true);
  assert.deepEqual(
    store.songs(atmosphere).map((song) => song.id),
    [first, second],
  );
  assert.equal(store.tags().find((tag) => tag.id === atmosphere)!.songCount, 2);
  const membership = store
    .details(first)
    .memberships.find((member) => member.tagId === atmosphere)!;
  assert.equal(membership.manual, true);
  assert.deepEqual(
    new Set(membership.inheritedVia),
    new Set([electronic, french]),
  );
  store.assign(first, atmosphere, false);
  store.relate(atmosphere, electronic, false);
  assert.deepEqual(
    store.songs(atmosphere).map((song) => song.id),
    [first, second],
  );
  store.relate(atmosphere, french, false);
  assert.deepEqual(
    store.songs(atmosphere).map((song) => song.id),
    [second],
  );
  assert.equal(store.tags().find((tag) => tag.id === atmosphere)!.songCount, 1);
  store.assign(second, atmosphere, false);
  assert.equal(store.tags().find((tag) => tag.id === atmosphere)!.songCount, 0);
});

test('cycles are rejected atomically, including indirect and self links', () => {
  const store = new LibraryStore();
  const a = store.createTag({ name: 'A' });
  const b = store.createTag({ name: 'B' });
  const c = store.createTag({ name: 'C' });
  store.relate(a, b, true);
  store.relate(b, c, true);
  assert.throws(() => store.relate(c, a, true), /cycle/);
  assert.throws(() => store.relate(a, a, true), /cycle/);
  assert.equal(store.library().edges.length, 2);
  store.relate(a, b, true);
  assert.equal(store.library().edges.length, 2);
});

test('rename preserves IDs, memberships and pins; deleting a tag keeps songs and child tags', () => {
  const store = new LibraryStore();
  const song = store.saveSong(songInput(1));
  const child = store.tags()[0].id;
  const parent = store.createTag({ name: 'Parent' });
  const root = store.createTag({ name: 'Root' });
  store.relate(root, parent, true);
  store.relate(parent, child, true);
  store.updateTag(parent, { name: 'New name', pinned: true });
  assert.equal(store.tags()[0].id, parent);
  assert.equal(store.tags()[0].name, 'New name');
  assert.equal(store.tags()[0].songCount, 1);
  assert.throws(
    () => store.createTag({ name: ' new NAME ' }),
    /already exists/,
  );
  store.deleteTag(parent);
  assert.equal(store.song(song).id, song);
  assert.ok(store.tags().some((tag) => tag.id === child));
  assert.equal(store.library().edges.length, 0);
  assert.equal(store.songs(root).length, 0);
  assert.ok(
    !store.details(song).memberships.some((member) => member.tagId === parent),
  );
});

test('artist-generated assignments coexist with manual ones and artist credits survive tag deletion', () => {
  const store = new LibraryStore();
  const song = store.saveSong(
    songInput(1, ['Daft Punk', 'daft punk', 'Guest']),
  );
  assert.equal(store.song(song).artists.length, 2);
  const daft = store
    .tags()
    .find((tag) => tag.name.toLowerCase() === 'daft punk')!.id;
  store.assign(song, daft, true);
  store.saveSong(songInput(1, ['Guest']), song);
  const member = store
    .details(song)
    .memberships.find((member) => member.tagId === daft)!;
  assert.equal(member.manual, true);
  assert.equal(member.artist, false);
  const guest = store.tags().find((tag) => tag.name === 'Guest')!.id;
  store.updateTag(guest, { name: 'Collaborator' });
  assert.deepEqual(store.song(song).artists, ['Guest']);
  store.deleteTag(guest);
  store.saveSong({ ...songInput(1, ['Guest']), title: 'Changed title' }, song);
  assert.ok(!store.tags().some((tag) => tag.name === 'Guest'));
  assert.deepEqual(store.song(song).artists, ['Guest']);
  store.deleteSong(song);
  assert.equal(store.songs().length, 0);
  assert.equal(store.tags().find((tag) => tag.id === daft)!.songCount, 0);
});

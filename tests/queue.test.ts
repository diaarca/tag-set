import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Song } from '../shared/types.js';
import { emptyQueue, queueReducer } from '../wrapper/src/queue.js';

const songs: Song[] = [1, 2, 3].map((id) => ({
  id,
  videoId: String(id).padStart(11, '0'),
  title: `Song ${id}`,
  artists: ['Artist'],
}));

test('queue snapshots songs, advances, repeats, and responds to deletion', () => {
  let state = queueReducer(
    { ...emptyQueue, repeat: 'off' },
    { type: 'start', songs },
  );
  assert.notEqual(state.songs, songs);
  const initialRevision = state.revision;
  state = queueReducer(state, { type: 'previous' });
  assert.equal(state.index, 0);
  assert.equal(state.playing, true);
  assert.equal(state.revision, initialRevision + 1);
  state = queueReducer(state, { type: 'ended' });
  assert.equal(state.index, 1);
  state = queueReducer(state, { type: 'previous' });
  assert.equal(state.index, 0);
  state = queueReducer(state, { type: 'next' });
  state = queueReducer(state, { type: 'remove', id: 1 });
  assert.equal(state.index, 0);
  assert.equal(state.songs[0].id, 2);
  state = queueReducer(state, { type: 'remove', id: 2 });
  assert.equal(state.songs[0].id, 3);
  state = queueReducer(state, { type: 'ended' });
  assert.equal(state.playing, false);
  state = queueReducer(state, { type: 'repeat' });
  assert.equal(state.repeat, 'all');
  state = queueReducer(state, { type: 'ended' });
  assert.equal(state.playing, true);
  state = queueReducer(state, { type: 'repeat' });
  assert.equal(state.repeat, 'one');
  const revision = state.revision;
  state = queueReducer(state, { type: 'ended' });
  assert.equal(state.revision, revision + 1);
  state = queueReducer(state, { type: 'remove', id: 3 });
  assert.equal(state.playing, false);
  assert.equal(state.songs.length, 0);
});

test('unavailable songs do not loop forever, and retry permits another attempt', () => {
  let state = queueReducer(emptyQueue, { type: 'start', songs });
  for (let i = 0; i < 3; i++) {
    state = queueReducer(state, { type: 'fail', message: 'Unavailable' });
    state = queueReducer(state, { type: 'next' });
  }
  assert.equal(state.playing, false);
  assert.equal(state.failed.length, 3);
  assert.match(state.error, /No more playable/);
  state = queueReducer(state, { type: 'retry' });
  assert.equal(state.playing, true);
  assert.equal(state.failed.length, 2);
  state = queueReducer(state, { type: 'fail', message: 'Unavailable again' });
  state = queueReducer(state, { type: 'playing', value: true });
  assert.equal(state.error, '');
  assert.equal(state.failed.length, 2);
  state = queueReducer(state, { type: 'start', songs: [songs[0]] });
  assert.deepEqual(state.failed, []);
});

test('shuffle play randomizes the initial song and loops the collection by default', (t) => {
  t.mock.method(Math, 'random', () => 0);
  let state = queueReducer(emptyQueue, { type: 'start', songs, shuffle: true });
  assert.equal(state.shuffle, true);
  assert.equal(state.repeat, 'all');
  assert.equal(state.playing, true);
  assert.deepEqual(
    state.songs.map((song) => song.id),
    [2, 3, 1],
  );
  assert.deepEqual(
    songs.map((song) => song.id),
    [1, 2, 3],
  );
  for (let i = 0; i < songs.length; i++)
    state = queueReducer(state, { type: 'ended' });
  assert.equal(state.index, 0);
  assert.equal(state.playing, true);
  state = queueReducer(state, { type: 'start', songs, shuffle: false });
  assert.equal(state.shuffle, false);
  assert.deepEqual(state.songs, songs);
  state = queueReducer(state, { type: 'start', songs: [], shuffle: true });
  assert.equal(state.playing, false);
});

test('shuffle preserves every song and keeps the current song selected', () => {
  let state = queueReducer(emptyQueue, { type: 'start', songs });
  state = queueReducer(state, { type: 'next' });
  state = queueReducer(state, { type: 'shuffle' });
  assert.equal(state.songs[state.index].id, 2);
  assert.deepEqual(
    new Set(state.songs.map((song) => song.id)),
    new Set([1, 2, 3]),
  );
  state = queueReducer(state, { type: 'shuffle' });
  assert.equal(state.songs[state.index].id, 2);
});

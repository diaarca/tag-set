import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Song } from '../shared/types.js';
import { emptyQueue, queueReducer } from '../src/queue.js';
import { synchronizePlayer, type YouTubePlayer } from '../src/youtube.js';

const songs: Song[] = [1, 2, 3].map((id) => ({
  id,
  videoId: String(id).padStart(11, '0'),
  title: `Song ${id}`,
  artists: ['Artist'],
}));

test('queue snapshots songs, advances, repeats, and responds to deletion', () => {
  let state = queueReducer(emptyQueue, { type: 'start', songs });
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
  state = queueReducer(state, { type: 'repeat' });
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

test('player adapter loads only for track changes, synchronizes transport, and stops empty queues', () => {
  const commands: string[] = [];
  const player = {
    loadVideoById: (id: string) => commands.push(`load:${id}`),
    cueVideoById: (id: string) => commands.push(`cue:${id}`),
    playVideo: () => commands.push('play'),
    pauseVideo: () => commands.push('pause'),
    stopVideo: () => commands.push('stop'),
  } as unknown as YouTubePlayer;
  synchronizePlayer(player, songs[0].videoId, true, true);
  synchronizePlayer(player, songs[0].videoId, false, false);
  synchronizePlayer(player, songs[0].videoId, true, false);
  synchronizePlayer(player, songs[1].videoId, false, true);
  synchronizePlayer(player, undefined, false, true);
  assert.deepEqual(commands, [
    `load:${songs[0].videoId}`,
    'pause',
    'play',
    `cue:${songs[1].videoId}`,
    'stop',
  ]);
});

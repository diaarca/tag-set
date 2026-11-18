import type { Song } from '../../shared/types.js';

export type Repeat = 'off' | 'all' | 'one';
export interface QueueState {
  songs: Song[];
  index: number;
  playing: boolean;
  shuffle: boolean;
  repeat: Repeat;
  failed: number[];
  error: string;
  revision: number;
}
export const emptyQueue: QueueState = {
  songs: [],
  index: 0,
  playing: false,
  shuffle: false,
  repeat: 'all',
  failed: [],
  error: '',
  revision: 0,
};
export type QueueAction =
  | { type: 'start'; songs: Song[]; shuffle?: boolean }
  | {
      type:
        | 'next'
        | 'previous'
        | 'ended'
        | 'retry'
        | 'toggle'
        | 'shuffle'
        | 'repeat';
    }
  | { type: 'remove'; id: number }
  | { type: 'fail'; message: string }
  | { type: 'playing'; value: boolean };

export function validateQueueAction(value: unknown): QueueAction {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid queue command.');
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case 'next':
    case 'previous':
    case 'ended':
    case 'retry':
    case 'toggle':
    case 'shuffle':
    case 'repeat':
      return { type: action.type };
  }
  if (action.type === 'playing' && typeof action.value === 'boolean')
    return { type: 'playing', value: action.value };
  if (
    action.type === 'fail' &&
    typeof action.message === 'string' &&
    action.message.length <= 1000
  )
    return { type: 'fail', message: action.message };
  if (
    action.type === 'remove' &&
    Number.isSafeInteger(action.id) &&
    Number(action.id) > 0
  )
    return { type: 'remove', id: Number(action.id) };
  if (
    action.type === 'start' &&
    Array.isArray(action.songs) &&
    action.songs.length <= 50_000 &&
    (action.shuffle === undefined || typeof action.shuffle === 'boolean')
  ) {
    const ids = new Set<number>();
    const songs = action.songs.map((song: Song) => {
      if (
        !song ||
        !Number.isSafeInteger(song.id) ||
        song.id <= 0 ||
        ids.has(song.id) ||
        typeof song.videoId !== 'string' ||
        !/^[\w-]{11}$/.test(song.videoId) ||
        typeof song.title !== 'string' ||
        !song.title.trim() ||
        song.title.length > 500 ||
        !Array.isArray(song.artists) ||
        song.artists.length > 30 ||
        !song.artists.every(
          (name) => typeof name === 'string' && name.length <= 200,
        )
      )
        throw new Error('Invalid queue song.');
      ids.add(song.id);
      return {
        id: song.id,
        videoId: song.videoId,
        title: song.title,
        artists: [...song.artists],
      };
    });
    return {
      type: 'start',
      songs,
      shuffle: action.shuffle as boolean | undefined,
    };
  }
  throw new Error('Invalid queue command.');
}

function shuffled(songs: Song[]): Song[] {
  const result = [...songs];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function queueReducer(
  state: QueueState,
  action: QueueAction,
): QueueState {
  const current = state.songs[state.index];
  switch (action.type) {
    case 'start': {
      const shuffle = action.shuffle ?? state.shuffle;
      const songs = shuffle ? shuffled(action.songs) : [...action.songs];
      return {
        ...state,
        songs,
        shuffle,
        index: 0,
        playing: songs.length > 0,
        failed: [],
        error: '',
        revision: state.revision + 1,
      };
    }
    case 'toggle':
      return current ? { ...state, playing: !state.playing } : state;
    case 'playing':
      return {
        ...state,
        playing: action.value && Boolean(current),
        error: action.value ? '' : state.error,
        failed: action.value
          ? state.failed.filter((id) => id !== current?.id)
          : state.failed,
      };
    case 'repeat':
      return {
        ...state,
        repeat:
          state.repeat === 'off'
            ? 'all'
            : state.repeat === 'all'
              ? 'one'
              : 'off',
      };
    case 'shuffle': {
      const remaining = state.songs.filter((song) => song.id !== current?.id);
      const songs = state.shuffle
        ? [...state.songs].sort(
            (a, b) => a.title.localeCompare(b.title) || a.id - b.id,
          )
        : current
          ? [current, ...shuffled(remaining)]
          : [];
      return {
        ...state,
        songs,
        index: current ? songs.findIndex((song) => song.id === current.id) : 0,
        shuffle: !state.shuffle,
      };
    }
    case 'fail':
      return {
        ...state,
        playing: false,
        error: action.message,
        failed: current
          ? [...new Set([...state.failed, current.id])]
          : state.failed,
      };
    case 'retry':
      return {
        ...state,
        playing: Boolean(current),
        error: '',
        failed: state.failed.filter((id) => id !== current?.id),
        revision: state.revision + 1,
      };
    case 'remove': {
      const songs = state.songs.filter((song) => song.id !== action.id);
      const index =
        current?.id === action.id
          ? Math.min(state.index, Math.max(0, songs.length - 1))
          : Math.max(
              0,
              songs.findIndex((song) => song.id === current?.id),
            );
      return {
        ...state,
        songs,
        index,
        playing: songs.length > 0 && state.playing,
        error: current?.id === action.id ? '' : state.error,
        failed: state.failed.filter((id) => id !== action.id),
        revision: state.revision + Number(current?.id === action.id),
      };
    }
    case 'previous':
    case 'next':
    case 'ended': {
      if (!current) return state;
      if (
        action.type === 'ended' &&
        state.repeat === 'one' &&
        !state.failed.includes(current.id)
      )
        return { ...state, playing: true, revision: state.revision + 1 };
      const direction = action.type === 'previous' ? -1 : 1;
      for (let step = 1; step <= state.songs.length; step++) {
        let index = state.index + direction * step;
        if (index < 0 || index >= state.songs.length) {
          if (state.repeat !== 'all') break;
          index =
            ((index % state.songs.length) + state.songs.length) %
            state.songs.length;
        }
        if (!state.failed.includes(state.songs[index].id))
          return {
            ...state,
            index,
            playing: true,
            error: '',
            revision: state.revision + 1,
          };
      }
      if (action.type === 'previous' && !state.failed.includes(current.id)) {
        return {
          ...state,
          playing: true,
          error: '',
          revision: state.revision + 1,
        };
      }
      return {
        ...state,
        playing: false,
        error: state.failed.length
          ? 'No more playable songs in this queue. Retry a song or start another collection.'
          : '',
      };
    }
  }
}

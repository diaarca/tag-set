import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createTrackNavigation } from '../wrapper/desktop/navigation.mjs';
import '../wrapper/protocol.js';
import { videoId } from '../shared/validation.js';
const { allowedNavigation, validateCommand, artworkURL } =
  globalThis.tagsetProtocol;

test('track loads ignore superseded failures and report the latest failure', async () => {
  const failures: ((error: Error) => void)[] = [];
  let unload: (event: { preventDefault(): void }) => void = () => {};
  let url = 'https://music.youtube.com/';
  let prevented = 0;
  const load = createTrackNavigation({
    on: (_event: string, handler: typeof unload) => {
      unload = handler;
    },
    getURL: () => url,
    loadURL: () =>
      new Promise<void>((_resolve, reject) => failures.push(reject)),
  });
  const event = { preventDefault: () => prevented++ };
  unload(event);
  assert.equal(prevented, 0);
  const first = load('00000000001');
  unload(event);
  assert.equal(prevented, 1);
  url = 'https://accounts.google.com/';
  unload(event);
  assert.equal(prevented, 1);
  const second = load('00000000002');
  failures[0](new Error('Superseded'));
  await first;
  const rejected = assert.rejects(second, /Current navigation failed/);
  failures[1](new Error('Current navigation failed'));
  await rejected;
  url = 'https://music.youtube.com/';
  unload(event);
  assert.equal(prevented, 1);
});

test('wrapper normalizes song links and rejects untrusted navigation', () => {
  assert.equal(
    videoId('https://music.youtube.com/watch?v=EsAQYAeqxD4&si=share'),
    'EsAQYAeqxD4',
  );
  assert.equal(videoId('https://youtu.be/EsAQYAeqxD4'), 'EsAQYAeqxD4');
  for (const url of [
    'https://music.youtube.com.evil.test/watch?v=EsAQYAeqxD4',
    'https://user@music.youtube.com/watch?v=EsAQYAeqxD4',
    'https://music.youtube.com:444/watch?v=EsAQYAeqxD4',
    'javascript:alert(1)',
    'https://music.youtube.com/playlist?list=PL123456789',
  ])
    assert.throws(() => videoId(url));
  assert.equal(
    allowedNavigation('https://accounts.google.com/ServiceLogin'),
    true,
  );
  assert.equal(allowedNavigation('https://music.youtube.com/'), true);
  assert.equal(
    allowedNavigation('https://accounts.youtube.com/accounts/SetSID'),
    true,
  );
  assert.equal(
    allowedNavigation('https://www.google.com/accounts/CheckCookie'),
    true,
  );
  assert.equal(
    allowedNavigation('https://accounts.youtube.com.evil.test/'),
    false,
  );
  assert.equal(
    allowedNavigation('https://accounts.google.com@evil.test/'),
    false,
  );
  assert.equal(
    allowedNavigation('https://music.youtube.com.evil.test/'),
    false,
  );
  assert.equal(allowedNavigation('file:///etc/passwd'), false);
});

test('wrapper validates its playback and layout command boundary', () => {
  assert.deepEqual(validateCommand({ type: 'load', videoId: 'EsAQYAeqxD4' }), {
    type: 'load',
    videoId: 'EsAQYAeqxD4',
  });
  assert.deepEqual(validateCommand({ type: 'pause', script: 'untrusted' }), {
    type: 'pause',
  });
  assert.throws(() =>
    validateCommand({ type: 'load', videoId: "');alert(1);//" }),
  );
  assert.throws(() =>
    validateCommand({ type: 'execute', script: 'untrusted' }),
  );
  assert.throws(() => validateCommand(null));
  assert.throws(() =>
    validateCommand({ type: 'load', videoId: ['EsAQYAeqxD4'] }),
  );
  assert.throws(() => validateCommand({ type: 'seek', value: Infinity }));
  assert.throws(() => validateCommand({ type: 'volume', value: 101 }));
});

test('artwork is limited to HTTPS image hosts', () => {
  assert.equal(
    artworkURL('https://lh3.googleusercontent.com/album=w512'),
    'https://lh3.googleusercontent.com/album=w512',
  );
  assert.equal(
    artworkURL('https://i.ytimg.com/vi/EsAQYAeqxD4/hqdefault.jpg'),
    'https://i.ytimg.com/vi/EsAQYAeqxD4/hqdefault.jpg',
  );
  for (const value of [
    'file:///private/library.json',
    'javascript:alert(1)',
    'http://i.ytimg.com/image',
    'https://lh3.googleusercontent.com.evil.test/image',
    'https://user:password@i.ytimg.com/image',
    'https://i.ytimg.com:444/image',
    null,
  ])
    assert.equal(artworkURL(value), null);
});

test('player identity and commands survive navigation away from the watch page', async () => {
  let tick = () => {};
  const calls: unknown[] = [];
  let playingVideoId = 'EsAQYAeqxD4';
  const media = { currentTime: 12, duration: 255, paused: false, volume: 0.7 };
  const player = {
    getPlayerState: () => 1,
    getVideoData: () => ({ video_id: playingVideoId }),
    querySelector: () => media,
    addEventListener: () => {},
    playVideo: () => {
      calls.push('play');
      media.paused = false;
    },
    pauseVideo: () => {
      calls.push('pause');
      media.paused = true;
    },
    seekTo: (value: number) => {
      calls.push(['seek', value]);
      media.currentTime = value;
    },
    setVolume: (value: number) => {
      calls.push(['volume', value]);
      media.volume = value / 100;
    },
  };
  const browser = { __tagsetLoadToken: 'current-request' } as {
    __tagsetLoadToken: string;
    __tagsetPlayback: {
      videoId: string;
      artwork: string;
      loadToken: string;
      paused: boolean;
    };
    __tagsetControl: (command: string, value?: number) => Promise<boolean>;
  };
  const location = new URL('https://music.youtube.com/browse/artist');
  runInNewContext(
    readFileSync(
      new URL('../wrapper/player-bridge.js', import.meta.url),
      'utf8',
    ),
    {
      window: browser,
      URL,
      location,
      navigator: {
        mediaSession: {
          metadata: {
            artwork: [{ src: 'https://lh3.googleusercontent.com/album=w512' }],
          },
        },
      },
      document: {
        getElementById: () => player,
        addEventListener: () => {},
        title: 'Artist - YouTube Music',
        querySelector: () => null,
      },
      setInterval: (callback: () => void) => {
        tick = callback;
      },
    },
  );
  assert.equal(browser.__tagsetPlayback.videoId, 'EsAQYAeqxD4');
  assert.equal(
    browser.__tagsetPlayback.artwork,
    'https://lh3.googleusercontent.com/album=w512',
  );
  assert.equal(browser.__tagsetPlayback.loadToken, 'current-request');
  await browser.__tagsetControl('pause');
  tick();
  assert.equal(browser.__tagsetPlayback.paused, true);
  await browser.__tagsetControl('play');
  await browser.__tagsetControl('seek', 45);
  await browser.__tagsetControl('volume', 35);
  assert.deepEqual(calls, ['pause', 'play', ['seek', 45], ['volume', 35]]);
  location.search = '?v=00000000000';
  tick();
  assert.equal(browser.__tagsetPlayback.videoId, 'EsAQYAeqxD4');
  playingVideoId = 'lmnopqrstuv';
  tick();
  assert.equal(browser.__tagsetPlayback.videoId, 'lmnopqrstuv');
  await assert.rejects(browser.__tagsetControl('execute'), /Unsupported/);
});

test('media keys use TagSet navigation even when YouTube replaces its handlers', () => {
  const handlers = new Map<string, (() => void) | null>();
  const messages: { type: string; action: string; loadToken: string }[] = [];
  const session = {
    setActionHandler(action: string, handler: (() => void) | null) {
      handlers.set(action, handler);
    },
  };
  let youtubeNext = 0;
  session.setActionHandler('nexttrack', () => youtubeNext++);
  const browser = {
    __tagsetLoadToken: 'selected-queue-track',
    tagsetPlaybackHost: {
      report(message: (typeof messages)[number]) {
        if (message.type === 'media-action') messages.push(message);
      },
    },
  };
  runInNewContext(
    readFileSync(
      new URL('../wrapper/player-bridge.js', import.meta.url),
      'utf8',
    ),
    {
      window: browser,
      location: new URL('https://music.youtube.com/watch?v=EsAQYAeqxD4'),
      URL,
      navigator: { mediaSession: session },
      document: {
        getElementById: () => null,
        querySelector: () => null,
        addEventListener: () => {},
        title: 'YouTube Music',
      },
      setInterval: () => {},
    },
  );
  handlers.get('nexttrack')?.();
  session.setActionHandler('nexttrack', () => youtubeNext++);
  handlers.get('nexttrack')?.();
  session.setActionHandler('previoustrack', null);
  handlers.get('previoustrack')?.();
  assert.equal(youtubeNext, 0);
  assert.deepEqual(
    messages.map((message) => message.action),
    ['next', 'next', 'previous'],
  );
  assert.ok(
    messages.every((message) => message.loadToken === 'selected-queue-track'),
  );
  let paused = false;
  session.setActionHandler('pause', () => {
    paused = true;
  });
  handlers.get('pause')?.();
  assert.equal(paused, true);
});

test('playback bridge reports song completion without treating ads as queue endings', () => {
  let advertisement = true;
  let tick = () => {};
  let ended = () => {};
  let playerState: (state: number) => void = () => {};
  const media = {
    currentTime: 3,
    duration: 255,
    paused: false,
  };
  const browser = {} as {
    __tagsetPlayback: {
      advertisement: boolean;
      endedVideoId?: string;
      duration: number;
    };
  };
  runInNewContext(
    readFileSync(
      new URL('../wrapper/player-bridge.js', import.meta.url),
      'utf8',
    ),
    {
      window: browser,
      URL,
      location: new URL('https://music.youtube.com/watch?v=EsAQYAeqxD4'),
      document: {
        getElementById: () => ({
          getPlayerState: () => 1,
          addEventListener: (
            _event: string,
            callback: (state: number) => void,
          ) => {
            playerState = callback;
          },
        }),
        addEventListener: (
          _event: string,
          callback: (event: { target: typeof media }) => void,
        ) => {
          ended = () => callback({ target: media });
        },
        title: '#Hulahoop - YouTube Music',
        querySelector: (selector: string) =>
          selector === 'video, audio'
            ? media
            : selector === '.ad-showing' && advertisement
              ? {}
              : null,
      },
      setInterval: (callback: () => void) => {
        tick = callback;
      },
    },
  );
  assert.equal(browser.__tagsetPlayback.advertisement, true);
  ended();
  playerState(0);
  assert.equal(browser.__tagsetPlayback.endedVideoId, undefined);
  advertisement = false;
  tick();
  playerState(1);
  assert.equal(browser.__tagsetPlayback.endedVideoId, undefined);
  playerState(0);
  assert.equal(browser.__tagsetPlayback.endedVideoId, 'EsAQYAeqxD4');
  assert.equal(browser.__tagsetPlayback.duration, 255);
});

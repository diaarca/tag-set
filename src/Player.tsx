import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { Song } from '../shared/types.js';
import { emptyQueue, queueReducer } from './queue';
import {
  loadYouTube,
  playbackError,
  synchronizePlayer,
  type YouTubePlayer,
} from './youtube';

export interface PlayerHandle {
  start(songs: Song[]): void;
  remove(id: number): void;
}
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const Player = forwardRef<PlayerHandle>(function Player(_props, ref) {
  const [queue, dispatch] = useReducer(queueReducer, emptyQueue);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(70);
  const [blocked, setBlocked] = useState(false);
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const lastLoad = useRef('');
  const song = queue.songs[queue.index];

  useImperativeHandle(
    ref,
    () => ({
      start: (songs) => dispatch({ type: 'start', songs }),
      remove: (id) => dispatch({ type: 'remove', id }),
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void loadYouTube()
      .then(() => {
        if (cancelled || !mount.current || !window.YT) return;
        const element = document.createElement('div');
        mount.current.append(element);
        player.current = new window.YT.Player(element, {
          width: '100%',
          height: '100%',
          playerVars: {
            origin: window.location.origin,
            playsinline: 1,
            controls: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              if (!cancelled) setReady(true);
            },
            onStateChange: (event) => {
              if (cancelled) return;
              if (event.data === 0) dispatch({ type: 'ended' });
              if (event.data === 1 || event.data === 2) {
                dispatch({ type: 'playing', value: event.data === 1 });
                if (event.data === 1) setBlocked(false);
              }
            },
            onError: (event) => {
              if (!cancelled)
                dispatch({ type: 'fail', message: playbackError(event.data) });
            },
            onAutoplayBlocked: () => {
              if (!cancelled) {
                setBlocked(true);
                dispatch({ type: 'playing', value: false });
              }
            },
          },
        });
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !player.current) return;
    const key = `${song?.videoId ?? ''}:${queue.revision}`;
    const load = key !== lastLoad.current;
    lastLoad.current = key;
    synchronizePlayer(player.current, song?.videoId, queue.playing, load);
    if (load) {
      setPosition(0);
      setDuration(0);
      setBlocked(false);
    }
  }, [ready, song?.videoId, queue.revision, queue.playing]);

  useEffect(() => {
    if (ready) player.current?.setVolume(volume);
  }, [ready, volume]);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      setPosition(player.current?.getCurrentTime() || 0);
      setDuration(player.current?.getDuration() || 0);
    }, 500);
    return () => window.clearInterval(timer);
  }, [ready]);

  return (
    <aside className="player-panel" aria-label="Music player">
      <div className="panel-heading">
        <span className="eyebrow">NOW PLAYING</span>
        <span className="live-dot" />
      </div>
      <div className="video-shell">
        <div ref={mount} className="video-mount" />
        {!ready && (
          <p className="player-loading">
            {loadError || 'Connecting to YouTube…'}
          </p>
        )}
      </div>
      <div className="now-playing">
        <span className="eyebrow">
          {song
            ? `TRACK ${queue.index + 1} OF ${queue.songs.length}`
            : 'A LITTLE ROOM FOR MUSIC'}
        </span>
        <h2>{song?.title ?? 'Find your next feeling.'}</h2>
        <p>
          {song?.artists.join(' · ') ??
            'Choose a song or let a tag set the mood.'}
        </p>
      </div>
      <div className="seek-row">
        <input
          aria-label="Seek"
          type="range"
          min="0"
          max={duration || 1}
          value={Math.min(position, duration || 1)}
          disabled={!song || !ready || !duration}
          onChange={(event) => {
            const seconds = Number(event.target.value);
            setPosition(seconds);
            player.current?.seekTo(seconds, true);
          }}
        />
        <div className="time-labels">
          <span>{time(position)}</span>
          <span>{time(duration)}</span>
        </div>
      </div>
      <div className="transport">
        <button
          className={`icon-button ${queue.shuffle ? 'active' : ''}`}
          aria-label="Shuffle"
          aria-pressed={queue.shuffle}
          onClick={() => dispatch({ type: 'shuffle' })}
        >
          ⤨
        </button>
        <button
          className="icon-button"
          aria-label="Previous song"
          disabled={!song || !ready}
          onClick={() => dispatch({ type: 'previous' })}
        >
          ▐◀
        </button>
        <button
          className="play-toggle"
          aria-label={queue.playing ? 'Pause' : 'Play'}
          disabled={!song || !ready || Boolean(queue.error)}
          onClick={() => dispatch({ type: 'toggle' })}
        >
          {queue.playing ? 'Ⅱ' : '▶'}
        </button>
        <button
          className="icon-button"
          aria-label="Next song"
          disabled={!song || !ready}
          onClick={() => dispatch({ type: 'next' })}
        >
          ▶▌
        </button>
        <button
          className={`icon-button ${queue.repeat !== 'off' ? 'active' : ''}`}
          aria-label={`Repeat: ${queue.repeat}`}
          onClick={() => dispatch({ type: 'repeat' })}
        >
          {queue.repeat === 'one' ? '↻₁' : '↻'}
        </button>
      </div>
      <label className="volume-row">
        <span>Volume</span>
        <input
          aria-label="Volume"
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
        />
      </label>
      {blocked && (
        <p className="notice" role="status">
          Your browser paused autoplay. Press Play, or use the YouTube player
          above.
        </p>
      )}
      {queue.error && (
        <div className="notice error" role="alert">
          <p>{queue.error}</p>
          <div className="button-row">
            <button onClick={() => dispatch({ type: 'retry' })}>Retry</button>
            <button onClick={() => dispatch({ type: 'next' })}>Skip</button>
          </div>
        </div>
      )}
      <div className="queue-heading">
        <h3>Up next</h3>
        <span>{Math.max(0, queue.songs.length - queue.index - 1)} tracks</span>
      </div>
      {queue.songs.length === 0 ? (
        <p className="muted queue-empty">
          Your queue starts with a little curiosity.
        </p>
      ) : (
        <ol className="queue-list">
          {queue.songs.slice(queue.index + 1).map((item, index) => (
            <li key={item.id}>
              <span className="track-number">{queue.index + index + 2}</span>
              <div>
                <strong>{item.title}</strong>
                <span>{item.artists.join(' · ')}</span>
              </div>
              {queue.failed.includes(item.id) && (
                <span title="Unavailable">!</span>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="player-footnote">
        Played on YouTube · Your library stays here.
      </p>
    </aside>
  );
});

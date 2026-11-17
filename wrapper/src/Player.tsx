import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { Song } from '../../shared/types.js';
import { emptyQueue, queueReducer } from './queue.js';
import { send, subscribe, uniqueToken, type PlaybackMessage } from './host.js';
import '../protocol.js';
import { usePreferences } from './Preferences';

export interface PlayerHandle {
  start(songs: Song[], options?: { shuffle: boolean }): void;
  remove(id: number): void;
}

const { artworkURL } = globalThis.tagsetProtocol;

const time = (value: number) => {
  const seconds = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const emptyPlayback: PlaybackMessage = {
  type: 'playback',
  videoId: null,
  loadToken: null,
  paused: true,
  advertisement: false,
  position: 0,
  duration: 0,
  title: '',
};

export const Player = forwardRef<PlayerHandle>(function Player(_props, ref) {
  const { preferences } = usePreferences();
  useEffect(() => {
    if (window.tagsetHost)
      send({ type: 'normalization', enabled: preferences.normalizeVolume });
  }, [preferences.normalizeVolume]);
  const [queue, dispatch] = useReducer(queueReducer, emptyQueue);
  const [playback, setPlayback] = useState(emptyPlayback);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingNoticeFor, setLoadingNoticeFor] = useState('');
  const [volume, setVolume] = useState(70);
  const [websiteOpen, setWebsiteOpen] = useState(false);
  const [artwork, setArtwork] = useState<{ videoId: string; url: string }>();
  const [failedArtwork, setFailedArtwork] = useState('');
  const [failedThumbnail, setFailedThumbnail] = useState('');
  const panel = useRef<HTMLElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const siteOpen = useRef(websiteOpen);
  siteOpen.current = websiteOpen;
  const state = useRef(queue);
  state.current = queue;
  const active = useRef<
    | {
        key: string;
        token: string;
        started: boolean;
        attempted: boolean;
        ended: boolean;
        expectedPlaying: boolean | undefined;
      }
    | undefined
  >(undefined);
  const song = queue.songs[queue.index];
  const videoId = song?.videoId;
  const navigate = useCallback((type: 'next' | 'previous') => {
    // Ignore the old page immediately, before React loads the next song.
    active.current = undefined;
    dispatch({ type });
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      start(songs, options) {
        dispatch({ type: 'start', songs, shuffle: options?.shuffle });
        panel.current?.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        });
      },
      remove(id) {
        dispatch({ type: 'remove', id });
      },
    }),
    [],
  );
  useEffect(
    () =>
      subscribe((message) => {
        if ('error' in message) {
          setError(message.error);
          setLoading(false);
          return;
        }
        const request = active.current,
          current = state.current.songs[state.current.index];
        if (
          !request ||
          !current ||
          request.token !== message.loadToken ||
          request.key !== `${current.videoId}:${state.current.revision}`
        )
          return;
        if (message.type === 'media-action') {
          navigate(message.action);
          return;
        }
        setPlayback(message);
        if (
          message.endedVideoId === current.videoId &&
          !request.ended &&
          request.started
        ) {
          request.ended = true;
          dispatch({ type: 'ended' });
          return;
        }
        if (message.videoId !== current.videoId) {
          if (
            message.videoId &&
            request.started &&
            !request.ended &&
            !siteOpen.current &&
            !message.advertisement
          ) {
            request.started = false;
            if (state.current.playing) dispatch({ type: 'retry' });
            else send({ type: 'pause' });
          }
          return;
        }
        const cover = artworkURL(message.artwork);
        if (cover && !message.advertisement)
          setArtwork((previous) =>
            previous?.videoId === current.videoId && previous.url === cover
              ? previous
              : { videoId: current.videoId, url: cover },
          );
        if (message.duration <= 0) return;
        setLoading(false);
        if (request.expectedPlaying !== undefined) {
          const playing = !message.paused;
          if (playing !== request.expectedPlaying) {
            if (!request.attempted) {
              request.attempted = true;
              send({ type: request.expectedPlaying ? 'play' : 'pause' });
            }
            return;
          }
          request.expectedPlaying = undefined;
        }
        if (!message.paused) {
          request.started = true;
          setError('');
          dispatch({ type: 'playing', value: true });
        } else if (request.started) dispatch({ type: 'playing', value: false });
      }),
    [navigate],
  );
  useEffect(() => {
    if (websiteOpen) surface.current?.scrollIntoView({ block: 'nearest' });
    else if (panel.current) panel.current.scrollTop = 0;
  }, [websiteOpen]);
  useEffect(() => {
    if (!videoId) {
      if (active.current) send({ type: 'pause' });
      active.current = undefined;
      return;
    }
    const key = `${videoId}:${queue.revision}`;
    if (active.current?.key !== key) {
      if (!queue.playing) {
        send({ type: 'pause' });
        return;
      }
      const token = uniqueToken();
      active.current = {
        key,
        token,
        started: false,
        attempted: false,
        ended: false,
        expectedPlaying: true,
      };
      setLoading(true);
      setError('');
      setPlayback(emptyPlayback);
      send({ type: 'load', videoId, token });
    } else {
      active.current.expectedPlaying = queue.playing;
      active.current.attempted = false;
      send({ type: queue.playing ? 'play' : 'pause' });
    }
  }, [videoId, queue.revision, queue.playing]);
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(
      () => setLoadingNoticeFor(`${videoId}:${queue.revision}`),
      3_000,
    );
    return () => window.clearTimeout(timer);
  }, [loading, videoId, queue.revision]);
  useEffect(() => {
    if (!loading || playback.advertisement) return;
    const token = active.current?.token;
    const timer = window.setTimeout(() => {
      if (active.current?.token !== token) return;
      setLoading(false);
      setError(
        'YouTube Music did not load the selected song. Retry, skip it, or open YouTube Music to check for a prompt.',
      );
      send({ type: 'pause' });
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [loading, playback.advertisement, videoId, queue.revision]);
  useEffect(() => {
    if (window.tagsetHost) send({ type: 'volume', value: volume });
  }, [volume]);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    let frame = 0,
      previous = '';
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        const visible =
          websiteOpen &&
          !document.querySelector('dialog[open]') &&
          rect.bottom > 0 &&
          rect.top < innerHeight &&
          rect.right > 0 &&
          rect.left < innerWidth;
        const command = {
          type: 'layout' as const,
          x: visible ? rect.x : 0,
          y: visible ? rect.y : 0,
          width: visible ? rect.width : 0,
          height: visible ? rect.height : 0,
          visible,
        };
        const encoded = JSON.stringify(command);
        if (encoded !== previous) {
          previous = encoded;
          send(command);
        }
      });
    };
    const resize = new ResizeObserver(measure),
      mutation = new MutationObserver(measure);
    resize.observe(element);
    mutation.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      send({
        type: 'layout',
        visible: false,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    };
  }, [websiteOpen]);
  const matching =
    playback.loadToken === active.current?.token &&
    playback.videoId === song?.videoId;
  const position = matching ? playback.position : 0,
    duration = matching ? playback.duration : 0;
  const playing = loading ? queue.playing : matching && !playback.paused;
  const togglePlayback = useCallback(() => {
    if (!song) return;
    if (active.current?.ended || (!matching && !loading))
      dispatch({ type: 'retry' });
    else if (!loading && matching && playback.paused && queue.playing)
      send({ type: 'play' });
    else dispatch({ type: 'toggle' });
  }, [song, matching, loading, playback.paused, queue.playing]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !document.hasFocus() ||
        document.hidden ||
        !song ||
        document.querySelector('dialog[open]')
      )
        return;
      const target = event.target;
      const playbackSlider =
        target instanceof HTMLInputElement &&
        target.type === 'range' &&
        panel.current?.contains(target);
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          (!playbackSlider &&
            target.closest(
              'input, textarea, select, button, a[href], [role="button"], [role="textbox"], [role="slider"], [role="combobox"], [role="checkbox"], [role="switch"]',
            )))
      )
        return;
      event.preventDefault();
      if (!event.repeat) togglePlayback();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [song, togglePlayback]);
  const cover = artwork && artwork.videoId === videoId ? artwork.url : null;
  const thumbnail = videoId
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    : null;
  const image =
    cover && cover !== failedArtwork
      ? cover
      : thumbnail !== failedThumbnail
        ? thumbnail
        : null;
  return (
    <aside
      ref={panel}
      className={`player-panel${websiteOpen ? ' wrapper-site-open' : ''}`}
      aria-label="Music player"
    >
      <div className="panel-heading">
        <span className="eyebrow">NOW PLAYING</span>
        <span className="live-dot" />
      </div>
      <div className="wrapper-cover">
        {image ? (
          <img
            key={image}
            src={image}
            alt={`Cover for ${song?.title ?? 'the current song'}`}
            referrerPolicy="no-referrer"
            onError={() => {
              if (image === cover) setFailedArtwork(image);
              else setFailedThumbnail(image);
            }}
          />
        ) : (
          <span aria-label="No cover available">♫</span>
        )}
      </div>
      <button
        className="text-button wrapper-site-toggle"
        aria-expanded={websiteOpen}
        onClick={() => {
          if (websiteOpen && song && !matching) {
            if (queue.playing) dispatch({ type: 'retry' });
            else send({ type: 'pause' });
          }
          setWebsiteOpen((value) => !value);
        }}
      >
        {websiteOpen ? 'Close YouTube Music' : 'Open YouTube Music'}
      </button>
      {websiteOpen && (
        <p className="field-note">
          Use this view for sign-in, consent, or playback prompts. Close it to
          return control to TagSet.
        </p>
      )}
      <div
        hidden={!websiteOpen}
        ref={surface}
        className="wrapper-music-surface"
        aria-label="YouTube Music website"
      />
      <div className="now-playing">
        <span className="eyebrow">
          {song
            ? `TRACK ${queue.index + 1} OF ${queue.songs.length}`
            : 'YOUR COLLECTION, YOUR CONNECTIONS'}
        </span>
        <h2>{song?.title ?? 'Choose a song or tag.'}</h2>
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
          disabled={!matching || !duration || playback.advertisement}
          onChange={(event) =>
            send({ type: 'seek', value: Number(event.target.value) })
          }
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
          disabled={!song}
          onClick={() => navigate('previous')}
        >
          ▐◀
        </button>
        <button
          className="play-toggle"
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={!song}
          onClick={togglePlayback}
        >
          {playing ? 'Ⅱ' : '▶'}
        </button>
        <button
          className="icon-button"
          aria-label="Next song"
          disabled={!song}
          onClick={() => navigate('next')}
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
      {window.tagsetHost && (
        <label className="volume-row">
          Volume
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
      )}
      {loading && loadingNoticeFor === `${videoId}:${queue.revision}` && (
        <p className="notice" role="status">
          Opening your song in YouTube Music… Use “Open YouTube Music” if it
          needs consent or a playback prompt.
        </p>
      )}
      {playback.advertisement && (
        <p className="notice">
          Advertisement · playback is handled by YouTube Music.
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button onClick={() => dispatch({ type: 'retry' })}>
            Retry song
          </button>
        </div>
      )}
      <div className="queue-heading">
        <h3>Up next</h3>
        <span>{Math.max(0, queue.songs.length - queue.index - 1)} tracks</span>
      </div>
      <ol className="queue-list">
        {queue.songs.slice(queue.index + 1).map((item, index) => (
          <li key={item.id}>
            <span className="track-number">{queue.index + index + 2}</span>
            <div>
              <strong>{item.title}</strong>
              <span>{item.artists.join(' · ')}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="player-footnote">
        Library saved on this device · Playback by YouTube Music
      </p>
    </aside>
  );
});

export interface YouTubePlayer {
  loadVideoById(id: string): void;
  cueVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}
interface PlayerOptions {
  width: string;
  height: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady: () => void;
    onStateChange: (event: { data: number }) => void;
    onError: (event: { data: number }) => void;
    onAutoplayBlocked: () => void;
  };
}
declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: PlayerOptions,
      ) => YouTubePlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<void> | undefined;
export function loadYouTube(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => fail(), 20_000);
    function fail() {
      window.clearTimeout(timeout);
      script.remove();
      loading = undefined;
      reject(
        new Error(
          'YouTube could not load. Check your connection or content blocker, then reload the page.',
        ),
      );
    }
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

export function synchronizePlayer(
  player: YouTubePlayer,
  videoId: string | undefined,
  playing: boolean,
  load: boolean,
) {
  if (!videoId) {
    player.stopVideo();
    return;
  }
  if (load) {
    if (playing) player.loadVideoById(videoId);
    else player.cueVideoById(videoId);
  } else if (playing) player.playVideo();
  else player.pauseVideo();
}

export function playbackError(code: number): string {
  if (code === 100) return 'This video is unavailable or private.';
  if (code === 101 || code === 150)
    return 'This video cannot be played in an embedded player.';
  if (code === 153)
    return 'YouTube could not verify this player. Try reloading the app in your browser.';
  return 'YouTube could not play this song. Try again or skip it.';
}

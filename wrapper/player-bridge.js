(() => {
  if (location.hostname !== 'music.youtube.com' || window.__tagsetBridge)
    return;
  window.__tagsetBridge = true;
  let active;
  let trackedVideoId;
  let endedVideoId;
  let advertisement = false;
  let playerAPI;
  let appliedVolume = '';
  let volumeElement;
  const api = () => document.getElementById('movie_player');
  const media = () =>
    api()?.querySelector?.('video, audio') ??
    document.querySelector('video, audio');
  const applyVolume = (force = false) => {
    const player = api(),
      element = media(),
      preferred = window.__tagsetPreferredVolume;
    if (!element || typeof preferred !== 'number') return;
    const response = player?.getPlayerResponse?.();
    const db =
      response?.videoDetails?.videoId === trackedVideoId
        ? response?.playerConfig?.audioConfig?.loudnessDb
        : undefined;
    const normalize =
      window.__tagsetNormalizeVolume &&
      !advertisement &&
      typeof db === 'number' &&
      Number.isFinite(db);
    const signature = `${preferred}:${!!normalize}:${trackedVideoId}:${advertisement}:${db}`;
    if (normalize) {
      // Set the absolute media volume to avoid applying YouTube's gain twice.
      const target = preferred * 10 ** (-Math.max(0, db) / 20);
      if (Math.abs(element.volume - target) > 0.001) element.volume = target;
    } else if (
      force ||
      signature !== appliedVolume ||
      element !== volumeElement
    ) {
      if (typeof player?.setVolume === 'function')
        player.setVolume(preferred * 100);
      else element.volume = preferred;
    }
    appliedVolume = signature;
    volumeElement = element;
  };
  const session = globalThis.navigator?.mediaSession;
  if (session?.setActionHandler) {
    const register = session.setActionHandler.bind(session);
    const actions = { nexttrack: 'next', previoustrack: 'previous' };
    const handlers = Object.fromEntries(
      Object.entries(actions).map(([action, value]) => [
        action,
        () => {
          const message = {
            type: 'media-action',
            action: value,
            loadToken: window.__tagsetLoadToken ?? null,
          };
          window.tagsetPlaybackHost?.report(message);
          window.webkit?.messageHandlers.wrapperPlayback?.postMessage(message);
        },
      ]),
    );
    // Keep queue ownership when YouTube Music registers its handlers again.
    session.setActionHandler = (action, handler) =>
      register(action, handlers[action] ?? handler);
    for (const [action, handler] of Object.entries(handlers))
      session.setActionHandler(action, handler);
  }
  window.__tagsetControl = async (command, value) => {
    const player = api(),
      element = media();
    switch (command) {
      case 'play':
        if (typeof player?.playVideo === 'function') player.playVideo();
        else if (element) await element.play();
        else
          throw new Error(
            'YouTube Music is still loading. Open YouTube Music if playback needs a prompt.',
          );
        break;
      case 'pause':
        if (typeof player?.pauseVideo === 'function') player.pauseVideo();
        else element?.pause();
        break;
      case 'seek':
        if (document.querySelector('.ad-showing'))
          throw new Error('Use YouTube Music controls during advertisements.');
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
          throw new Error('Invalid seek position.');
        if (typeof player?.seekTo === 'function') player.seekTo(value, true);
        else if (element)
          element.currentTime = Math.min(
            value,
            Number.isFinite(element.duration) ? element.duration : value,
          );
        else throw new Error('YouTube Music is still loading.');
        break;
      case 'volume':
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 100
        )
          throw new Error('Invalid volume.');
        window.__tagsetPreferredVolume = value / 100;
        applyVolume(true);
        break;
      case 'normalization':
        if (typeof value !== 'boolean')
          throw new Error('Invalid normalization setting.');
        window.__tagsetNormalizeVolume = value;
        applyVolume(true);
        break;
      default:
        throw new Error('Unsupported player command.');
    }
    return true;
  };
  const ended = () => {
    if (document.querySelector('.ad-showing')) return;
    endedVideoId = trackedVideoId;
    publish();
  };
  document.addEventListener(
    'ended',
    (event) => {
      if (event.target !== active) return;
      ended();
    },
    true,
  );
  const send = () => {
    const element = media();
    const player = api();
    const data =
      typeof player?.getVideoData === 'function' ? player.getVideoData() : null;
    const candidate = data?.video_id;
    const id =
      typeof candidate === 'string' && /^[\w-]{11}$/.test(candidate)
        ? candidate
        : new URL(location.href).searchParams.get('v');
    advertisement = !!document.querySelector('.ad-showing');
    active = element;
    trackedVideoId = id;
    applyVolume();
    if (player !== playerAPI && typeof player?.getPlayerState === 'function') {
      playerAPI = player;
      player.addEventListener('onStateChange', (state) => {
        if (state === 0 || state?.data === 0) ended();
      });
    }
    publish();
  };
  const publish = () => {
    const element = media();
    const artwork = globalThis.navigator?.mediaSession?.metadata?.artwork;
    const message = {
      type: 'playback',
      loadToken: window.__tagsetLoadToken ?? null,
      artwork: artwork?.length
        ? artwork[artwork.length - 1].src
        : (document.querySelector('ytmusic-player-bar img')?.currentSrc ??
          document.querySelector('ytmusic-player img')?.currentSrc ??
          null),
      advertisement,
      videoId: trackedVideoId,
      endedVideoId,
      title:
        document
          .querySelector('ytmusic-player-bar .title')
          ?.textContent?.trim() ||
        document.title.replace(/ - YouTube Music$/, ''),
      paused: element?.paused ?? true,
      position: Number.isFinite(element?.currentTime) ? element.currentTime : 0,
      duration: Number.isFinite(element?.duration) ? element.duration : 0,
    };
    window.__tagsetPlayback = message;
    window.tagsetPlaybackHost?.report(message);
    window.webkit?.messageHandlers.wrapperPlayback?.postMessage(message);
  };
  setInterval(send, 500);
  send();
})();

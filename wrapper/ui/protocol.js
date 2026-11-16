(() => {
  const sampleVideoId = 'EsAQYAeqxD4';

  function videoId(value) {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      ![
        'music.youtube.com',
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'youtu.be',
      ].includes(url.hostname)
    )
      throw new Error('Enter an HTTPS YouTube Music or YouTube song link.');
    const id =
      url.hostname === 'youtu.be'
        ? url.pathname.slice(1)
        : url.pathname === '/watch'
          ? url.searchParams.get('v')
          : null;
    if (!id || !/^[\w-]{11}$/.test(id))
      throw new Error('The link must identify a single song.');
    return id;
  }

  function validateCommand(value) {
    if (!value || typeof value !== 'object')
      throw new Error('Invalid command.');
    if (value.type === 'play' || value.type === 'pause')
      return { type: value.type };
    if (
      (value.type === 'seek' || value.type === 'volume') &&
      typeof value.value === 'number' &&
      Number.isFinite(value.value) &&
      value.value >= 0 &&
      value.value <= (value.type === 'volume' ? 100 : 604800)
    )
      return { type: value.type, value: value.value };
    if (
      value.type === 'layout' &&
      typeof value.visible === 'boolean' &&
      ['x', 'y', 'width', 'height'].every(
        (key) =>
          typeof value[key] === 'number' &&
          Number.isFinite(value[key]) &&
          Math.abs(value[key]) <= 100_000,
      ) &&
      value.width >= 0 &&
      value.height >= 0
    )
      return {
        type: 'layout',
        visible: value.visible,
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height,
      };
    if (
      value.type === 'load' &&
      typeof value.videoId === 'string' &&
      /^[\w-]{11}$/.test(value.videoId)
    )
      return {
        type: 'load',
        videoId: value.videoId,
        ...(typeof value.token === 'string' && /^[\w-]{1,80}$/.test(value.token)
          ? { token: value.token }
          : {}),
      };
    throw new Error('Unsupported player command.');
  }

  function allowedNavigation(value) {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        [
          'music.youtube.com',
          'www.youtube.com',
          'accounts.google.com',
          'accounts.youtube.com',
          'www.google.com',
          'consent.google.com',
          'consent.youtube.com',
        ].includes(url.hostname)
      );
    } catch {
      return false;
    }
  }

  function artworkURL(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        [
          'i.ytimg.com',
          'img.youtube.com',
          'lh3.googleusercontent.com',
          'lh4.googleusercontent.com',
          'lh5.googleusercontent.com',
          'lh6.googleusercontent.com',
          'yt3.googleusercontent.com',
          'yt3.ggpht.com',
          'lh3.ggpht.com',
        ].includes(url.hostname)
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  globalThis.setwiseProtocol = Object.freeze({
    sampleVideoId,
    videoId,
    validateCommand,
    allowedNavigation,
    artworkURL,
  });
})();

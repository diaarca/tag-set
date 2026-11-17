(() => {
  function validatePreferences(value) {
    if (value === null)
      return {
        version: 1,
        normalizeVolume: false,
        githubRepository: '',
        githubBranch: 'main',
      };
    if (
      !value ||
      value.version !== 1 ||
      typeof value.normalizeVolume !== 'boolean'
    )
      throw new Error(
        'Invalid settings. The saved settings have not been changed.',
      );
    const config = value.githubRepository
      ? validateGitHubConfig({
          repository: value.githubRepository,
          branch: value.githubBranch ?? 'main',
        })
      : { repository: '', branch: 'main' };
    return {
      version: 1,
      normalizeVolume: value.normalizeVolume,
      githubRepository: config.repository,
      githubBranch: config.branch,
    };
  }
  function validateGitHubConfig(value) {
    if (
      !value ||
      typeof value.repository !== 'string' ||
      !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(value.repository) ||
      ['.', '..'].includes(value.repository.split('/')[1]) ||
      typeof value.branch !== 'string' ||
      !value.branch.trim() ||
      value.branch.length > 200 ||
      /[\s?\\#]/.test(value.branch) ||
      [...value.branch].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error('Enter a repository as owner/repo and a valid branch.');
    return { repository: value.repository, branch: value.branch };
  }
  function validateCommand(value) {
    if (!value || typeof value !== 'object')
      throw new Error('Invalid command.');
    if (value.type === 'play' || value.type === 'pause')
      return { type: value.type };
    if (value.type === 'normalization' && typeof value.enabled === 'boolean')
      return { type: value.type, enabled: value.enabled };
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

  globalThis.tagsetProtocol = Object.freeze({
    validateCommand,
    allowedNavigation,
    artworkURL,
    validatePreferences,
    validateGitHubConfig,
  });
})();

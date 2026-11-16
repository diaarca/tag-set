export function createTrackNavigation(contents) {
  let pending;
  contents.on('will-prevent-unload', (event) => {
    // An explicit queue change must be able to leave the currently playing page.
    if (pending && contents.getURL().startsWith('https://music.youtube.com/'))
      event.preventDefault();
  });
  return async (videoId) => {
    const request = {};
    pending = request;
    try {
      await contents.loadURL(`https://music.youtube.com/watch?v=${videoId}`);
    } catch (error) {
      // Rapid skips deliberately cancel older requests; only the latest can fail.
      if (pending === request) throw error;
    } finally {
      if (pending === request) pending = undefined;
    }
  };
}

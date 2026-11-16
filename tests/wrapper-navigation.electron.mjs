import { app, BrowserWindow, WebContentsView } from 'electron';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createTrackNavigation } from '../wrapper/desktop/navigation.mjs';

app.setPath('userData', resolve('apple/.build/wrapper-navigation-test'));
app.whenReady().then(async () => {
  app.dock?.hide();
  const timeout = setTimeout(() => {
    console.error('Track navigation test timed out.');
    app.exit(1);
  }, 15_000);
  try {
    const window = new BrowserWindow({ show: false });
    const player = new WebContentsView();
    window.contentView.addChildView(player);
    player.setVisible(false);
    const contents = player.webContents;
    const page = (title) => `data:text/html,${encodeURIComponent(title)}`;
    const blockUnload = () =>
      contents.executeJavaScript(
        `window.onbeforeunload = event => { event.preventDefault(); event.returnValue = ''; }; true`,
        true,
      );
    await contents.loadURL(page('Song A'));
    await blockUnload();
    await assert.rejects(contents.loadURL(page('Song B')), {
      code: 'ERR_ABORTED',
    });
    assert.equal(
      await contents.executeJavaScript('document.body.textContent'),
      'Song A',
    );

    // Replace the network only; Chromium still executes real beforeunload events.
    const loadTrack = createTrackNavigation({
      on: (...args) => contents.on(...args),
      getURL: () => 'https://music.youtube.com/watch?v=00000000001',
      loadURL: (url) =>
        contents.loadURL(page(new URL(url).searchParams.get('v'))),
    });
    for (const id of ['00000000002', '00000000003']) {
      await loadTrack(id);
      assert.equal(
        await contents.executeJavaScript('document.body.textContent'),
        id,
      );
      await blockUnload();
    }
    // Ordinary website navigation still retains its leave-page protection.
    await assert.rejects(contents.loadURL(page('Account settings')), {
      code: 'ERR_ABORTED',
    });
    contents.close();
    window.destroy();
    console.log(
      'Passed: blocked navigation reproduced; consecutive Setwise skips succeed; ordinary navigation stays protected.',
    );
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

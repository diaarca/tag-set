import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

app.setPath('userData', resolve('.build/interface-test'));
app.whenReady().then(async () => {
  app.dock?.hide();
  const timeout = setTimeout(() => app.exit(1), 20_000);
  try {
    const songs = [1, 2, 3].map((id) => ({
      id,
      videoId: String(id).padStart(11, '0'),
      title: `Song ${id}`,
      artists: ['Artist'],
    }));
    let saved = JSON.stringify({
      version: 1,
      nextSongId: 4,
      nextTagId: 2,
      songs,
      tags: [{ id: 1, name: 'Artist', pinned: false }],
      edges: [],
      assignments: songs.map((song) => ({
        songId: song.id,
        tagId: 1,
        origin: 'artist',
      })),
    });
    let exported, playback;
    const commands = [];
    const window = new BrowserWindow({
      show: false,
      width: 1420,
      height: 900,
      webPreferences: {
        preload: resolve('wrapper/desktop/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ['https://*/*', 'http://*/*'] },
      (_details, done) => done({ cancel: true }),
    );
    ipcMain.handle('wrapper-request', (_event, operation, payload) => {
      if (operation === 'readLibrary') return saved;
      if (operation === 'writeLibrary') {
        assert.equal(payload.previous, saved);
        saved = payload.data;
        return null;
      }
      if (operation === 'exportLibrary') {
        exported = JSON.parse(payload);
        return null;
      }
      throw new Error(`Unexpected operation: ${operation}`);
    });
    const report = () => window.webContents.send('wrapper-message', playback);
    ipcMain.on('wrapper-command', (_event, command) => {
      commands.push(command);
      if (command.type === 'load') {
        playback = {
          type: 'playback',
          loadToken: command.token,
          videoId: command.videoId,
          paused: false,
          advertisement: false,
          position: 10,
          duration: 255,
          title: 'Song',
        };
        setTimeout(report, 10);
      } else if (playback && ['play', 'pause'].includes(command.type)) {
        playback.paused = command.type === 'pause';
        setTimeout(report, 10);
      }
    });
    const evaluate = (script) => window.webContents.executeJavaScript(script);
    const waitFor = async (condition) => {
      const deadline = Date.now() + 4000;
      while (!(await evaluate(condition))) {
        assert.ok(Date.now() < deadline, `Timed out: ${condition}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    await window.loadFile(resolve('wrapper/bundle/index.html'));
    await waitFor("document.querySelectorAll('.song-row').length === 3");
    await evaluate("document.querySelector('.new-tag').click()");
    await waitFor("!!document.querySelector('dialog[open] input')");
    await evaluate(`const input = document.querySelector('dialog input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Mood');
      input.dispatchEvent(new Event('input', { bubbles: true }));`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await evaluate("document.querySelector('dialog form button').click()");
    await waitFor(
      "Array.from(document.querySelectorAll('.tag-navigation button')).some(button => button.textContent.includes('Mood'))",
    );
    await evaluate(
      'document.querySelector(\'[aria-label="Close dialog"]\').click()',
    );
    await evaluate(
      "Array.from(document.querySelectorAll('.tag-navigation button')).find(button => button.textContent.includes('Mood')).click()",
    );
    await waitFor(
      "!!document.querySelector('.collection-actions button[aria-pressed]')",
    );
    await evaluate(
      "document.querySelector('.collection-actions button[aria-pressed]').click()",
    );
    await waitFor(
      "document.querySelector('.collection-actions button[aria-pressed]')?.getAttribute('aria-pressed') === 'true'",
    );
    assert.ok(JSON.parse(saved).tags.find((tag) => tag.name === 'Mood').pinned);
    await window.loadFile(resolve('wrapper/bundle/index.html'));
    await waitFor(
      "Array.from(document.querySelectorAll('.tag-navigation button')).some(button => button.textContent.includes('Mood'))",
    );
    await evaluate(
      "Math.random = () => 0; Array.from(document.querySelectorAll('.collection-actions button')).find(button => button.textContent.includes('Shuffle play')).click()",
    );
    await waitFor(
      "document.querySelector('.now-playing h2')?.textContent === 'Song 2' && !document.querySelector('[aria-label=Seek]').disabled",
    );
    assert.equal(playback.videoId, songs[1].videoId);
    assert.equal(
      await evaluate(
        "document.querySelector('[aria-label=Shuffle]').getAttribute('aria-pressed')",
      ),
      'true',
    );
    assert.ok(
      await evaluate(
        "document.querySelector('[aria-label=\"Repeat: all\"]').classList.contains('active')",
      ),
    );
    await evaluate(
      "document.querySelector('.primary.play-collection').click()",
    );
    await waitFor(
      "document.querySelector('.now-playing h2')?.textContent === 'Song 1'",
    );
    await waitFor(
      "!!document.querySelector('[aria-label=Pause]') && !document.querySelector('[aria-label=Seek]').disabled",
    );
    assert.equal(
      await evaluate(`document.hasFocus = () => true;
      Object.defineProperty(document, 'hidden', { get: () => false });
      const seek = document.querySelector('[aria-label=Seek]'); seek.focus();
      const event = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
      seek.dispatchEvent(event); event.defaultPrevented;`),
      true,
    );
    await waitFor("!!document.querySelector('[aria-label=Play]')");
    assert.ok(commands.some((command) => command.type === 'pause'));
    await evaluate(
      "Array.from(document.querySelectorAll('.topbar button')).find(button => button.textContent.includes('Export library')).click()",
    );
    await waitFor(
      "!document.querySelector('.library-transfer button').disabled",
    );
    assert.equal(exported.songs.length, 3);
    assert.ok(exported.tags.find((tag) => tag.name === 'Mood').pinned);
    for (const width of [1420, 1000, 390]) {
      window.setSize(width, 900);
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (width === 1000)
        assert.equal(
          await evaluate(
            "getComputedStyle(document.querySelector('.player-panel')).gridColumnStart",
          ),
          '2',
        );
      if (width === 390)
        assert.equal(
          await evaluate(
            "getComputedStyle(document.querySelector('.app-shell')).display",
          ),
          'block',
        );
    }
    window.destroy();
    clearTimeout(timeout);
    console.log(
      'Passed: tag editing/pinning, persistence, export, shuffle/repeat, slider keyboard controls, and responsive layout.',
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

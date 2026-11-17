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
    const typeInto = async (label, value) => {
      await evaluate(`(() => {
        const input = document.querySelector('[aria-label="${label}"]');
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    };
    const press = (key) =>
      evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, bubbles: true, cancelable: true,
    }))`);
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
    await waitFor('!!document.querySelector(\'[aria-label="Parent tag"]\')');
    await typeInto('Parent tag', 'Atmosphere');
    await waitFor(
      "document.querySelector('[role=option]')?.textContent.includes('Create “Atmosphere”')",
    );
    await press('Enter');
    await waitFor(
      "document.querySelector('.relationship-list')?.textContent.includes('Atmosphere')",
    );
    await typeInto('Child tag', 'ART');
    await waitFor(
      "document.querySelector('[role=option]')?.textContent.trim() === 'Artist'",
    );
    await evaluate("document.querySelector('[role=option]').click()");
    await waitFor(
      "Array.from(document.querySelectorAll('.relationship-list')).some(list => list.textContent.includes('Artist'))",
    );
    const edges = JSON.parse(saved).edges;
    assert.equal(edges.length, 2);
    await typeInto('Child tag', ' artist ');
    assert.equal(
      await evaluate("document.querySelectorAll('[role=option]').length"),
      0,
    );
    await typeInto('Parent tag', 'ARTIST');
    await press('Enter');
    await waitFor(
      "document.querySelector('[role=alert]')?.textContent.includes('cycle')",
    );
    assert.deepEqual(JSON.parse(saved).edges, edges);
    await typeInto('Parent tag', 'Mood');
    assert.equal(
      await evaluate("document.querySelectorAll('[role=option]').length"),
      0,
    );
    await evaluate(
      'document.querySelector(\'[aria-label="Close dialog"]\').click()',
    );
    await evaluate(
      'document.querySelector(\'[aria-label="Edit Song 1"]\').click()',
    );
    await waitFor('!!document.querySelector(\'[aria-label="Tag to assign"]\')');
    await typeInto('Tag to assign', 'Focus');
    await press('Enter');
    await waitFor(
      "document.querySelector('.membership-list')?.textContent.includes('Focus')",
    );
    await typeInto('Tag to assign', ' moo ');
    await waitFor(
      "document.querySelector('[role=option]')?.textContent.trim() === 'Mood'",
    );
    // Navigate to the explicit creation option, then back to the existing tag.
    await press('ArrowDown');
    await waitFor(
      "document.querySelector('[role=option][aria-selected=true]')?.textContent.includes('Create')",
    );
    await press('ArrowUp');
    await waitFor(
      "document.querySelector('[role=option][aria-selected=true]')?.textContent.trim() === 'Mood'",
    );
    await press('Enter');
    await waitFor(
      '!!document.querySelector(\'[aria-label="Remove direct Mood tag"]\')',
    );
    await typeInto('Tag to assign', ' MOOD ');
    assert.equal(
      await evaluate("document.querySelectorAll('[role=option]').length"),
      0,
    );
    const tags = JSON.parse(saved).tags;
    assert.equal(
      tags.filter((tag) => tag.name.toLowerCase() === 'mood').length,
      1,
    );
    assert.ok(tags.some((tag) => tag.name === 'Focus'));
    await press('Escape');
    await waitFor(
      "document.querySelector('[role=combobox]')?.getAttribute('aria-expanded') === 'false'",
    );
    assert.ok(await evaluate("!!document.querySelector('dialog[open]')"));
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
    const tagNames =
      "Array.from(document.querySelectorAll('.tag-navigation .nav-name'), item => item.textContent)";
    const groupTitles =
      "Array.from(document.querySelectorAll('.nav-group-title'), item => item.firstChild.textContent.trim())";
    assert.deepEqual(await evaluate(tagNames), [
      'Mood',
      'Atmosphere',
      'Focus',
      'Artist',
    ]);
    assert.deepEqual(await evaluate(groupTitles), [
      'PINNED TAGS',
      'CREATED TAGS',
      'ARTISTS',
    ]);
    await typeInto('Find a tag', 'ART');
    await waitFor(
      "document.querySelectorAll('.tag-navigation button').length === 1",
    );
    assert.deepEqual(await evaluate(groupTitles), ['ARTISTS']);
    assert.deepEqual(await evaluate(tagNames), ['Artist']);
    await typeInto('Find a tag', '');
    await waitFor(
      "document.querySelectorAll('.tag-navigation button').length === 4",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('.tag-navigation .nav-name')).find(item => item.textContent === 'Artist').closest('button').click()",
    );
    await waitFor(
      "document.querySelector('.breadcrumb strong')?.textContent === 'Artist'",
    );
    await evaluate(
      "document.querySelector('.collection-actions button[aria-pressed]').click()",
    );
    await waitFor(
      "document.querySelector('.tag-navigation .nav-name')?.textContent === 'Artist'",
    );
    assert.deepEqual(await evaluate(tagNames), [
      'Artist',
      'Mood',
      'Atmosphere',
      'Focus',
    ]);
    assert.deepEqual(await evaluate(groupTitles), [
      'PINNED TAGS',
      'CREATED TAGS',
    ]);
    await evaluate(
      "document.querySelector('.collection-actions button[aria-pressed]').click()",
    );
    await waitFor(
      "document.querySelector('.tag-navigation .nav-name')?.textContent === 'Mood'",
    );
    assert.deepEqual(await evaluate(tagNames), [
      'Mood',
      'Atmosphere',
      'Focus',
      'Artist',
    ]);
    await evaluate("document.querySelector('.all-songs').click()");
    await waitFor(
      "document.querySelector('.breadcrumb strong')?.textContent === 'All songs'",
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
      'Passed: searchable tag assignment/creation, cycle rejection, tag grouping/search/pinning, persistence, export, shuffle/repeat, slider keyboard controls, and responsive layout.',
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

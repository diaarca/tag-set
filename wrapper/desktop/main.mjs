import { app, BrowserWindow, WebContentsView, ipcMain, dialog } from 'electron';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import '../ui/protocol.js';
import { atomicWrite, createLibraryStorage, libraryText } from './storage.mjs';
import { catalogRequest } from './catalog.mjs';
import { createTrackNavigation } from './navigation.mjs';
const { allowedNavigation, validateCommand, artworkURL } =
  globalThis.setwiseProtocol;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const uiURL = pathToFileURL(join(root, 'bundle/index.html')).href;
const bridge = readFileSync(join(root, 'player-bridge.js'), 'utf8');
app.setName('Setwise Wrapper');
let window;
let music;
let storage;
let loadToken = null;
let musicFrame;
let volume = 70;
let loadTrack;

function applyFrame() {
  if (!musicFrame || !window || !music) return;
  const [width, height] = window.getContentSize(),
    frame = musicFrame;
  const visible =
    frame.visible &&
    frame.width > 0 &&
    frame.height > 0 &&
    frame.x < width &&
    frame.y < height &&
    frame.x + frame.width > 0 &&
    frame.y + frame.height > 0;
  music.setVisible(visible);
  if (visible)
    music.setBounds({
      x: Math.round(frame.x),
      y: Math.round(frame.y),
      width: Math.min(width, Math.round(frame.width)),
      height: Math.min(height, Math.round(frame.height)),
    });
}

function configureNavigation(contents) {
  const guard = (event, url) => {
    if (allowedNavigation(url)) return;
    event.preventDefault();
    let host = 'an unsupported destination';
    try {
      host = new URL(url).hostname || host;
    } catch {
      /* An invalid URL stays blocked. */
    }
    report({ error: `The wrapper blocked navigation to ${host}.` });
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({ url }) => {
    if (!allowedNavigation(url)) {
      report({ error: 'This popup cannot be opened inside the test player.' });
      return { action: 'deny' };
    }
    // Preserve the popup's opener and session so sign-in can complete normally.
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: window,
        width: 520,
        height: 760,
        webPreferences: {
          session: contents.session,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      },
    };
  });
  contents.on('did-create-window', (popup) =>
    configureNavigation(popup.webContents),
  );
}

function report(message) {
  if (window && !window.isDestroyed())
    window.webContents.send('wrapper-message', message);
}

function openMusic(url) {
  if (allowedNavigation(url))
    void music.webContents.loadURL(url).catch((error) => {
      if (error.code !== 'ERR_ABORTED') report({ error: error.message });
    });
}

function createWindow() {
  storage ??= createLibraryStorage(
    join(app.getPath('userData'), 'library.json'),
  );
  window = new BrowserWindow({
    title: 'Setwise',
    width: 1420,
    height: 900,
    minWidth: 380,
    minHeight: 600,
    webPreferences: {
      preload: join(root, 'desktop/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  music = new WebContentsView({
    webPreferences: {
      preload: join(root, 'desktop/playback-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:setwise-youtube-music',
      backgroundThrottling: false,
    },
  });
  music.setVisible(false);
  loadTrack = createTrackNavigation(music.webContents);
  music.setBounds({ x: 0, y: 0, width: 600, height: 600 });
  window.contentView.addChildView(music);
  musicFrame = undefined;
  window.on('resize', applyFrame);
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  configureNavigation(music.webContents);
  music.webContents.session.setPermissionRequestHandler(
    (_contents, permission, callback) => {
      callback(false);
      report({ error: `The wrapper declined the '${permission}' permission.` });
    },
  );
  music.webContents.on('did-finish-load', () => {
    if (new URL(music.webContents.getURL()).hostname === 'music.youtube.com')
      void music.webContents
        .executeJavaScript(
          `window.__setwiseLoadToken = ${JSON.stringify(loadToken)}; window.__setwisePreferredVolume = ${volume / 100}; ${bridge}`,
        )
        .catch((error) => report({ error: error.message }));
  });
  music.webContents.on(
    'did-fail-load',
    (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3)
        report({ error: `YouTube Music could not load: ${description}` });
    },
  );
  void window.loadURL(uiURL);
  openMusic('https://music.youtube.com/');
  window.on('closed', () => {
    music.webContents.close();
    window = undefined;
  });
}

ipcMain.on('wrapper-playback', (event, value) => {
  if (
    !music ||
    music.webContents.isDestroyed() ||
    event.sender !== music.webContents ||
    event.senderFrame?.parent ||
    !event.senderFrame?.url.startsWith('https://music.youtube.com/') ||
    !['playback', 'media-action'].includes(value?.type)
  )
    return;
  if (value.type === 'media-action') {
    if (
      (value.action === 'next' || value.action === 'previous') &&
      value.loadToken === loadToken
    )
      report({
        type: 'media-action',
        action: value.action,
        loadToken,
      });
    return;
  }
  const identity = (id) =>
    typeof id === 'string' && /^[\w-]{11}$/.test(id) ? id : null;
  report({
    type: 'playback',
    videoId: identity(value.videoId),
    endedVideoId: identity(value.endedVideoId),
    title: typeof value.title === 'string' ? value.title.slice(0, 300) : '',
    artwork: artworkURL(value.artwork),
    paused: value.paused !== false,
    advertisement: value.advertisement === true,
    position: Number.isFinite(value.position) ? value.position : 0,
    duration: Number.isFinite(value.duration) ? value.duration : 0,
    loadToken:
      typeof value.loadToken === 'string' ? value.loadToken.slice(0, 80) : null,
  });
});

function trusted(event) {
  return (
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    !event.senderFrame?.parent &&
    event.senderFrame?.url === uiURL
  );
}

ipcMain.handle('wrapper-request', async (event, operation, payload) => {
  if (!trusted(event))
    throw new Error('Only the local Setwise interface can access its library.');
  switch (operation) {
    case 'readLibrary':
      return storage.read();
    case 'writeLibrary':
      if (!payload || typeof payload !== 'object')
        throw new Error('Invalid library write.');
      await storage.write(payload.data, payload.previous);
      return null;
    case 'catalog':
      return catalogRequest(payload);
    case 'exportLibrary': {
      const data = libraryText(payload);
      const result = await dialog.showSaveDialog(window, {
        defaultPath: 'setwise-library.json',
        filters: [{ name: 'Setwise library', extensions: ['json'] }],
      });
      if (!result.canceled && result.filePath)
        await atomicWrite(result.filePath, data);
      return null;
    }
    default:
      throw new Error('Unsupported native operation.');
  }
});

ipcMain.on('wrapper-command', async (event, value) => {
  if (!trusted(event)) return;
  try {
    const command = validateCommand(value);
    if (command.type === 'layout') {
      musicFrame = command;
      applyFrame();
      return;
    }
    if (command.type === 'load') {
      loadToken = command.token ?? null;
      await loadTrack(command.videoId);
      return;
    }
    if (command.type === 'volume') {
      volume = command.value;
      if (music.webContents.getURL().startsWith('https://music.youtube.com/'))
        await music.webContents.executeJavaScript(
          `(() => { window.__setwisePreferredVolume = ${volume / 100}; return window.__setwiseControl?.('volume', ${volume}); })()`,
        );
      return;
    }
    if (!music.webContents.getURL().startsWith('https://music.youtube.com/'))
      throw new Error('Return to YouTube Music before controlling playback.');
    await music.webContents.executeJavaScript(
      `(async () => { if (!window.__setwiseControl) { ${command.type === 'pause' ? 'return true' : "throw new Error('YouTube Music is still loading. Open YouTube Music if playback needs a prompt.')"}; } return await window.__setwiseControl(${JSON.stringify(command.type)}, ${command.type === 'seek' ? command.value : 'null'}); })()`,
      true,
    );
  } catch (error) {
    report({ error: error.message });
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) createWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  void app.whenReady().then(createWindow);
  app.on('activate', () => {
    if (!window || window.isDestroyed()) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

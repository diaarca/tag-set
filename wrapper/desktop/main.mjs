import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  dialog,
  Menu,
  safeStorage,
} from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { createGitHubClient } from './github.mjs';
import '../protocol.js';
import {
  atomicWrite,
  createLibraryLocationStorage,
  createPreferencesStorage,
  libraryText,
} from './storage.mjs';
import { catalogRequest } from './catalog.mjs';
import { createSleepTimer } from './sleep-timer.mjs';
import { createTrackNavigation } from './navigation.mjs';
const { allowedNavigation, validateCommand, artworkURL } =
  globalThis.tagsetProtocol;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const uiURL = pathToFileURL(join(root, 'bundle/index.html')).href;
const bridge = readFileSync(join(root, 'player-bridge.js'), 'utf8');
app.setName('TagSet');
const appData = app.getPath('appData');
const legacyUserData = join(appData, 'Setwise Wrapper');
const userData = join(appData, 'TagSet');
// Preserve data and session storage from the previous app name.
if (!existsSync(userData) && existsSync(legacyUserData))
  renameSync(legacyUserData, userData);
mkdirSync(userData, { recursive: true, mode: 0o700 });
app.setPath('userData', userData);
app.setPath('sessionData', userData);
let window;
let music;
let storage;
let loadToken = null;
let musicFrame;
let volume = 70;
let normalizeVolume = false;
const preferencesStorage = createPreferencesStorage(
  join(userData, 'preferences.json'),
);
const githubTokenFile = join(userData, 'github-token.bin');
const secureStorage = () => {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
    throw new Error('A system keychain is required to store the GitHub token.');
};
const readGitHubToken = async () => {
  let encrypted;
  try {
    encrypted = await readFile(githubTokenFile);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  secureStorage();
  try {
    return safeStorage.decryptString(encrypted);
  } catch {
    throw new Error('The GitHub token could not be unlocked. Save it again.');
  }
};
const github = createGitHubClient(readGitHubToken);
let loadTrack;
const pauseForSleep = () => {
  if (!music || music.webContents.isDestroyed()) return;
  void music.webContents
    .executeJavaScript(
      `(async () => { try { await window.__tagsetControl?.('pause'); } finally { document.querySelectorAll('video, audio').forEach(media => media.pause()); } })()`,
    )
    .catch((error) => report({ error: error.message }));
};
const sleepTimer = createSleepTimer(report, pauseForSleep);

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
      report({ error: 'This popup cannot be opened inside TagSet.' });
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
  storage ??= createLibraryLocationStorage(
    join(app.getPath('userData'), 'library.json'),
    join(app.getPath('userData'), 'library-location.json'),
  );
  window = new BrowserWindow({
    title: 'TagSet',
    icon: join(root, 'bundle/icon.png'),
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
  app.dock?.setIcon(join(root, 'bundle/icon.png'));
  music = new WebContentsView({
    webPreferences: {
      preload: join(root, 'desktop/playback-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Keep the partition identifier so existing YouTube Music sessions survive.
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
          `window.__tagsetLoadToken = ${JSON.stringify(loadToken)}; window.__tagsetPreferredVolume = ${volume / 100}; window.__tagsetNormalizeVolume = ${normalizeVolume}; ${bridge}`,
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
    sleepTimer.set(0);
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
  if (sleepTimer.expired) {
    if (value.paused === false) pauseForSleep();
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
    throw new Error('Only the local TagSet interface can access its library.');
  switch (operation) {
    case 'libraryLocation':
      return storage.location();
    case 'chooseLibraryFolder': {
      const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return storage.prepare(result.filePaths[0]);
    }
    case 'defaultLibraryFolder':
      return storage.prepare(null);
    case 'cancelLibraryLocation':
      await storage.cancel();
      return null;
    case 'activateLibraryLocation':
      if (
        !payload ||
        typeof payload !== 'object' ||
        typeof payload.token !== 'string'
      )
        throw new Error('Invalid library location request.');
      return storage.activate(payload.token, payload.data, payload.previous);
    case 'hasGitHubToken':
      return (await readGitHubToken()) !== null;
    case 'saveGitHubToken': {
      if (
        typeof payload !== 'string' ||
        payload.length > 1024 ||
        !/^[A-Za-z0-9_]+$/.test(payload)
      )
        throw new Error('Invalid GitHub token.');
      secureStorage();
      await atomicWrite(githubTokenFile, safeStorage.encryptString(payload));
      return null;
    }
    case 'removeGitHubToken':
      await rm(githubTokenFile, { force: true });
      return null;
    case 'githubPull':
      return github.pull(payload);
    case 'githubPush':
      if (!payload || typeof payload !== 'object')
        throw new Error('Invalid GitHub request.');
      return github.push(payload, payload.data, payload.sha);
    case 'readPreferences':
      return preferencesStorage.read();
    case 'writePreferences':
      await preferencesStorage.write(payload);
      return null;
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
        defaultPath: 'tagset-library.json',
        filters: [{ name: 'TagSet library', extensions: ['json'] }],
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
    if (command.type === 'sleep-timer') {
      sleepTimer.set(command.minutes);
      return;
    }
    if (command.type === 'playback-state') {
      sleepTimer.synchronize();
      return;
    }
    if (command.type === 'play' || command.type === 'load') sleepTimer.resume();
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
    if (command.type === 'volume' || command.type === 'normalization') {
      if (command.type === 'volume') volume = command.value;
      else normalizeVolume = command.enabled;
      if (music.webContents.getURL().startsWith('https://music.youtube.com/'))
        await music.webContents.executeJavaScript(
          `(() => { window.__tagsetPreferredVolume = ${volume / 100}; window.__tagsetNormalizeVolume = ${normalizeVolume}; return window.__tagsetControl?.(${JSON.stringify(command.type)}, ${command.type === 'volume' ? volume : normalizeVolume}); })()`,
        );
      return;
    }
    if (!music.webContents.getURL().startsWith('https://music.youtube.com/'))
      throw new Error('Return to YouTube Music before controlling playback.');
    await music.webContents.executeJavaScript(
      `(async () => { if (!window.__tagsetControl) { ${command.type === 'pause' ? 'return true' : "throw new Error('YouTube Music is still loading. Open YouTube Music if playback needs a prompt.')"}; } return await window.__tagsetControl(${JSON.stringify(command.type)}, ${command.type === 'seek' ? command.value : 'null'}); })()`,
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
  void app.whenReady().then(() => {
    app.setAboutPanelOptions({ applicationName: 'TagSet' });
    if (process.platform === 'darwin')
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'TagSet',
            submenu: [
              { label: 'About TagSet', role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { label: 'Hide TagSet', role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { label: 'Quit TagSet', role: 'quit' },
            ],
          },
          { role: 'fileMenu' },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ]),
      );
    createWindow();
  });
  app.on('activate', () => {
    if (!window || window.isDestroyed()) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

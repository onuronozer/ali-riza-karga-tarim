import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closeDatabase, initializeDatabase } from './db/connection';
import { runMigrations } from './db/migrate';
import { registerIpcHandlers } from './ipc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPLASH_MIN_VISIBLE_MS = 1200;

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

function resolvePalaogluLogoUrl(): string {
  const candidatePaths = [
    join(app.getAppPath(), 'assets', 'palaoglu-logo.png'),
    join(__dirname, '../assets/palaoglu-logo.png'),
    join(__dirname, '../../src/shared/assets/palaoglu-logo.png'),
    join(process.cwd(), 'src/shared/assets/palaoglu-logo.png'),
    join(process.cwd(), 'assets/palaoglu-logo.png')
  ];

  const logoPath = candidatePaths.find((candidate) => existsSync(candidate));
  return logoPath ? pathToFileURL(logoPath).toString() : '';
}

function createSplashMarkup(logoUrl: string): string {
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 100vw;
        height: 100vh;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: linear-gradient(145deg, #0d321e 0%, #173823 55%, #092515 100%);
        color: #142019;
        font-family: "Segoe UI", Arial, sans-serif;
      }
      .card {
        width: 430px;
        min-height: 330px;
        padding: 24px 28px 26px;
        border: 1px solid rgba(230, 161, 58, 0.45);
        border-radius: 20px;
        background: #f8f8f4;
        box-shadow: 0 22px 56px rgba(0, 0, 0, 0.34);
        text-align: center;
      }
      img {
        width: 238px;
        height: 238px;
        object-fit: contain;
        margin: -2px auto 8px;
        display: block;
      }
      h1 {
        margin: 0;
        font-size: 22px;
        line-height: 1.2;
        color: #0f2819;
      }
      p {
        margin: 8px 0 18px;
        color: #5e6d61;
        font-size: 14px;
        font-weight: 650;
      }
      .bar {
        width: 100%;
        height: 8px;
        overflow: hidden;
        border-radius: 99px;
        background: #dfe8d9;
      }
      .bar::before {
        content: "";
        display: block;
        width: 42%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #d99e36, #f1c56d);
        animation: load 1.2s ease-in-out infinite;
      }
      @keyframes load {
        0% { transform: translateX(-110%); }
        100% { transform: translateX(250%); }
      }
    </style>
  </head>
  <body>
    <section class="card">
      ${logoUrl ? `<img src="${logoUrl}" alt="" />` : ''}
      <h1>Ali Rıza Karga TARIM</h1>
      <p>Kurumsal tarım paneli açılıyor...</p>
      <div class="bar" aria-hidden="true"></div>
    </section>
  </body>
</html>`;
}

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 400,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: true,
    title: 'Ali Rıza Karga TARIM',
    backgroundColor: '#0d321e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createSplashMarkup(resolvePalaogluLogoUrl()))}`);
}

function revealMainWindow(): void {
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, SPLASH_MIN_VISIBLE_MS);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 1120,
    minHeight: 720,
    title: 'Ali Rıza Karga TARIM',
    backgroundColor: '#f7f8f3',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', revealMainWindow);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const databasePath = join(app.getPath('userData'), 'data', 'ali-riza-karga-tarim.sqlite');

  initializeDatabase(databasePath);
  runMigrations();
  registerIpcHandlers();
  createSplashWindow();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});

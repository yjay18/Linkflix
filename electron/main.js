/* Linkflix — Electron main process (Mac).
   Starts the internal HTTP backend, then opens a native window pointed at it.
   External http(s) links (Google Drive) open in the user's default browser. */

const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const { startServer } = require('./server');

const ROOT = path.join(__dirname, '..');   // project root: index.html, css/, js/, library/
let mainWindow = null;
let serverInfo = null;

async function createWindow() {
  if (!serverInfo) {
    serverInfo = await startServer(ROOT, Number(process.env.LINKFLIX_PORT) || 4174);
    console.log(`[linkflix] serving ${ROOT} on http://127.0.0.1:${serverInfo.port}`);
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#05060b',
    title: 'Linkflix',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  // Google Drive / any external http link → default browser, not a new app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'deny' };
  });
  // A show/episode "play" navigates to a Drive URL; keep that in the browser too
  // while leaving the app's own localhost navigation intact.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverInfo.port}`)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${serverInfo.port}/index.html`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

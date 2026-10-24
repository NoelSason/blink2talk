// Electron main process: one full-screen window with no browser chrome, plus the conversation
// server (../conversation) for Claude replies, word completion, and the patient's voice.
const { app, BrowserWindow, ipcMain, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const windowed = Boolean(process.env.BLINK2TALK_WINDOWED);
const RENDERER = path.join(__dirname, 'renderer');

// The page is served from app://blink2talk/ instead of file://, because the eye tracker (MediaPipe)
// fetches its WASM runtime and face model, and fetch doesn't work on file:// URLs.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
function serveRenderer() {
  protocol.handle('app', (request) => {
    const file = path.join(RENDERER, decodeURIComponent(new URL(request.url).pathname));
    if (!file.startsWith(RENDERER + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
const SERVER = process.env.CONVERSATION_URL || 'http://localhost:8787';
const CONVERSATION_DIR = path.join(__dirname, '..', 'conversation');

// ---------- Conversation server ----------
let server = null; // set only when this app started the server, so we never stop someone else's

async function serverUp() {
  try {
    return (await fetch(`${SERVER}/config`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

async function startServer() {
  if (await serverUp()) return true;
  server = spawn('npm', ['start'], { cwd: CONVERSATION_DIR, detached: true, stdio: 'inherit' });
  server.on('error', (err) => console.error(`conversation server didn't start: ${err.message}`));
  for (let i = 0; i < 60; i++) {
    if (await serverUp()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error('conversation server not reachable; the screen uses sample replies');
  return false;
}

function stopServer() {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, 'SIGTERM'); // the whole group: npm, tsx, node
  } catch {}
  server = null;
}

const serverReady = startServer();

// The page reaches the server through here instead of fetch, so the server needs no CORS setup.
const ROUTES = new Set(['config', 'stt-token', 'replies', 'complete', 'speak']);
const GET_ROUTES = new Set(['config', 'stt-token']);
ipcMain.handle('conversation', async (_event, { route, body }) => {
  if (!ROUTES.has(route)) throw new Error(`unknown route ${route}`);
  if (!(await serverReady)) throw new Error('conversation server not running');
  const res = await fetch(`${SERVER}/${route}`, GET_ROUTES.has(route) ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 204) return null; // no Cartesia key: no voice or mic
  if (route === 'speak') return res.ok ? await res.arrayBuffer() : null;
  if (!res.ok) throw new Error(`${route} failed: ${res.status}`);
  return res.json();
});

// ---------- Window ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    fullscreen: !windowed,
    autoHideMenuBar: true,
    // Matches --bg so the window never flashes white before the page paints.
    backgroundColor: '#0F1521',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      // The selection chime and the voice play without a click; the patient never clicks.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.loadURL('app://blink2talk/index.html');
  return win;
}

app.whenReady().then(() => {
  serveRenderer();
  // The webcam watches the patient's eyes; nothing else gets a permission.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', stopServer);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

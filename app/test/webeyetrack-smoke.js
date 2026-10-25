// Smoke test for the WebEyeTrack gaze source: `npx electron test/webeyetrack-smoke.js` (in app/).
// Loads the real page under app:// with Chromium's fake camera (a synthetic stream, no face), switches
// the dev setting to WebEyeTrack, and checks that its worker loads its bundle, weights, and MediaPipe
// runtime from this app and starts producing results. No face means no box; this only proves the
// wiring. Exit code 1 on failure, with the renderer's console printed either way.
const { app, BrowserWindow, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RENDERER = path.join(__dirname, '..', 'renderer');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const file = path.join(RENDERER, decodeURIComponent(new URL(request.url).pathname));
    if (!file.startsWith(RENDERER + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false, webPreferences: { preload: path.join(RENDERER, '..', 'preload.js'), contextIsolation: true, sandbox: true, offscreen: true },
  });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  const console_ = [];
  wc.on('console-message', (e) => console_.push(`[${e.level}] ${e.message}`));
  await win.loadURL('app://blink2talk/index.html');
  await wc.executeJavaScript(`localStorage.setItem('blink2talk.dev', JSON.stringify({ gazeSource: 'webeyetrack' })); 1`);
  await win.loadURL('app://blink2talk/index.html');
  await wc.executeJavaScript(`window.__points = 0; addEventListener('eyes-point', () => window.__points++); window.__sources = new Set(); addEventListener('eyes-frame', (e) => window.__sources.add(e.detail.source)); 1`);

  const deadline = Date.now() + 45_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    await sleep(1000);
    ready = console_.some((m) => m.includes('Worker is ready'));
  }
  await sleep(6000); // let a few frames through once ready
  const points = await wc.executeJavaScript('window.__points');
  const sources = await wc.executeJavaScript('[...window.__sources]');
  // MediaPipe logs its own INFO lines at Chromium's error level; those aren't failures.
  const bad = console_.filter((m) => !/\] INFO:/.test(m) && (/^\[(error|3)\]/.test(m) || (/Refused|Failed to (load|fetch)|model\.json|wasm|webeyetrack/i.test(m) && /error|fail|refused|not found/i.test(m))));

  console.log('--- renderer console ---');
  for (const m of console_) console.log(m);
  console.log('--- result ---');
  console.log(`worker ready: ${ready}`);
  console.log(`gaze results received: ${points}`);
  console.log(`eyes-frame sources seen: ${sources.join(', ') || 'none'}`);
  console.log(`suspicious console lines: ${bad.length}`);
  const ok = ready && bad.length === 0;
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
  app.exit(ok ? 0 : 1);
});

// Stress test of the patient screen: `npm run stress` (in app/), about 6 minutes.
// Same off-screen setup as e2e.js (camera and mic blocked, sample replies, no server).
//   1. Fuzz: thousands of random inputs (looks, picks, blinks, keys, nurse speech, face lost, tired
//      mode) in random order, with the screen's invariants checked after each one.
//   2. Long session: full question -> pick -> spoken cycles, watching errors, memory, and DOM size.
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FUZZ_STEPS = 3000;
const CYCLES = 60;
let failed = 0;
const report = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
};

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  win.webContents.on('render-process-gone', (_e, d) => console.log('RENDERER GONE', JSON.stringify(d)));
  win.webContents.on('did-start-navigation', (d) => { if (d.isMainFrame && d.isSameDocument === false) console.log('NAVIGATION', d.url); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { test: '1' } });
  const js = (code) => win.webContents.executeJavaScript(code);
  await js(`window.__errors = []; addEventListener('error', e => __errors.push(e.message)); addEventListener('unhandledrejection', e => __errors.push(String(e.reason))); speechSynthesis.speak = (u) => setTimeout(() => u.onend?.(), 50); localStorage.clear(); 1`);
  await js('document.fonts.ready.then(() => 1)');

  // Everything wrong with the screen right now, as strings (empty = fine).
  // Checked after the next two frames, so the screen has drawn the state it's compared with.
  const invariants = `new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const s = window.__test.state, bad = [];
    if (!['choose', 'speaking'].includes(s.stage)) bad.push('stage ' + s.stage);
    if (s.stage === 'choose' && ![1, 2, 4].includes(s.items.length)) bad.push('items ' + s.items.length);
    if (s.hl < -1 || s.hl >= s.items.length || (s.hl >= 0 && !s.items[s.hl])) bad.push('hl ' + s.hl);
    if (s.selected >= 0 && !s.items[s.selected]) bad.push('selected ' + s.selected);
    if (s.rowKind === 'spell' && !s.spell) bad.push('spell without state');
    const shown = document.querySelectorAll('#reply-row > [role=option], #reply-row > .grid-empty').length;
    if (s.stage === 'choose' && !s.loading && shown !== s.items.length) bad.push('drawn ' + shown + ' vs ' + s.items.length);
    if (__errors.length) bad.push('errors: ' + __errors.join(' | '));
    done(bad);
  })))`;

  // 1. Fuzz.
  const QUADS = ["'topLeft'", "'topRight'", "'bottomLeft'", "'bottomRight'", 'null'];
  const QUESTIONS = ['Are you in pain?', 'Do you want some water?', 'Should I call your daughter?', 'Are you cold?', 'Can I take you to the X-ray?'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const actions = [
    () => `window.__test.camera.focus(${pick(QUADS)})`,
    () => `window.__test.camera.select(${pick(QUADS)})`,
    () => `window.__test.camera.blink(${pick([150, 250, 400, 900])})`,
    () => `window.__test.camera.hold(${pick(['null', '{ engaged: true, closed: true, progress: 0.5 }', '{ engaged: false }'])})`,
    () => `window.__test.camera.face(${pick(['true', 'false'])})`,
    () => `window.__test.camera.rest(${pick(['true', 'false'])})`,
    () => `window.__test.heard.onPartial(${JSON.stringify(pick(QUESTIONS).slice(0, 8))})`,
    () => `window.__test.heard.onTurn(${JSON.stringify(pick(QUESTIONS))}, null)`,
    () => `window.__test.heard.onEagerEnd(${JSON.stringify(pick(QUESTIONS))})`,
    () => `dispatchEvent(new KeyboardEvent('keydown', { code: '${pick(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyR', 'KeyQ', 'KeyT', 'KeyF'])}' }))`,
    () => `(dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })), setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })), ${pick([60, 300, 1100])}))`,
    () => `(dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })), setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM' })), ${pick([30, 400, 2000])}))`,
  ];
  const t0 = Date.now();
  let firstBad = null;
  for (let i = 0; i < FUZZ_STEPS && !firstBad; i++) {
    await js(`${pick(actions)()}; 1`);
    if (i % 3 === 0) await sleep(pick([0, 20, 80]));
    const bad = await js(invariants);
    if (bad.length) firstBad = `step ${i}: ${bad.join('; ')}`;
  }
  report(`fuzz: ${FUZZ_STEPS} random inputs keep the screen consistent`, !firstBad, firstBad ?? `${Math.round((Date.now() - t0) / 1000)} s`);
  // Undo whatever the fuzz left on (a hold, a key down, face lost, tired) before the long session.
  await sleep(1200);
  await js(`dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })); window.__test.camera.hold(null); window.__test.camera.face(true); window.__test.camera.rest(false); window.__test.state.tired && dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' })); 1`);
  await sleep(500);

  // 2. Long session: question -> replies -> pick -> spoken -> Listening, CYCLES times.
  const heap = () => js('performance.memory?.usedJSHeapSize ?? 0');
  const nodes = () => js('document.getElementsByTagName("*").length');
  const waitFor = async (expr, ms = 10000) => {
    for (const start = Date.now(); Date.now() - start < ms; await sleep(50)) if (await js(`(s => ${expr})(window.__test.state)`)) return true;
    return false;
  };
  await js(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' })); 1`);
  const heapStart = await heap();
  const nodesStart = await nodes();
  let completed = 0;
  let stuck = null;
  for (let i = 0; i < CYCLES && !stuck; i++) {
    await js(`window.__test.heard.onTurn(${JSON.stringify(`${pick(QUESTIONS)} (${i})`)}, null); 1`);
    if (!(await waitFor(`s.rowKind === 'replies' && !s.loading`))) { stuck = `cycle ${i}: no replies`; break; }
    await js(`window.__test.state.consent = false; window.__test.camera.select('topLeft'); 1`);
    if (!(await waitFor(`s.stage === 'speaking'`))) { stuck = `cycle ${i}: never spoke`; break; }
    if (!(await waitFor(`s.stage === 'choose' && s.rowKind === 'listen'`, 15000))) { stuck = `cycle ${i}: never back to Listening`; break; }
    completed++;
  }
  const heapEnd = await heap();
  const nodesEnd = await nodes();
  const history = await js(`JSON.parse(localStorage.getItem('blink2talk.memory')).history.length`);
  const errors = await js('__errors');
  report(`long session: ${CYCLES} question -> pick -> spoken cycles`, completed === CYCLES, stuck ?? `${completed} done`);
  report('conversation history stays capped (100 lines)', history <= 100, `${history} lines`);
  report('page elements stay flat', nodesEnd - nodesStart < 200, `${nodesStart} -> ${nodesEnd}`);
  report('memory stays bounded (< 30 MB growth)', heapEnd - heapStart < 30e6, `${(heapStart / 1e6).toFixed(1)} -> ${(heapEnd / 1e6).toFixed(1)} MB`);
  report('no page errors', errors.length === 0, errors.join(' | '));

  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}`);
  app.exit(failed ? 1 : 0);
});

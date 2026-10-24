// End-to-end checks of the patient screen: `npm test` (in app/).
// Loads the real page off-screen with the camera and mic blocked and no conversation server, so it
// runs on sample replies and is the same every time. Camera events are fed straight into the same
// handlers the vision module calls (eyes.js), so a broken tracker-to-screen contract fails here.
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (${detail})`}`);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { test: '1' } });
  const js = (code) => wc.executeJavaScript(code);
  await js(`window.__errors = []; addEventListener('error', e => __errors.push(e.message)); addEventListener('unhandledrejection', e => __errors.push(String(e.reason))); speechSynthesis.speak = () => {}; localStorage.clear(); 1`);
  await js('document.fonts.ready.then(() => 1)');

  const key = (code, type = 'keydown') => js(`dispatchEvent(new KeyboardEvent('${type}', { code: '${code}' })); 1`);
  const hold = async () => { await key('Space'); await sleep(1100); await key('Space', 'keyup'); await sleep(150); };
  const doubleBlink = async () => { for (let i = 0; i < 2; i++) { await key('Space'); await sleep(80); await key('Space', 'keyup'); await sleep(120); } };
  const cam = (call) => js(`window.__test.camera.${call}; 1`);
  const state = (expr) => js(`(s => ${expr})(window.__test.state)`);
  // Boxes as drawn (the next frame), in reading order; null for an empty cell. The rest circle isn't a box.
  const labels = async () => {
    await sleep(80);
    return js(`[...document.querySelectorAll('#reply-row > [role=option], #reply-row > .grid-empty')].map(n => n.classList.contains('grid-empty') ? null : n.textContent.replace('Selected', '').trim())`);
  };
  const waitFor = async (expr, ms = 8000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) if (await state(expr)) return true; return false; };

  // Listening: one item; a long blink opens the urgent options and Spell it.
  check('listening shows one item', (await labels()).length === 1);
  await hold();
  check('"I want to say something" opens the urgent options', JSON.stringify(await labels()) === JSON.stringify(["I'm in pain", "I can't breathe", 'Call the nurse', 'Spell it']));

  // A question: three replies and "None of these" in the 2×2 grid.
  await key('KeyQ');
  check('replies arrive', await waitFor(`s.rowKind === 'replies' && !s.loading`));
  check('grid holds three replies and None of these', (await labels()).length === 4 && (await labels())[3] === 'None of these');

  // Camera contract: focus highlights the looked-at box, the rest circle highlights nothing,
  // and select picks the box the hold started on.
  await cam(`focus('bottomRight')`);
  check('focus(bottomRight) highlights cell 3', (await state('s.hl')) === 3);
  await cam('focus(null)');
  check('focus(null) highlights nothing', (await state('s.hl')) === -1);
  await cam('select(null)');
  check('select(null) on the rest circle picks nothing', (await state('s.selected')) === -1 && (await state('s.rowKind')) === 'replies');
  await cam(`select('bottomRight')`);
  check('select(bottomRight) opens the urgent options', (await state('s.rowKind')) === 'starters');
  await doubleBlink();
  check('double blink goes back to the replies', (await state('s.rowKind')) === 'replies');

  // Can't see you: nothing the eyes do counts.
  await cam('face(false)');
  await cam(`select('topLeft')`);
  check('no selection while the face is lost', (await state('s.selected')) === -1);
  await cam('face(true)');

  // Tired mode while replies are visible, and while they load (the old crash).
  await key('KeyT');
  check('tired mode shows two replies', (await labels()).filter(Boolean).length === 3);
  await key('KeyQ');
  await sleep(3000);
  await key('KeyT');
  check('tired mode toggles during loading', await waitFor(`s.rowKind === 'replies' && !s.loading`));
  await key('KeyT');

  // A yes or no to a consent question is confirmed before it's spoken ("Yes, please" here).
  await state('(s.consent = true)');
  await cam(`select('topLeft')`);
  check('a consent yes asks "Is that right?" first', (await state('s.rowKind')) === 'confirm' && (await state('s.selected')) === -1);
  await cam(`select('topRight')`);
  check('"Go back" returns to the replies', (await state('s.rowKind')) === 'replies');
  await state('(s.consent = false)');

  // Pick, then undo while speaking.
  await cam(`select('topLeft')`);
  check('select(topLeft) picks a reply', (await state('s.selected')) === 0);
  check('Speaking follows Selected', await waitFor(`s.stage === 'speaking'`, 4000));
  await doubleBlink();
  check('double blink undoes back to the replies', (await state(`s.stage === 'choose' && s.rowKind === 'replies'`)) === true);

  // Spell it: E takes two picks (E T A O, then E).
  await cam(`select('bottomRight')`);
  await cam(`select('bottomRight')`);
  check('Spell it opens on the grid', (await state('s.rowKind')) === 'spell');
  await cam(`select('topLeft')`);
  await cam(`select('topLeft')`);
  check('E in two picks', (await state('s.spell.message + s.spell.prefix')) === 'e');

  // Calibration dots follow the grid: the top-left dot sits up and to the left of the center one.
  const dot = async (phase) => { await cam(`calibration({ phase: '${phase}', remainingMs: 1500 })`); await sleep(50); return js(`[parseFloat(document.getElementById('calib-dot').style.left), parseFloat(document.getElementById('calib-dot').style.top)]`); };
  const center = await dot('center');
  const topLeft = await dot('topLeft');
  const bottomRight = await dot('bottomRight');
  await cam('calibration(null)');
  check('calibration dots sit on the box centers', topLeft[0] < center[0] && topLeft[1] < center[1] && bottomRight[0] > center[0] && bottomRight[1] > center[1]);

  const errors = await js('window.__errors');
  check('no page errors', errors.length === 0, errors.join('; '));
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  app.exit(failed ? 1 : 0);
});

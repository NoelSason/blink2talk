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
  // Two camera blinks, the way the vision module reports them: a short closure, then another.
  const camDoubleBlink = async () => { await cam('blink(220)'); await sleep(300); await cam('blink(220)'); await sleep(800); };
  const blinks = async (n) => { for (let i = 0; i < n; i++) { await key('Space'); await sleep(80); await key('Space', 'keyup'); await sleep(120); } };
  // Two blinks act once the wait for a possible third is over (TIMING.thirdBlink).
  const doubleBlink = async () => { await blinks(2); await sleep(800); };
  const cam = (call) => js(`window.__test.camera.${call}; 1`);
  const state = (expr) => js(`(s => ${expr})(window.__test.state)`);
  // Boxes as drawn (the next frame), in reading order; null for an empty cell. The middle band (question and status) isn't a box.
  const labels = async () => {
    await sleep(80);
    return js(`[...document.querySelectorAll('#reply-row > [role=option], #reply-row > .grid-empty')].map(n => n.classList.contains('grid-empty') ? null : n.textContent.replace('Selected', '').trim())`);
  };
  const waitFor = async (expr, ms = 8000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) if (await state(expr)) return true; return false; };

  // Listening: one item; a long blink opens the urgent options and Spell it.
  check('listening shows one item', (await labels()).length === 1);
  await hold();
  check('"I want to say something" opens the urgent options', JSON.stringify(await labels()) === JSON.stringify(["I'm in pain", "I can't breathe", 'Call the nurse', 'Spell it']));
  await doubleBlink();
  check('double blink goes back to Listening', (await state('s.rowKind')) === 'listen');

  // A question: three replies and "None of these" in the 2×2 grid.
  await key('KeyQ');
  check('replies arrive', await waitFor(`s.rowKind === 'replies' && !s.loading`));
  check('grid holds three replies and None of these', (await labels()).length === 4 && (await labels())[3] === 'None of these');

  // Camera contract: focus highlights the looked-at box, the middle band highlights nothing,
  // and select picks the box the hold started on.
  await cam(`focus('bottomRight')`);
  check('focus(bottomRight) highlights cell 3', (await state('s.hl')) === 3);
  await cam('focus(null)');
  check('focus(null) highlights nothing', (await state('s.hl')) === -1);
  await cam('select(null)');
  check('select(null) in the middle band picks nothing', (await state('s.selected')) === -1 && (await state('s.rowKind')) === 'replies');
  // Holding on None of these shows the same fill ring as a reply.
  await cam(`focus('bottomRight')`);
  await cam(`hold({ engaged: true, closed: true, progress: 0.6 })`);
  await sleep(150);
  check('a hold on None of these shows the fill ring', await js(`(() => { const el = document.querySelectorAll('#reply-row > [role=option]')[3]; const ring = el?.querySelector('.reply-card__hold'); return el?.dataset.state === 'hold' && !!ring && getComputedStyle(ring).display === 'block'; })()`));
  await cam('hold(null)');

  // None of these: two fresh sets of replies (without the rejected ones), then the urgent options.
  const firstSet = await labels();
  await cam(`select('bottomRight')`);
  check('None of these brings a fresh set of replies', (await waitFor(`s.rowKind === 'replies' && !s.loading`)) && JSON.stringify(await labels()) !== JSON.stringify(firstSet));
  check('and tells the server what was rejected', (await state('s.rejected.length')) === 3 && (await state('s.noneCount')) === 1);
  await cam(`select('bottomRight')`);
  await waitFor(`s.rowKind === 'replies' && !s.loading`);
  await cam(`select('bottomRight')`);
  check('the third None of these opens the urgent options', (await state('s.rowKind')) === 'starters');
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
  check('a consent yes is confirmed first', (await state('s.rowKind')) === 'confirm' && (await state('s.selected')) === -1);
  check('the confirm screen says what was chosen, above two boxes', JSON.stringify(await labels()) === JSON.stringify(["Yes, that's right", 'No, go back'])
    && (await state('s.caption.text')) === 'You said “Yes, please”. Is that correct?'
    && (await js(`document.getElementById('caption').parentElement.id`)) === 'gaze-area');
  await cam(`focus('bottomLeft')`);
  check('on the confirm screen, any look to the left means the left box', (await state('s.hl')) === 0);
  await cam(`select('bottomRight')`);
  check('"Go back" returns to the replies', (await state('s.rowKind')) === 'replies');
  await state('(s.consent = false)');

  // Pick, then undo while speaking.
  await cam(`select('topLeft')`);
  check('select(topLeft) picks a reply', (await state('s.selected')) === 0);
  check('Speaking follows Selected', await waitFor(`s.stage === 'speaking'`, 4000));
  await doubleBlink();
  check('double blink undoes back to the replies', (await state(`s.stage === 'choose' && s.rowKind === 'replies'`)) === true);

  // A camera pick carries the look before the hold (for learning); after speaking, the screen goes back
  // to Listening on its own. (Regression: the learning step threw and left the screen on Speaking.)
  await cam(`select('topLeft', [0.5, 0, 0, 0])`);
  check('a camera pick with a look is spoken', await waitFor(`s.stage === 'speaking'`, 4000));
  check('and the screen goes back to Listening', await waitFor(`s.rowKind === 'listen' && s.stage === 'choose'`, 9000));
  check('no page errors after a camera pick', (await js('window.__errors.length')) === 0, await js('window.__errors.join("; ")'));
  await key('KeyQ'); // next sample question, back to a replies grid
  await waitFor(`s.rowKind === 'replies' && !s.loading`, 9000);

  // Spell it: E takes two picks (E T A O, then E). Three None of these reach the urgent options.
  for (let i = 0; i < 3; i++) {
    await cam(`select('bottomRight')`);
    await waitFor(`!s.loading`);
  }
  await cam(`select('bottomRight')`);
  check('Spell it opens on the grid', (await state('s.rowKind')) === 'spell');
  await cam(`select('topLeft')`);
  await cam(`select('topLeft')`);
  check('E in two picks', (await state('s.spell.message + s.spell.prefix')) === 'e');
  // Double blinks walk back one page at a time: a letter level, Spell it, the urgent options.
  await cam(`select('topLeft')`);
  await camDoubleBlink();
  check('double blink goes up a letter level', (await state(`s.rowKind === 'spell' && s.spell.path.length === 0`)) === true);
  await doubleBlink();
  check('double blink leaves Spell it for the urgent options', (await state('s.rowKind')) === 'starters');
  await doubleBlink();
  check('another double blink goes back to the replies', (await state('s.rowKind')) === 'replies');

  // Three quick blinks offer calibration again; Go back returns to where they were.
  await key('KeyR');
  await blinks(3);
  check('three blinks offer calibration again', (await state('s.rowKind')) === 'recalibrate' && JSON.stringify(await labels()) === JSON.stringify(['Calibrate again', 'Go back']));
  await cam(`select('topRight')`);
  check('Go back from it returns to Listening', (await state('s.rowKind')) === 'listen');

  // A question split across two mic turns (the nurse paused) is one question: one caption, one line
  // in the conversation, replies for both parts. A turn after a pick is a new question.
  await key('KeyR');
  const heard = (call) => js(`window.__test.heard.${call}; 1`);
  await heard(`onPartial('Can I take you')`);
  await heard(`onTurn('Can I take you down to the X-ray?', null)`);
  await waitFor(`s.rowKind === 'replies' && !s.loading`);
  await heard(`onPartial('It will take')`);
  check('the second part extends the caption', (await state('s.caption.text')) === 'Can I take you down to the X-ray? It will take');
  await heard(`onTurn('It will take ten minutes.', null)`);
  check('a split question becomes one question', (await state('s.transcript')) === 'Can I take you down to the X-ray? It will take ten minutes.');
  check('and one line in the conversation', await js(`(() => { const h = JSON.parse(localStorage.getItem('blink2talk.memory')).history; return h.at(-1).text === 'Can I take you down to the X-ray? It will take ten minutes.' && !h.some((t) => t.text === 'Can I take you down to the X-ray?'); })()`));
  await waitFor(`s.rowKind === 'replies' && !s.loading`);

  // The testing-only fast local replies switch: off, and greyed out without the model.
  check('the local replies switch is off and unavailable without its model', await js(`(() => { const box = [...document.querySelectorAll('.care label')].find((l) => l.textContent.includes('testing only'))?.querySelector('input'); return !!box && !box.checked && box.disabled; })()`));

  // While the replies load, a double blink does nothing (ordinary blinks during a long wait).
  // Sample replies load instantly here, so the loading state is held by hand.
  await key('KeyQ');
  await waitFor(`s.rowKind === 'replies' && !s.loading`);
  await state('(s.loading = true)');
  await doubleBlink();
  check('double blink while replies load keeps the question', (await state('s.rowKind')) === 'replies');
  await state('(s.loading = false)');
  await key('KeyR');

  // Double blink on the replies (no page before them) goes back to Listening.
  await key('KeyQ');
  await waitFor(`s.rowKind === 'replies' && !s.loading`);
  await doubleBlink();
  check('double blink on the replies goes back to Listening', (await state('s.rowKind')) === 'listen');

  // Summary: back on Listening, the conversation so far shows for the patient and in the care panel.
  // No server here, so it's the plain version: the last few lines as said, with who said them.
  await key('KeyR');
  check('Listening shows the conversation so far', await waitFor(`!document.getElementById('summary').hidden && document.getElementById('summary-text').textContent.includes('said')`, 5000));
  check('the care panel has the summary', (await js(`document.querySelectorAll('.care__summary li').length`)) > 0);
  check('saved lines keep who said them', await js(`JSON.parse(localStorage.getItem('blink2talk.memory')).history.some((h) => h.role === 'nurse' && h.speaker === 'Nurse')`));
  await key('KeyQ');
  check('the summary hides while replies are up', await waitFor(`s.rowKind === 'replies' && document.getElementById('summary').hidden`));

  // Calibration dots follow the grid: the top-left dot sits up and to the left of the center one.
  const dot = async (phase) => { await cam(`calibration({ phase: '${phase}', remainingMs: 1500 })`); await sleep(50); return js(`[parseFloat(document.getElementById('calib-dot').style.left), parseFloat(document.getElementById('calib-dot').style.top)]`); };
  const center = await dot('center');
  const topLeft = await dot('topLeft');
  const bottomRight = await dot('bottomRight');
  await cam('calibration(null)');
  check('calibration dots sit on the box centers', topLeft[0] < center[0] && topLeft[1] < center[1] && bottomRight[0] > center[0] && bottomRight[1] > center[1]);

  const errors = await js('window.__errors');
  // Dev mode opens from its button and from the backtick key, and closes again.
  await js(`document.getElementById('dev-open').click(); 1`);
  check('Dev mode button opens the panel', await js(`!document.querySelector('.dev').hidden`));
  await key('Backquote');
  check('backtick closes it', await js(`document.querySelector('.dev').hidden`));
  check('no page errors', errors.length === 0, errors.join('; '));
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  app.exit(failed ? 1 : 0);
});

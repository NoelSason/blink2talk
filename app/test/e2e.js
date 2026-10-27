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
  // Memory is read as the page loads, so last run's picks must be gone before it does.
  await session.defaultSession.clearStorageData({ storages: ['localstorage'] });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { test: '1' } });
  const js = (code) => wc.executeJavaScript(code);
  await js(`window.__errors = []; addEventListener('error', e => __errors.push(e.message)); addEventListener('unhandledrejection', e => __errors.push(String(e.reason))); speechSynthesis.speak = () => {}; localStorage.clear(); window.__notes = []; const start = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { __notes.push(Math.round(this.frequency.value)); return start.apply(this, a); }; 1`);
  await js('document.fonts.ready.then(() => 1)');

  const key = (code, type = 'keydown') => js(`dispatchEvent(new KeyboardEvent('${type}', { code: '${code}' })); 1`);
  const hold = async () => { await key('Space'); await sleep(1100); await key('Space', 'keyup'); await sleep(150); };
  // Two camera blinks, the way the vision module reports them: a short closure, then another.
  const camDoubleBlink = async () => { await cam('blink(220)'); await sleep(300); await cam('blink(220)'); await sleep(800); };
  const blinks = async (n) => { for (let i = 0; i < n; i++) { await key('Space'); await sleep(80); await key('Space', 'keyup'); await sleep(120); } };
  // Two blinks act once the wait for a possible third is over (TIMING.thirdBlink).
  const doubleBlink = async () => { await blinks(2); await sleep(800); };
  const cam = (call) => js(`window.__test.camera.${call}; 1`);
  // Box sounds: the notes played since the last call, rounded to the hertz (G4 392, B4 494, D5 587, F#5 740).
  const notes = () => js(`window.__notes.splice(0)`);
  const state = (expr) => js(`(s => ${expr})(window.__test.state)`);
  // Boxes as drawn (the next frame), in reading order; null for an empty cell. The middle band (question and status) isn't a box.
  const labels = async () => {
    await sleep(80);
    return js(`[...document.querySelectorAll('#reply-row > [role=option], #reply-row > .grid-empty')].map(n => n.classList.contains('grid-empty') ? null : n.textContent.replace('Selected', '').trim())`);
  };
  const waitFor = async (expr, ms = 8000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) if (await state(expr)) return true; return false; };

  // Push-to-talk: the top bar says to hold M, and Listening while it's held. With no server here the
  // mic can't connect, so "held" is set by hand, and a real press ends at Mic off in red.
  const micLabel = () => js(`document.getElementById('mic-label').textContent`);
  const micRed = () => js(`document.getElementById('mic-status').classList.contains('eye-status--off')`);
  check('the top bar says to hold M to talk, not in red', (await micLabel()) === 'Hold M to talk' && !(await micRed()));
  await js(`window.__test.state.mic = 'on'; 1`);
  await sleep(80);
  check('while M is held it says Listening', (await micLabel()) === 'Listening' && !(await micRed()));
  await js(`window.__test.state.mic = 'idle'; 1`);
  await key('KeyM');
  await sleep(150);
  await key('KeyM', 'keyup');
  await sleep(80);
  check('without the speech service, holding M shows Mic off in red', (await micLabel()) === 'Mic off' && (await micRed()) && (await state('s.mic')) === 'unavailable');
  check('and nothing is heard', (await state('s.rowKind')) === 'listen');

  // The care panel switches to always listening (saved on this laptop), where M mutes instead.
  const micSwitch = `[...document.querySelectorAll('.care label')].find((l) => l.textContent.includes('Always listening'))?.querySelector('input')`;
  check('the care panel has the always-listening switch, off by default', await js(`(() => { const box = ${micSwitch}; return !!box && !box.checked; })()`));
  await js(`${micSwitch}.click(); 1`);
  check('switching it on sets always listening and saves it', (await state('s.micMode')) === 'always' && (await js(`localStorage.getItem('blink2talk.micMode')`)) === 'always');
  await js(`window.__test.state.mic = 'on'; 1`);
  await sleep(80);
  check('always listening, the top bar says Mic on', (await micLabel()) === 'Mic on' && !(await micRed()));
  await key('KeyM');
  await sleep(80);
  check('and M mutes it, in red', (await micLabel()) === 'Mic off' && (await micRed()) && (await state('s.mic')) === 'off');
  await key('KeyM', 'keyup');
  await js(`${micSwitch}.click(); 1`);
  check('switching it off goes back to push-to-talk', (await state('s.micMode')) === 'talk' && (await js(`localStorage.getItem('blink2talk.micMode')`)) === 'talk');

  // Listening: one item; a long blink opens the Start screen, the same four every time.
  check('listening shows one item', (await labels()).length === 1);
  await hold();
  const START = ['I need something', 'Emergency', 'I want to ask or say', "I'm in pain"];
  check('"I want to say something" opens the two categories, Emergency, and pain', JSON.stringify(await labels()) === JSON.stringify(START));
  // A category pages forward through one fixed list: nothing comes back, and the end is Spell it.
  await cam(`select('topLeft')`);
  await waitFor(`s.rowKind === 'browse'`);
  const seenPhrases = [];
  const page1 = await labels();
  check('I need something shows three needs and None of these', JSON.stringify(page1) === JSON.stringify(["I'm thirsty", 'Move me, please', 'I need suctioning', 'None of these']));
  seenPhrases.push(...page1.slice(0, 3));
  await cam(`select('bottomRight')`);
  await waitFor(`s.rowKind === 'browse' && s.browse.at === 3`);
  const page2 = await labels();
  seenPhrases.push(...page2.slice(0, 3));
  await cam(`select('bottomRight')`);
  await waitFor(`s.rowKind === 'browse' && s.browse.at === 6`);
  const page3 = await labels();
  seenPhrases.push(...page3.slice(0, 3));
  check('None of these never shows a phrase twice', new Set(seenPhrases).size === 9 && page2[3] === 'None of these');
  check('the last page offers Spell it instead', page3[3] === 'Spell it');
  await cam(`select('bottomRight')`);
  check('which opens Spell it', await waitFor(`s.rowKind === 'spell'`));
  await doubleBlink();
  await waitFor(`s.rowKind === 'browse'`);
  check('double blink comes back to that page', JSON.stringify(await labels()) === JSON.stringify(page3));
  await doubleBlink();
  await doubleBlink();
  await doubleBlink();
  check('and walks back page by page to the Start screen', (await state('s.rowKind')) === 'start');
  // A phrase the patient picks leads its category next time.
  await cam(`select('bottomLeft')`);
  await waitFor(`s.rowKind === 'browse' && s.browse.cat === 'say'`);
  check('I want to ask or say starts with orientation', (await labels())[0] === 'What time is it?');
  await cam(`select('topRight')`);
  check('a picked phrase is spoken', (await state('s.speakText')) === "I'm scared" && (await waitFor(`s.rowKind === 'listen'`)));
  await hold();
  await cam(`select('bottomLeft')`);
  await waitFor(`s.rowKind === 'browse' && s.browse.cat === 'say'`);
  check('and leads that category next time', JSON.stringify((await labels()).slice(0, 2)) === JSON.stringify(["I'm scared", 'What time is it?']));
  await doubleBlink();
  // Emergency: one pick, says it out loud, alerts the care panel, and is never remembered.
  await cam(`select('topRight')`);
  check('Emergency speaks "I need help now"', (await state('s.speakText')) === 'I need help now');
  check('and alerts the care panel', (await js(`document.querySelectorAll('.care-alert--strong').length`)) > 0);
  await waitFor(`s.rowKind === 'listen'`);
  await hold();
  check('the Start screen stays the same after picks', JSON.stringify(await labels()) === JSON.stringify(START));
  await cam(`select('topLeft')`);
  await waitFor(`s.rowKind === 'browse'`);
  check('Emergency is never remembered as a need', (await labels())[0] === "I'm thirsty");
  await doubleBlink();
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

  // Box sounds (on by default): a box that lights up plays its own note, higher at the top and to the
  // right; staying on it plays nothing more. A pick rises a fourth from the picked box's note.
  await sleep(700);
  await notes();
  for (const q of ['bottomLeft', 'bottomLeft', 'bottomRight', 'topLeft', 'topRight']) await cam(`focus('${q}')`);
  check('each box that lights up plays its own note, higher at the top and to the right', JSON.stringify(await notes()) === '[392,494,587,740]');
  const soundSwitch = `[...document.querySelectorAll('.care label')].find((l) => l.textContent.includes('Box sounds'))?.querySelector('input')`;
  check('the care panel has the box sounds switch, on by default', await js(`(() => { const box = ${soundSwitch}; return !!box && box.checked; })()`));
  await js(`${soundSwitch}.click(); 1`);
  await cam(`focus('bottomLeft')`);
  check('switched off, a box lighting up is silent, and that is saved', (await notes()).length === 0 && (await js(`localStorage.getItem('blink2talk.boxSounds')`)) === 'off');
  await js(`${soundSwitch}.click(); 1`);
  check('switched back on', (await state('s.boxSounds')) === true);
  await cam(`focus('topRight')`);
  await notes();

  // None of these: two fresh sets of replies (without the rejected ones), then the urgent options.
  const firstSet = await labels();
  await cam(`select('bottomRight')`);
  check('picking a box chimes up from its note', JSON.stringify((await notes()).slice(0, 2)) === '[494,659]');
  check('None of these brings a fresh set of replies', (await waitFor(`s.rowKind === 'replies' && !s.loading`)) && JSON.stringify(await labels()) !== JSON.stringify(firstSet));
  check('and tells the server what was rejected', (await state('s.rejected.length')) === 3 && (await state('s.noneCount')) === 1);
  check('and none of the rejected replies come back', !(await labels()).some((l) => firstSet.slice(0, 3).includes(l)));
  // The samples have only two sets: a second re-ask shows only the one reply never shown, never a repeat.
  await cam(`select('bottomRight')`);
  await waitFor(`s.rowKind === 'replies' && !s.loading`);
  check('a second None of these shows only replies never shown', JSON.stringify(await labels()) === JSON.stringify(["I'm not sure", null, null, 'None of these']));
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
  check('tired mode empties the third reply box', (await labels())[2] === null && (await labels())[3] === 'None of these');
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
  await sleep(700); // the pick's chime, then box notes again
  await notes();
  await cam(`focus('bottomLeft')`);
  check('on the confirm screen, any look to the left means the left box', (await state('s.hl')) === 0);
  await cam(`focus('topRight')`);
  check('and its two boxes play the lowest and highest notes', JSON.stringify(await notes()) === '[392,740]');
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

  // Arrow keys in the row layout (a dev-mode switch; the 2x2 is the default): right walks the boxes as drawn,
  // left to right, through all four; up and down don't move; tired mode's empty box is skipped. (Tired mode is still on from above.)
  const setLayout = (v) => js(`(() => { const s = [...document.querySelectorAll('.dev select')].find((x) => [...x.options].some((o) => o.value === 'row')); s.value = '${v}'; s.dispatchEvent(new Event('change')); return document.documentElement.dataset.layout; })()`);
  await setLayout('row');
  const wasTired = await state('s.tired');
  if (wasTired) await key('KeyT');
  await key('KeyQ');
  await waitFor(`s.rowKind === 'replies' && !s.loading`);
  const highlightedX = () => js(`document.querySelector('#reply-row > [data-state=highlighted]')?.getBoundingClientRect().left ?? null`);
  const xs = [];
  const hls = [];
  await notes();
  for (let i = 0; i < 4; i++) {
    await key('ArrowRight');
    await sleep(80);
    xs.push(await highlightedX());
    hls.push(await state('s.hl'));
  }
  check('arrow right reaches all four boxes, left to right', new Set(hls).size === 4 && xs.every((x, i) => x != null && (i === 0 || x > xs[i - 1])), JSON.stringify({ hls, xs }));
  const rowNotes = await notes();
  check('and their notes rise left to right', JSON.stringify(rowNotes) === '[392,494,587,740]', JSON.stringify(rowNotes));
  const before = await state('s.hl');
  await key('ArrowUp');
  await key('ArrowDown');
  check('up and down do nothing in the row', (await state('s.hl')) === before);
  await key('KeyT');
  // From None of these (far right): the second reply, then over the empty box to the first.
  const tiredWalk = [];
  for (let i = 0; i < 2; i++) {
    await key('ArrowLeft');
    tiredWalk.push(await state('s.hl'));
  }
  check('in tired mode the arrows skip the empty box', (await state('s.tired')) && JSON.stringify(tiredWalk) === '[1,0]', JSON.stringify(tiredWalk));
  if (!wasTired) await key('KeyT');
  await setLayout('kahoot');

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
  // Dev mode's "Middle of each box" pulls the corner dots in toward the center.
  await js(`document.documentElement.dataset.dots = 'centers'; 1`);
  const inner = await dot('topLeft');
  await cam('calibration(null)');
  await js(`document.documentElement.dataset.dots = 'corners'; 1`);
  check('box-center dots sit inside the corner dots', inner[0] > topLeft[0] && inner[1] > topLeft[1] && inner[0] < center[0] && inner[1] < center[1]);
  // Kahoot layout: the dots land on the real boxes, not the status line under them (measured 2026-10-25).
  const rects = await js(`[...document.querySelectorAll('#reply-row > :is([role=option], .grid-empty)')].map(n => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })`);
  if (rects.length === 4) {
    const page = async (phase) => { await cam(`calibration({ phase: '${phase}', remainingMs: 1500 })`); await sleep(50); return js(`(() => { const r = document.getElementById('calib-dot').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`); };
    const inBox = ([x, y], [l, t, r, b]) => x > l && x < r && y > t && y < b;
    const tl = await page('topLeft');
    const br = await page('bottomRight');
    const mid = await page('center');
    await cam('calibration(null)');
    const meetY = (rects[0][3] + rects[2][1]) / 2;
    check('Kahoot: corner dots sit inside their boxes', inBox(tl, rects[0]) && inBox(br, rects[3]), JSON.stringify({ tl, br, rects }));
    check('Kahoot: center dot sits where the boxes meet', Math.abs(mid[1] - meetY) < 12, `${mid[1]} vs ${meetY}`);
  } else check('Kahoot: grid has four boxes to measure', false, `${rects.length}`);

  // Dev mode's accuracy test in the row layout: each target sits in its column's quarter
  // of the gaze area, and the score counts the row picker's column. Frames stand in for eyes.js; one
  // column is answered wrong on purpose. 8 trials of 2 s.
  await setLayout('row');
  await js(`document.getElementById('dev-open').click(); [...document.querySelectorAll('.dev button')].find((b) => b.textContent === 'Accuracy test (8 looks)').click(); 1`);
  await js(`window.__placed = {}; window.__feed = setInterval(() => {
    const t = document.querySelector('.dev-target');
    if (t.hidden) return;
    const cols = ['farLeft', 'midLeft', 'midRight', 'farRight'];
    const i = cols.indexOf(t.dataset.at);
    const a = document.getElementById('gaze-area').getBoundingClientRect();
    const r = t.getBoundingClientRect();
    window.__placed[t.dataset.at] = Math.floor((r.left + r.width / 2 - a.left) / (a.width / 4)) === i;
    dispatchEvent(new CustomEvent('eyes-frame', { detail: { mode: 'running', faceFound: true, looking: null, column: i === 1 ? 0 : i, focus: null } }));
  }, 50); 1`);
  await sleep(16600);
  await js(`clearInterval(window.__feed); 1`);
  const placed = await js('window.__placed');
  check('row accuracy test: every column target sits in its own quarter', Object.keys(placed).length === 4 && Object.values(placed).every(Boolean), JSON.stringify(placed));
  const scored = await js(`document.querySelector('.dev__results').textContent`);
  check('and counts the row picker\'s column', scored.startsWith('Accuracy (row of 4): 6 of 8 (75%)') && (scored.match(/Middle left → Far left/g) ?? []).length === 2, scored.split('\n').slice(0, 5).join(' / '));
  await key('Backquote');
  await setLayout('kahoot');
  // Long-term memory: past ~100 turns, the oldest 20 fold into the condensed notes (a plain digest
  // here, with no server), and every turn Claude gets carries its time.
  await js(`(() => { const m = window.__test.memory; m.clearHistory(); for (let i = 0; i < 125; i++) m.addTurn(i % 2 ? 'patient' : 'nurse', i % 2 ? 'Reply ' + i : 'Question ' + i); window.__test.conversationChanged(); return 1; })()`);
  check('past 120 turns, the oldest 20 are condensed', await waitFor(`window.__test.memory.history.length === 105`));
  const earlier = await js(`window.__test.memory.earlier().text`);
  check('into notes that keep what the patient said', earlier.includes('“Reply 1”') && earlier.includes('“Reply 19”') && !earlier.includes('Reply 21'));
  check('the verbatim turns pick up right after them', (await js(`window.__test.memory.history[0].text`)) === 'Question 20');
  check('every turn sent to Claude has its time', await js(`window.__test.memory.turns().every((t) => /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \\d+, \\d\\d:\\d\\d$/.test(t.at))`));
  await js(`window.__test.memory.clearHistory(); 1`);
  check('clearing the conversation clears the notes too', (await js(`window.__test.memory.earlier().text`)) === '');

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

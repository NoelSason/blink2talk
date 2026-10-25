// Unit tests for accuracy.js (the README's Eye accuracy section): `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import accuracy from '../accuracy.js';

const README = '# App\n\n## Eye accuracy\n\n<!-- accuracy:start: written by app/accuracy.js -->\nold\n<!-- accuracy:end -->\n\n## Run it\n';
const repo = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'accuracy-'));
  fs.writeFileSync(path.join(root, 'README.md'), README);
  return root;
};
const line = (e) => `${JSON.stringify(e)}\n`;
const row = (target, guess, frames = 30) => ({ target, guess, hit: guess === target, frames });
const calibrated = { t: 1000, event: 'calibrated', at: Date.UTC(2026, 9, 25, 4), tester: 'Noel', accuracy: { center: 0.5, topLeft: 1, topRight: 1, bottomLeft: 0.9, bottomRight: 1 }, warnings: [] };
const testRun = {
  t: 5000, event: 'test', at: Date.UTC(2026, 9, 25, 4, 1), tester: 'Guest 1', source: 'vision',
  rows: [row('topLeft', 'topLeft'), row('topRight', 'topRight'), row('bottomLeft', 'topLeft'), row('bottomRight', 'center'),
    row('topLeft', 'topLeft'), row('topRight', 'topRight'), row('bottomLeft', 'bottomLeft'), row('bottomRight', null, 0)],
};

test('a calibration and a test land in the README section, between the markers only', () => {
  const root = repo();
  accuracy.record('2026-10-25T04-00-00-000Z', line(calibrated) + line({ t: 2000, mode: 'running' }) + line(testRun), { root });
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /5 of 8 looks counted in the right box \(63%\)/);
  assert.match(readme, /by 1 tester\./);
  assert.match(readme, /Bottom left → Top left; Bottom right → Center; Bottom right → no eye data/);
  assert.match(readme, /\| Noel \| \*\*50%\*\* \| 100%/, 'a weak calibration box is bold');
  assert.ok(readme.startsWith('# App\n\n## Eye accuracy\n\n<!-- accuracy:start: written by app/accuracy.js -->\n'));
  assert.ok(readme.endsWith('<!-- accuracy:end -->\n\n## Run it\n') && !readme.includes('\nold\n'));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'accuracy.md')));
});

test('per axis: a top/bottom mistake is still right left/right; the middle or no data is wrong on both', () => {
  const s = accuracy.tally([testRun]);
  assert.equal(s.hits, 5);
  assert.equal(s.x, 6); // bottomLeft → topLeft keeps the left side
  assert.equal(s.y, 5);
  assert.deepEqual(s.box.bottomRight, { hits: 0, total: 2 });
});

test('recording the same events twice adds nothing', () => {
  const root = repo();
  const session = '2026-10-25T04-00-00-000Z';
  accuracy.record(session, line(testRun), { root });
  accuracy.record(session, line(testRun), { root });
  const data = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'accuracy', `${session}.json`), 'utf8'));
  assert.equal(data.tests.length, 1);
});

test('a README without the markers is left alone', () => {
  assert.equal(accuracy.replaceBlock('# App\n', 'new'), null);
});

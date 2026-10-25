// Unit tests for patient-memory.js (patient_memory.json): `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import patientMemory from '../patient-memory.js';

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'patient-memory-')), 'patient_memory.json');

test('no file yet: load gives null', () => {
  assert.equal(patientMemory.createPatientMemory(tempFile()).load(), null);
});

test('a save is on disk once idle, and loads back the same', async () => {
  const file = tempFile();
  const mem = patientMemory.createPatientMemory(file);
  mem.save('{"history":[]}');
  await mem.idle();
  assert.equal(fs.readFileSync(file, 'utf8'), '{"history":[]}');
  assert.equal(patientMemory.createPatientMemory(file).load(), '{"history":[]}');
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('saves in a burst: the newest one wins, and nothing is busy after', async () => {
  const file = tempFile();
  const mem = patientMemory.createPatientMemory(file);
  for (let i = 0; i < 20; i++) mem.save(`{"n":${i}}`);
  assert.equal(mem.busy, true);
  await mem.idle();
  assert.equal(fs.readFileSync(file, 'utf8'), '{"n":19}');
  assert.equal(mem.busy, false);
});

test('the default file is patient_memory.json at the repo root', () => {
  assert.equal(path.basename(patientMemory.DEFAULT_FILE), 'patient_memory.json');
  assert.ok(fs.existsSync(path.join(path.dirname(patientMemory.DEFAULT_FILE), 'CLAUDE.md')));
});

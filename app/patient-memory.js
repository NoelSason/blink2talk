// Patient memory on disk: one JSON file, patient_memory.json at the repo root. For now everyone who
// uses the app on this computer is the same patient. The main process reads and writes it for
// renderer/memory.js (through preload.js). Git-ignored: it is patient data.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.join(__dirname, '..', 'patient_memory.json');

function createPatientMemory(file = DEFAULT_FILE) {
  let pending = null; // the newest text not on disk yet
  let writing = null; // the write in progress, if any

  // Through a temp file, so a crash mid-write never leaves half a file. If Windows refuses the rename
  // (the file is open somewhere else), write it in place.
  async function write(text) {
    const tmp = `${file}.tmp`;
    try {
      await fs.promises.writeFile(tmp, text);
      await fs.promises.rename(tmp, file);
    } catch {
      await fs.promises.writeFile(file, text);
      fs.promises.rm(tmp, { force: true }).catch(() => {});
    }
  }

  async function drain() {
    while (pending !== null) {
      const text = pending;
      pending = null;
      try {
        await write(text);
      } catch (err) {
        console.error(`patient memory: ${err.message}`);
      }
    }
    writing = null;
  }

  return {
    file,
    /** The saved text, or null when there is none yet. */
    load() {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    },
    /** Saves can come many times a second: one write at a time, and only the newest text is written. */
    save(text) {
      pending = String(text);
      if (!writing) writing = drain();
      return writing;
    },
    get busy() {
      return writing !== null;
    },
    /** Resolves once everything saved so far is on disk. */
    idle() {
      return writing ?? Promise.resolve();
    },
  };
}

module.exports = { createPatientMemory, DEFAULT_FILE };

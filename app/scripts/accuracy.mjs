// Rebuilds docs/accuracy.md and the README's Eye accuracy section from docs/accuracy/. The app does
// this by itself after every calibration and accuracy test; run it after pulling teammates' results.
//   npm run accuracy               rebuild
//   npm run accuracy -- --import   first add the calibrations and tests already in app/logs/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import accuracy from '../accuracy.js';

const logs = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'logs');
if (process.argv.includes('--import')) console.log(`Imported ${accuracy.importLogs(logs)} session(s) from app/logs/`);
accuracy.rebuild();
console.log('Updated docs/accuracy.md and the README Eye accuracy section.');

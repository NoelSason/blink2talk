// Preload: the renderer gets only what is listed here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blink2talk', {
  platform: process.platform,
  // route: 'config' | 'replies' | 'complete' | 'speak' | 'summary' | 'local-warm'. See conversation/README.md for the bodies.
  conversation: (route, body) => ipcRenderer.invoke('conversation', { route, body }),
  // Which voice spoke a nurse-mic turn: 16 kHz pcm_s16le in, { voice, similarity, isNew } or null out.
  speaker: (pcm) => ipcRenderer.invoke('speaker', pcm),
  // Patient memory (renderer/memory.js): patient_memory.json at the repo root, one patient per computer.
  memory: {
    load: () => ipcRenderer.sendSync('memory-load'),
    save: (json) => ipcRenderer.send('memory-save', String(json)),
  },
  // Eye-tracker feature log (eyes.js): JSON lines appended to app/logs/ on this machine.
  eyesLog: (lines) => ipcRenderer.send('eyes-log', String(lines)),
});

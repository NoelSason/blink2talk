// Preload: the renderer gets only what is listed here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blink2talk', {
  platform: process.platform,
  // route: 'config' | 'replies' | 'complete' | 'speak'. See conversation/README.md for the bodies.
  conversation: (route, body) => ipcRenderer.invoke('conversation', { route, body }),
  // Eye-tracker session recording (eyes.js): JSON lines appended to app/logs/ on this machine.
  gazeLog: (lines) => ipcRenderer.send('gaze-log', String(lines)),
});

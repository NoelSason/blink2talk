// Preload: the renderer gets only what is listed here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blink2talk', {
  platform: process.platform,
  // route: 'config' | 'replies' | 'complete' | 'speak'. See conversation/README.md for the bodies.
  conversation: (route, body) => ipcRenderer.invoke('conversation', { route, body }),
});

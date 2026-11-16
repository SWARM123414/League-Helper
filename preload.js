const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  history: () => ipcRenderer.invoke('history'),
  gameDetails: (id) => ipcRenderer.invoke('game-details', id),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  setNote: (puuid, name, notes) => ipcRenderer.invoke('set-note', { puuid, name, notes }),
  notedPlayers: () => ipcRenderer.invoke('noted-players'),
  playerProfile: (puuid) => ipcRenderer.invoke('player-profile', puuid),
  refresh: () => ipcRenderer.invoke('refresh'),
  champions: () => ipcRenderer.invoke('champions'),
  getBuild: (championId, role) => ipcRenderer.invoke('get-build', { championId, role }),
  buildDetails: (championId, role) => ipcRenderer.invoke('build-details', { championId, role }),
  champInfo: (id) => ipcRenderer.invoke('champ-info', id),
  buildsStatus: () => ipcRenderer.invoke('builds-status'),
  collectNow: () => ipcRenderer.invoke('collect-now'),
  importBuild: (championId, role, what) => ipcRenderer.invoke('import-build', { championId, role, what }),
  onBuildsStatus: (cb) => ipcRenderer.on('builds-status', (_e, s) => cb(s)),
  diagnose: () => ipcRenderer.invoke('diagnose'),
  getLog: () => ipcRenderer.invoke('get-log'),
  clearLog: () => ipcRenderer.invoke('clear-log'),
  reportError: (msg) => ipcRenderer.invoke('renderer-error', msg),
  copyText: (t) => ipcRenderer.invoke('copy-text', t),
  appInfo: () => ipcRenderer.invoke('app-info'),
  overlayTest: () => ipcRenderer.invoke('overlay-test'),
  onOverlay: (cb) => ipcRenderer.on('overlay', (_e, d) => cb(d))
});

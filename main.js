// Processo principal do Electron: janela, overlay, ícone na bandeja, ligação ao LoL.
const { app, BrowserWindow, ipcMain, Notification, Menu, clipboard, globalShortcut, screen, Tray, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const { LCU, liveClientData } = require('./src/lcu');
const { Tracker } = require('./src/tracker');
const { Store } = require('./src/store');
const { GameData } = require('./src/gamedata');
const { BuildDB } = require('./src/builds');
const I18N = require('./renderer/i18n');
const log = require('./src/log');

process.on('uncaughtException', (e) => log.error('main', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => log.error('main', e && e.stack ? e.stack : e));

const DEMO = process.argv.includes('--demo');
const START_HIDDEN = process.argv.includes('--hidden');
const ICON = path.join(__dirname, 'build', 'icon.png');

// As definições são lidas antes de o Electron arrancar (o "modo leve" tem de ser decidido aqui)
const store = new Store(app.getPath('userData'));
if (store.settings.lightMode) app.disableHardwareAcceleration();

let win = null;
let overlay = null;
let overlayVisible = false;
let overlayHideTimer = null;
let overlayShownFor = null;
let lastOverlayPush = 0;
let tray = null;
let quitting = false;
let tracker = null;
let registeredKey = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showMain());

const L = () => store.settings.lang || 'pt';
const t = (k, p) => I18N.t(L(), k, p);

// ---------- janela principal ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: !START_HIDDEN,
    backgroundColor: '#010a13',
    title: 'LoL Scout' + (DEMO ? ' (demo)' : ''),
    icon: ICON,
    alwaysOnTop: !!store.settings.alwaysOnTop,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // A app não abre links externos: tudo é mostrado dentro dela
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.on('close', (e) => {
    if (!quitting && store.settings.closeToTray && tray) { e.preventDefault(); win.hide(); }
    else quitting = true;
  });
  // ao voltar a mostrar, envia logo o estado mais recente
  const resend = () => sendState(true);
  win.on('show', resend);
  win.on('restore', resend);
}

function showMain() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function mainVisible() { return win && !win.isDestroyed() && win.isVisible() && !win.isMinimized(); }

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function sendState(force = false) {
  if (!tracker) return;
  // com a janela escondida ou minimizada não se gasta nada a desenhar
  if (!force && !mainVisible()) return;
  send('state', { ...tracker.state, demo: DEMO, settings: store.settings });
}

// ---------- overlay ----------
function createOverlay() {
  const W = 380, H = 640;
  const area = screen.getPrimaryDisplay().workArea;
  const left = store.settings.overlaySide === 'left';
  overlay = new BrowserWindow({
    width: W, height: H,
    x: left ? area.x + 12 : area.x + area.width - W - 12,
    y: area.y + 80,
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: false, show: false, alwaysOnTop: true, hasShadow: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: true }
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true); // os cliques passam para o jogo
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlay.on('closed', () => { overlay = null; overlayVisible = false; });
}

function overlayPayload() {
  const s = tracker.state;
  const g = s.game;
  if (!g || s.view !== 'game') return { lang: L(), hotkey: store.settings.overlayKey, game: null };
  const slim = (p) => p && ({
    championId: p.championId, championName: p.championName, name: p.name, position: p.position,
    rank: p.analysis && p.analysis.rank.solo ? { tier: p.analysis.rank.solo.tier, division: p.analysis.rank.solo.division, lp: p.analysis.rank.solo.lp } : null,
    winrate: p.analysis && p.analysis.rank.solo ? p.analysis.rank.solo.winrate : null,
    champGames: p.analysis && p.analysis.champion ? p.analysis.champion.games : null,
    tags: p.analysis ? p.analysis.tags.filter((x) => x.type === 'bad' || x.key === 'tilt' || x.key === 'firstTime').slice(0, 3) : [],
    mostDangerous: !!p.mostDangerous, weakest: !!p.weakest, laneOpponent: !!p.laneOpponent, premade: p.premade || null,
    ultCd: p.ultCd || null, live: p.live ? { k: p.live.k, d: p.live.d, a: p.live.a, level: p.live.level, isDead: p.live.isDead, respawn: p.live.respawn } : null,
    vsRecord: p.vsRecord || null
  });
  const b = g.myBuild;
  return {
    lang: L(),
    hotkey: store.settings.overlayKey,
    game: {
      queueId: g.queueId, gameTime: g.gameTime,
      enemies: g.enemies.map(slim),
      build: b ? {
        championName: b.championName, vs: b.vs ? b.vs.name : null,
        core: b.core.map((x) => ({ id: x.id, icon: x.icon, name: x.name })),
        forMatch: (b.forMatch || []).map((x) => ({ id: x.id, icon: x.icon, name: x.name })),
        boots: b.boots.slice(0, 1).map((x) => ({ id: x.id, icon: x.icon, name: x.name })),
        skillOrder: b.details ? b.details.skillOrder : null
      } : null,
      tips: g.comp ? g.comp.tips.slice(0, 2) : [],
      premades: g.premades ? g.premades.enemies : []
    }
  };
}

function pushOverlay(force = false) {
  if (!overlay || overlay.isDestroyed() || (!overlayVisible && !force)) return;
  const now = Date.now();
  if (!force && now - lastOverlayPush < 3000) return; // no máximo 1 atualização a cada 3 s
  lastOverlayPush = now;
  overlay.webContents.send('overlay', overlayPayload());
}

function showOverlay(ms = 0) {
  if (!store.settings.overlay) return;
  if (!overlay) createOverlay();
  const go = () => {
    pushOverlay(true);
    overlay.showInactive(); // não rouba o foco ao jogo
    overlayVisible = true;
    clearTimeout(overlayHideTimer);
    if (ms) overlayHideTimer = setTimeout(hideOverlay, ms);
  };
  if (overlay.webContents.isLoading()) overlay.webContents.once('did-finish-load', go); else go();
}

function hideOverlay() {
  clearTimeout(overlayHideTimer);
  if (overlay && !overlay.isDestroyed()) overlay.hide();
  overlayVisible = false;
}

function toggleOverlay() { if (overlayVisible) hideOverlay(); else showOverlay(0); }

function registerHotkey() {
  if (registeredKey) { try { globalShortcut.unregister(registeredKey); } catch { /* ignora */ } registeredKey = null; }
  const key = store.settings.overlayKey;
  if (!store.settings.overlay || !key) return;
  try {
    if (globalShortcut.register(key, toggleOverlay)) registeredKey = key;
    else log.warn('overlay', `atalho ${key} já está a ser usado por outra app`);
  } catch (e) { log.warn('overlay', `atalho inválido ${key}: ${e.message}`); }
}

function overlayOnState() {
  const s = tracker.state;
  const inGame = s.view === 'game' && s.game && !s.game.loading;
  if (!inGame) {
    if (overlayVisible && s.view !== 'game') hideOverlay();
    return;
  }
  // mostra sozinho no início de cada jogo durante alguns segundos
  const secs = Number(store.settings.overlayAutoSeconds) || 0;
  if (store.settings.overlay && secs > 0 && overlayShownFor !== s.game.gameId) {
    overlayShownFor = s.game.gameId;
    showOverlay(secs * 1000);
    return;
  }
  pushOverlay(false);
}

// ---------- bandeja e arranque com o Windows ----------
function buildTray() {
  if (tray) tray.destroy();
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('LoL Scout');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.open'), click: showMain },
    { label: t('tray.overlay'), click: toggleOverlay, enabled: !!store.settings.overlay },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showMain);
}

function applyLoginItem() {
  if (DEMO || process.platform !== 'win32') return;
  try { app.setLoginItemSettings({ openAtLogin: !!store.settings.startWithWindows, args: ['--hidden'] }); } catch (e) { log.warn('main', e.message); }
}

// ---------- arranque ----------
app.whenReady().then(() => {
  log.setDir(app.getPath('userData'));
  log.info('main', `LoL Scout ${app.getVersion()} · Electron ${process.versions.electron} · ${os.type()} ${os.release()}${store.settings.lightMode ? ' · modo leve' : ''}`);
  if (!store.settings.lang) store.setSettings({ lang: I18N.detect(app.getLocale()) });

  let lcu, live, fetchJson;
  if (DEMO) {
    const { DemoLCU, demoLive, CHAMPS } = require('./src/demo');
    const { demoFetch } = require('./src/demo-static');
    lcu = new DemoLCU();
    live = demoLive(lcu);
    // no demo usa a Data Dragon real se houver internet; senão dados mínimos embutidos
    const off = demoFetch(CHAMPS);
    fetchJson = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(); return await r.json(); } catch { return off(url); } };
  } else {
    lcu = new LCU();
    live = liveClientData;
  }
  const gamedata = new GameData({ cacheDir: DEMO ? null : app.getPath('userData'), lang: I18N.DD_LOCALE[L()] || 'en_US', ...(fetchJson ? { fetchJson } : {}) });
  const builds = new BuildDB({ lcu, gamedata, dir: DEMO ? null : app.getPath('userData') });
  tracker = new Tracker({ lcu, live, store, gamedata, builds });
  builds.on('status', () => { if (mainVisible()) send('builds-status', builds.info()); });

  let pendingSend = null;
  tracker.on('state', () => {
    if (pendingSend) return; // agrupar atualizações rápidas
    pendingSend = setTimeout(() => { pendingSend = null; sendState(); overlayOnState(); }, 120);
  });
  tracker.on('notify', ({ title, lines }) => {
    const tr = (x) => I18N.t(L(), x.key, { ...(x.p || {}), rank: x.rank ? ' · ' + I18N.rankLabel(L(), x.rank) : '' });
    if (Notification.isSupported()) new Notification({ title: tr(title), body: lines.map(tr).join('\n'), silent: false }).show();
    if (win && !win.isFocused()) win.flashFrame(true);
  });

  // ---------- IPC ----------
  ipcMain.handle('history', () => tracker.ownHistory());
  ipcMain.handle('game-details', (_e, gameId) => tracker.gameDetails(gameId));
  ipcMain.handle('get-settings', () => store.settings);
  ipcMain.handle('set-settings', (_e, patch) => {
    const allowed = ['lang', 'autoAccept', 'alwaysOnTop', 'leagueDir', 'historyCount', 'notifyDanger', 'autoImport', 'collectBuilds', 'buildPlayers',
      'overlay', 'overlayKey', 'overlayAutoSeconds', 'overlaySide', 'lightMode', 'closeToTray', 'startWithWindows'];
    const clean = {};
    for (const k of allowed) if (patch && k in patch) clean[k] = patch[k];
    const s = store.setSettings(clean);
    if ('alwaysOnTop' in clean && win) win.setAlwaysOnTop(!!clean.alwaysOnTop);
    if ('leagueDir' in clean) lcu.disconnect();
    if ('lang' in clean && I18N.D[clean.lang]) {
      gamedata.setLang(I18N.DD_LOCALE[clean.lang]).then(() => tracker.analysis.clear()).then(() => sendState(true));
      buildTray();
    }
    if ('overlay' in clean || 'overlayKey' in clean) { registerHotkey(); buildTray(); if (!s.overlay) hideOverlay(); }
    if ('overlaySide' in clean && overlay) { overlay.destroy(); overlay = null; overlayVisible = false; }
    if ('startWithWindows' in clean) applyLoginItem();
    return s;
  });
  ipcMain.handle('set-note', (_e, { puuid, name, notes }) => { store.setNote(puuid, name, notes); return true; });
  ipcMain.handle('noted-players', () => store.notedPlayers());
  ipcMain.handle('player-profile', (_e, puuid) => tracker.playerProfile(String(puuid || '')));
  ipcMain.handle('champions', async () => { await gamedata.load(); return gamedata.champList().map((c) => ({ ...c, hasBuild: builds.hasChamp(c.id) })); });
  ipcMain.handle('get-build', async (_e, { championId, role }) => { await gamedata.load(); return builds.getBuild(championId, role || null); });
  ipcMain.handle('build-details', async (_e, { championId, role }) => { await gamedata.load(); return builds.loadDetails(championId, role || null); });
  ipcMain.handle('champ-info', (_e, id) => gamedata.champion(Number(id)));
  ipcMain.handle('builds-status', () => builds.info());
  ipcMain.handle('collect-now', () => { builds.data.fetched = {}; builds.collect({ maxPlayers: store.settings.buildPlayers || 150 }); return builds.info(); });
  ipcMain.handle('import-build', async (_e, { championId, role, what }) => {
    try { return { ok: true, ...(await tracker.importBuild(championId, role || null, what || 'both')) }; } catch (e) { log.error('import', e.message || e); return { ok: false, err: String(e.message || e) }; }
  });
  ipcMain.handle('diagnose', () => tracker.diagnose());
  ipcMain.handle('get-log', () => log.text());
  ipcMain.handle('clear-log', () => { log.clear(); return true; });
  ipcMain.handle('renderer-error', (_e, msg) => { log.error('ui', String(msg).slice(0, 800)); return true; });
  ipcMain.handle('copy-text', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('app-info', () => ({ version: app.getVersion(), electron: process.versions.electron, os: `${os.type()} ${os.release()}` }));
  ipcMain.handle('overlay-test', () => { showOverlay(8000); return true; });
  ipcMain.handle('refresh', () => { tracker.raw.clear(); tracker.analysis.clear(); return true; });

  createWindow();
  buildTray();
  registerHotkey();
  applyLoginItem();
  tracker.start();
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (tracker) tracker.stop(); app.quit(); });

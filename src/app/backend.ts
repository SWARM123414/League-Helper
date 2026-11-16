// "Processo principal" da app (o equivalente ao main.js do Electron), a correr na
// janela principal: liga o motor ao cliente do LoL, à bandeja, ao overlay, ao atalho
// global e às notificações, e expõe a `api` que a interface usa.

import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { sendNotification } from '@tauri-apps/plugin-notification';

import { BuildDB } from '../core/builds.ts';
import { CHAMPS, DemoLCU, demoLive } from '../core/demo.ts';
import { demoFetch } from '../core/demo-static.ts';
import { GameData } from '../core/gamedata.ts';
import type { FetchJson } from '../core/gamedata.ts';
import * as I18N from '../core/i18n.ts';
import { LCU, liveClientData } from '../core/lcu.ts';
import type { LcuLike } from '../core/lcu.ts';
import * as log from '../core/log.ts';
import { setPlatform } from '../core/platform.ts';
import { Store } from '../core/store.ts';
import type { Settings } from '../core/store.ts';
import { Tracker } from '../core/tracker.ts';
import type { LiveFn, TrackerState } from '../core/tracker.ts';
import { tauriPlatform } from './platform-tauri.ts';

const ALLOWED_SETTINGS: (keyof Settings)[] = ['lang', 'autoAccept', 'alwaysOnTop', 'leagueDir', 'historyCount', 'notifyDanger', 'autoImport', 'collectBuilds', 'buildPlayers',
  'overlay', 'overlayKey', 'overlayAutoSeconds', 'overlaySide', 'lightMode', 'closeToTray', 'startWithWindows'];

export type UiState = TrackerState & { demo: boolean; settings: Settings };

let DEMO = false;
let store: Store;
let lcu: LcuLike;
let gamedata: GameData;
let builds: BuildDB;
let tracker: Tracker;
const win = getCurrentWindow();

let stateListener: ((s: UiState) => void) | null = null;
let buildsListener: ((s: any) => void) | null = null;
let mainHidden = false;
let quitting = false;

const L = () => store.settings.lang || 'pt';
const t = (k: string, p?: Record<string, any>) => I18N.t(L(), k, p);

// ---------- janela principal ----------
function mainVisible(): boolean { return !mainHidden && document.visibilityState === 'visible'; }

function sendState(force = false): void {
  if (!tracker || !stateListener) return;
  // com a janela escondida ou minimizada não se gasta nada a desenhar
  if (!force && !mainVisible()) return;
  stateListener({ ...tracker.state, demo: DEMO, settings: store.settings });
}

async function hideMain(): Promise<void> {
  mainHidden = true;
  await invoke('main_hide'); // esconde e pára o desenho do WebView2
}

async function quit(): Promise<void> {
  if (quitting) return;
  quitting = true;
  tracker?.stop();
  try { await Promise.all([store.flush(), builds.flush()]); } catch { /* sai na mesma */ }
  log.flushNow();
  await invoke('quit_app');
}

// ---------- overlay ----------
// A janela do overlay só existe durante o jogo; no fim é destruída (poupa memória).
let overlayExists = false;
let overlayVisible = false;
let overlayHideTimer: ReturnType<typeof setTimeout> | null = null;
let overlayShownFor: unknown = null;
let lastOverlayPush = 0;

function overlayPayload() {
  const s = tracker.state;
  const g = s.game;
  if (!g || s.view !== 'game') return { lang: L(), hotkey: store.settings.overlayKey, game: null };
  const slim = (p: any) => p && ({
    championId: p.championId, championName: p.championName, name: p.name, position: p.position,
    rank: p.analysis && p.analysis.rank.solo ? { tier: p.analysis.rank.solo.tier, division: p.analysis.rank.solo.division, lp: p.analysis.rank.solo.lp } : null,
    winrate: p.analysis && p.analysis.rank.solo ? p.analysis.rank.solo.winrate : null,
    champGames: p.analysis && p.analysis.champion ? p.analysis.champion.games : null,
    tags: p.analysis ? p.analysis.tags.filter((x: any) => x.type === 'bad' || x.key === 'tilt' || x.key === 'firstTime').slice(0, 3) : [],
    mostDangerous: !!p.mostDangerous, weakest: !!p.weakest, laneOpponent: !!p.laneOpponent, premade: p.premade || null,
    ultCd: p.ultCd || null, live: p.live ? { k: p.live.k, d: p.live.d, a: p.live.a, level: p.live.level, isDead: p.live.isDead, respawn: p.live.respawn } : null,
    vsRecord: p.vsRecord || null
  });
  const b = g.myBuild;
  const it = (x: any) => ({ id: x.id, icon: x.icon, name: x.name });
  return {
    lang: L(),
    hotkey: store.settings.overlayKey,
    game: {
      queueId: g.queueId, gameTime: g.gameTime,
      enemies: g.enemies.map(slim),
      build: b ? {
        championName: b.championName, vs: b.vs ? b.vs.name : null,
        core: b.core.map(it), forMatch: (b.forMatch || []).map(it), boots: b.boots.slice(0, 1).map(it),
        skillOrder: b.details ? b.details.skillOrder : null
      } : null,
      tips: g.comp ? g.comp.tips.slice(0, 2) : [],
      premades: g.premades ? g.premades.enemies : []
    }
  };
}

function pushOverlay(force = false): void {
  if (!overlayExists || (!overlayVisible && !force)) return;
  const now = Date.now();
  if (!force && now - lastOverlayPush < 3000) return; // no máximo 1 atualização a cada 3 s
  lastOverlayPush = now;
  emitTo('overlay', 'overlay', overlayPayload()).catch(() => {});
}

async function showOverlay(ms = 0): Promise<void> {
  if (!store.settings.overlay) return;
  try {
    await invoke('overlay_show', { side: store.settings.overlaySide });
  } catch (e) { log.warn('overlay', String(e)); return; }
  overlayExists = true;
  overlayVisible = true;
  pushOverlay(true);
  if (overlayHideTimer) clearTimeout(overlayHideTimer);
  if (ms) overlayHideTimer = setTimeout(hideOverlay, ms);
}

function hideOverlay(): void {
  if (overlayHideTimer) clearTimeout(overlayHideTimer);
  overlayHideTimer = null;
  if (overlayExists) invoke('overlay_hide').catch(() => {});
  overlayVisible = false;
}

function destroyOverlay(): void {
  if (overlayHideTimer) clearTimeout(overlayHideTimer);
  overlayHideTimer = null;
  if (overlayExists) invoke('overlay_destroy').catch(() => {});
  overlayExists = false;
  overlayVisible = false;
}

function toggleOverlay(): void { if (overlayVisible) hideOverlay(); else showOverlay(0); }

function overlayOnState(): void {
  const s = tracker.state;
  const inGame = s.view === 'game' && s.game && !s.game.loading;
  if (!inGame) {
    // fora do jogo o overlay não serve para nada: liberta a janela
    if (overlayExists && s.view !== 'game' && !overlayHideTimer) destroyOverlay();
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

let registeredKey: string | null = null;
async function registerHotkey(): Promise<void> {
  if (registeredKey) { try { await unregister(registeredKey); } catch { /* ignora */ } registeredKey = null; }
  const key = store.settings.overlayKey;
  if (!store.settings.overlay || !key) return;
  try {
    await register(key, (ev) => { if (ev.state === 'Pressed') toggleOverlay(); });
    registeredKey = key;
  } catch (e) { log.warn('overlay', `atalho ${key} indisponível (já usado por outra app?): ${e}`); }
}

// ---------- bandeja e arranque com o Windows ----------
function updateTray(): void {
  invoke('tray_update', {
    labels: { open: t('tray.open'), overlay: t('tray.overlay'), quit: t('tray.quit') },
    overlayEnabled: !!store.settings.overlay
  }).catch((e) => log.warn('tray', String(e)));
}

function applyLoginItem(): void {
  invoke('set_autostart', { enabled: !!store.settings.startWithWindows }).catch((e) => log.warn('main', String(e)));
}

// ---------- api usada pela interface ----------
export const api = {
  onState: (cb: (s: UiState) => void) => { stateListener = cb; sendState(true); },
  onBuildsStatus: (cb: (s: any) => void) => { buildsListener = cb; },
  history: () => tracker.ownHistory(),
  gameDetails: (id: number | string) => tracker.gameDetails(id),
  getSettings: async () => store.settings,
  setSettings: async (patch: Partial<Settings>) => {
    const clean: Partial<Settings> = {};
    for (const k of ALLOWED_SETTINGS) if (patch && k in patch) (clean as any)[k] = patch[k];
    const s = store.setSettings(clean);
    if ('alwaysOnTop' in clean) win.setAlwaysOnTop(!!clean.alwaysOnTop).catch(() => {});
    if ('leagueDir' in clean) lcu.disconnect();
    if ('lang' in clean && I18N.D[clean.lang]) {
      gamedata.setLang(I18N.DD_LOCALE[clean.lang]).then(() => tracker.analysis.clear()).then(() => sendState(true));
      updateTray();
    }
    if ('overlay' in clean || 'overlayKey' in clean) { registerHotkey(); updateTray(); if (!s.overlay) destroyOverlay(); }
    if ('overlaySide' in clean) destroyOverlay();
    if ('startWithWindows' in clean) applyLoginItem();
    return s;
  },
  setNote: async (puuid: string, name: string, notes: string) => { store.setNote(puuid, name, notes); return true; },
  notedPlayers: async () => store.notedPlayers(),
  playerProfile: (puuid: string) => tracker.playerProfile(String(puuid || '')),
  refresh: async () => { tracker.raw.clear(); tracker.analysis.clear(); return true; },
  champions: async () => { await gamedata.load(); return gamedata.champList().map((c) => ({ ...c, hasBuild: builds.hasChamp(c.id) })); },
  getBuild: async (championId: number, role: string | null) => { await gamedata.load(); return builds.getBuild(championId, role || null); },
  buildDetails: async (championId: number, role: string | null) => { await gamedata.load(); return builds.loadDetails(championId, role || null); },
  champInfo: (id: number) => gamedata.champion(Number(id)),
  buildsStatus: async () => builds.info(),
  collectNow: async () => { builds.data.fetched = {}; builds.collect({ maxPlayers: store.settings.buildPlayers || 150 }); return builds.info(); },
  importBuild: async (championId: number, role: string | null, what: string) => {
    try { return { ok: true, ...(await tracker.importBuild(championId, role || null, what || 'both')) } as any; } catch (e) { log.error('import', (e as Error).message || e); return { ok: false, err: String((e as Error).message || e) }; }
  },
  diagnose: () => tracker.diagnose(),
  getLog: async () => log.text(),
  clearLog: async () => { log.clear(); return true; },
  reportError: async (msg: string) => { log.error('ui', String(msg).slice(0, 800)); return true; },
  copyText: async (text: string) => { await writeText(String(text || '')); return true; },
  appInfo: () => invoke<{ version: string; tauri: string; os: string }>('app_info'),
  overlayTest: async () => { await showOverlay(8000); return true; },
  // moldura própria
  minimize: () => win.minimize(),
  toggleMaximize: () => win.toggleMaximize(),
  isMaximized: () => win.isMaximized(),
  onResized: (cb: () => void) => win.onResized(cb),
  close: () => win.close()
};

export type Api = typeof api;

// ---------- arranque ----------
export async function startBackend(): Promise<void> {
  setPlatform(tauriPlatform);
  const flags = await invoke<{ demo: boolean; hidden: boolean }>('launch_flags');
  DEMO = flags.demo;
  mainHidden = flags.hidden;

  store = await new Store({ persist: !DEMO }).load();
  if (!DEMO) await log.init();
  const info = await api.appInfo().catch((): { version: string; tauri: string; os: string } => ({ version: '?', tauri: '?', os: '?' }));
  log.info('main', `LoL Scout ${info.version} · Tauri ${info.tauri} · ${info.os}${store.settings.lightMode ? ' · modo leve' : ''}`);
  if (!store.settings.lang) store.setSettings({ lang: I18N.detect(navigator.language) });

  let live: LiveFn;
  let fetchJson: FetchJson | undefined;
  if (DEMO) {
    const demo = new DemoLCU();
    lcu = demo;
    live = demoLive(demo);
    // no demo usa a Data Dragon real se houver internet; senão dados mínimos embutidos
    const off = demoFetch(CHAMPS);
    fetchJson = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(); return await r.json(); } catch { return off(url); } };
  } else {
    lcu = new LCU();
    live = liveClientData;
  }
  gamedata = new GameData({ useCache: !DEMO, lang: I18N.DD_LOCALE[L()] || 'en_US', ...(fetchJson ? { fetchJson } : {}) });
  builds = await new BuildDB({ lcu, gamedata, persist: !DEMO }).load();
  tracker = new Tracker({ lcu, live, store, gamedata, builds });
  builds.on('status', () => { if (mainVisible() && buildsListener) buildsListener(builds.info()); });

  let pendingSend: ReturnType<typeof setTimeout> | null = null;
  tracker.on('state', () => {
    if (pendingSend) return; // agrupar atualizações rápidas
    pendingSend = setTimeout(() => { pendingSend = null; sendState(); overlayOnState(); }, 120);
  });
  tracker.on('notify', async ({ title, lines }: { title: any; lines: any[] }) => {
    const tr = (x: any) => I18N.t(L(), x.key, { ...(x.p || {}), rank: x.rank ? ' · ' + I18N.rankLabel(L(), x.rank) : '' });
    try { sendNotification({ title: tr(title), body: lines.map(tr).join('\n') }); } catch (e) { log.warn('notify', String(e)); }
    try { if (!(await win.isFocused())) await win.requestUserAttention(UserAttentionType.Informational); } catch { /* ignora */ }
  });

  // janela: fechar → bandeja (ou sair); ao voltar a mostrar, envia logo o estado mais recente
  await win.onCloseRequested(async (e) => {
    if (!quitting && store.settings.closeToTray) { e.preventDefault(); await hideMain(); } else { e.preventDefault(); await quit(); }
  });
  await listen('main-shown', () => { mainHidden = false; sendState(true); });
  await listen('tray-overlay', () => toggleOverlay());
  await listen('quit-requested', () => quit());
  await listen('overlay-ready', () => pushOverlay(true));
  document.addEventListener('visibilitychange', () => { if (mainVisible()) sendState(true); });

  updateTray();
  registerHotkey();
  if (!DEMO) applyLoginItem();
  tracker.start();
}

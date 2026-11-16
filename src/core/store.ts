// Guarda localmente: definições, jogadores já encontrados, notas e resultados.
import { platform } from './platform.ts';

export interface Settings {
  lang: string | null;
  autoAccept: boolean;
  alwaysOnTop: boolean;
  leagueDir: string;
  historyCount: number;
  notifyDanger: boolean;
  autoImport: boolean;
  collectBuilds: boolean;
  buildPlayers: number;
  overlay: boolean;
  overlayKey: string;
  overlayAutoSeconds: number;
  overlaySide: 'left' | 'right';
  lightMode: boolean;
  closeToTray: boolean;
  startWithWindows: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: null,
  autoAccept: false,
  alwaysOnTop: false,
  leagueDir: '',
  historyCount: 20,
  notifyDanger: true,
  autoImport: false,
  collectBuilds: true,
  buildPlayers: 150,
  overlay: true,
  overlayKey: 'Ctrl+Shift+Z',
  overlayAutoSeconds: 20,
  overlaySide: 'right',
  lightMode: false,
  closeToTray: true,
  startWithWindows: false
};

interface Encounter { gameId: number | string; date: number; ally: boolean; championId: number }
interface PlayerRec { name?: string; tag?: string; notes: string; encounters: Encounter[] }
interface GameRec { myChamp?: number | null; enemies?: number[]; allies?: number[]; laneOpp?: number | null }

interface Data {
  settings: Settings;
  players: Record<string, PlayerRec>;
  results: Record<string, { win?: boolean; date?: number; championId?: number; queueId?: number }>;
  games: Record<string, GameRec>;
}

const FILE = 'lol-scout-data.json';

export class Store {
  data: Data;
  persist: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor({ persist = true }: { persist?: boolean } = {}) {
    this.persist = persist;
    this.data = { settings: { ...DEFAULT_SETTINGS }, players: {}, results: {}, games: {} };
  }

  async load(): Promise<this> {
    if (!this.persist) return this;
    try {
      const text = await platform().readData(FILE);
      if (text) {
        const loaded = JSON.parse(text);
        this.data = { ...this.data, ...loaded, settings: { ...DEFAULT_SETTINGS, ...(loaded.settings || {}) } };
        if (!this.data.games) this.data.games = {};
      }
    } catch { /* primeira vez */ }
    return this;
  }

  save(): void {
    if (!this.persist) return;
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.flush(); }, 300);
  }

  /** grava já o que estiver pendente (ao sair) */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await platform().writeData(FILE, JSON.stringify(this.data, null, 1));
    } catch (e) { console.error('Erro a guardar dados', e); }
  }

  get settings(): Settings { return this.data.settings; }
  setSettings(patch: Partial<Settings>): Settings { Object.assign(this.data.settings, patch); this.save(); return this.data.settings; }

  recordEncounter({ puuid, name, tag, gameId, ally, championId, date = Date.now() }:
    { puuid: string; name?: string; tag?: string; gameId: number | string; ally: boolean; championId: number; date?: number }): void {
    if (!puuid) return;
    const p = this.data.players[puuid] || (this.data.players[puuid] = { name, tag, notes: '', encounters: [] });
    if (name) { p.name = name; p.tag = tag; }
    if (!p.encounters.some((e) => e.gameId === gameId)) {
      p.encounters.push({ gameId, date, ally, championId });
      if (p.encounters.length > 50) p.encounters.shift();
      this.save();
    }
  }

  recordResult(gameId: number | string, info: { win?: boolean; date?: number; championId?: number; queueId?: number }): void {
    if (!gameId) return;
    this.data.results[gameId] = { ...(this.data.results[gameId] || {}), ...info };
    this.save();
  }

  // Resumo de encontros anteriores (exclui o jogo atual)
  history(puuid: string, currentGameId?: number | string | null) {
    const p = this.data.players[puuid];
    if (!p) return { notes: '', withW: 0, withL: 0, vsW: 0, vsL: 0, total: 0, last: null as number | null };
    let withW = 0, withL = 0, vsW = 0, vsL = 0, total = 0, last: number | null = null;
    for (const e of p.encounters) {
      if (e.gameId === currentGameId) continue;
      total++;
      last = Math.max(last || 0, e.date);
      const r = this.data.results[e.gameId];
      if (!r || r.win === undefined) continue;
      if (e.ally) { if (r.win) withW++; else withL++; } else if (r.win) vsW++; else vsL++;
    }
    return { notes: p.notes || '', withW, withL, vsW, vsL, total, last };
  }

  // Guarda os campeões de um jogo teu (para "o teu histórico contra X")
  recordGame(gameId: number | string, info: GameRec): void {
    if (!gameId) return;
    this.data.games[gameId] = { ...(this.data.games[gameId] || {}), ...info };
    const ids = Object.keys(this.data.games);
    if (ids.length > 1500) delete this.data.games[ids[0]];
    this.save();
  }

  hasGame(gameId: number | string): boolean { return !!this.data.games[gameId]; }

  // O teu histórico contra um campeão: em qualquer posição, na tua lane, e na lane com o mesmo campeão teu
  vsRecord(champId: number, myChamp?: number | null, excludeGameId?: number | string | null) {
    const all = { w: 0, l: 0 }, lane = { w: 0, l: 0 }, laneMine = { w: 0, l: 0 };
    if (!champId) return { all, lane, laneMine };
    for (const [gid, g] of Object.entries(this.data.games)) {
      if (String(gid) === String(excludeGameId)) continue;
      const r = this.data.results[gid];
      if (!r || r.win === undefined) continue;
      const k = r.win ? 'w' : 'l';
      if ((g.enemies || []).includes(champId)) all[k]++;
      if (g.laneOpp === champId) {
        lane[k]++;
        if (myChamp && g.myChamp === myChamp) laneMine[k]++;
      }
    }
    return { all, lane, laneMine };
  }

  setNote(puuid: string, name: string, notes: string): void {
    const p = this.data.players[puuid] || (this.data.players[puuid] = { name, notes: '', encounters: [] });
    p.notes = String(notes || '').slice(0, 500);
    this.save();
  }

  notedPlayers() {
    return Object.entries(this.data.players)
      .filter(([, p]) => p.notes)
      .map(([puuid, p]) => ({ puuid, name: p.name, tag: p.tag, notes: p.notes, encounters: p.encounters.length }));
  }
}

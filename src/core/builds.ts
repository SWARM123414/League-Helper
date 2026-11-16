// Builds a partir de jogos reais de alto elo (Challenger / Grão-Mestre / Mestre) da tua
// região, recolhidos pelo próprio cliente do LoL. Calcula runas, itens, botas, feitiços,
// itens iniciais, ordem de itens e ordem de habilidades por campeão e posição.

import * as A from './analyzer.ts';
import type { Game } from './analyzer.ts';
import { Emitter } from './emitter.ts';
import type { GameData, Composition } from './gamedata.ts';
import type { LcuLike } from './lcu.ts';
import * as log from './log.ts';
import { platform, sleep } from './platform.ts';

const FILE = 'lol-scout-builds.json';
const RANKED_SOLO = 420;
const STALE_MS = 20 * 60 * 60 * 1000;     // recolher de novo ao fim de 20 h
const DETAILS_MS = 24 * 60 * 60 * 1000;
const MIN_ROLE_GAMES = 8;
const TRINKETS = new Set([3340, 3363, 3364, 3330]);
const KEYS: Record<number, string> = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' };
const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const ENOUGH_GAMES = 40;
const SMALL_SAMPLE = 20;

type Counter = Record<string, [number, number]>; // chave -> [jogos, vitórias]
interface Bucket { n: number; w: number; items: Counter; boots: Counter; pages: Counter; spells: Counter; refs: { g: number; p: string; w: number; t: number }[] }
type ChampAgg = Record<string, Bucket>;

function bump(obj: Counter, key: string | number, win: boolean): void {
  const e = obj[key] || (obj[key] = [0, 0]);
  e[0]++; if (win) e[1]++;
}
function mode<T>(list: T[]): { value: string; n: number } | null {
  const c: Record<string, number> = {};
  for (const x of list) if (x !== null && x !== undefined && (x as unknown) !== '') c[String(x)] = (c[String(x)] || 0) + 1;
  const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return best ? { value: best[0], n: best[1] } : null;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

// moda com pesos: [[valor, peso], ...]
function wmode(pairs: [unknown, number][]): string | null {
  const c: Record<string, number> = {};
  for (const [v, w] of pairs) if (v !== null && v !== undefined && v !== '' && !Number.isNaN(v)) c[String(v)] = (c[String(v)] || 0) + w;
  const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}
function emptyBucket(): Bucket { return { n: 0, w: 0, items: {}, boots: {}, pages: {}, spells: {}, refs: [] }; }
function addInto(t: Bucket, s: Bucket, k: number): void {
  t.n += s.n * k; t.w += s.w * k;
  for (const f of ['items', 'boots', 'pages', 'spells'] as const) {
    for (const [key, [n, w]] of Object.entries(s[f] || {})) {
      const e = t[f][key] || (t[f][key] = [0, 0]);
      e[0] += n * k; e[1] += w * k;
    }
  }
  t.refs = [...t.refs, ...(s.refs || [])].sort((a, b) => b.t - a.t).slice(0, 30);
}

export interface BuildStatus { running: boolean; done: number; total: number; games: number; players: number; error: string | null }

export interface MatchupCtx {
  enemyComp: Composition | null;
  opp: { championId: number; name: string; damageType: string | null; ranged: boolean | null } | null;
  meRanged: boolean | null;
}

export class BuildDB extends Emitter {
  lcu: LcuLike;
  gd: GameData;
  persist: boolean;
  data: { v: number; region: string | null; updated: number; fetched: Record<string, number>; patches: Record<string, Record<string, ChampAgg>>; details: Record<string, any> };
  seen: Set<string> = new Set();
  status: BuildStatus = { running: false, done: 0, total: 0, games: 0, players: 0, error: null };
  shouldPause: () => boolean = () => false;
  private merged: Map<number, any> = new Map();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor({ lcu, gamedata, persist = false }: { lcu: LcuLike; gamedata: GameData; persist?: boolean }) {
    super();
    this.lcu = lcu;
    this.gd = gamedata;
    this.persist = persist;
    this.data = { v: 2, region: null, updated: 0, fetched: {}, patches: {}, details: {} };
  }

  async load(): Promise<this> {
    if (this.persist) {
      try {
        const text = await platform().readData(FILE);
        const d = text ? JSON.parse(text) : null;
        if (d && d.v === 2) {
          this.data = { ...this.data, ...d };
          delete (this.data as any).seen;
          this.seen = new Set(d.seen || []);
        }
      } catch { /* primeira vez ou formato antigo: recolhe de novo */ }
    }
    this.status.games = this.countGames();
    return this;
  }

  save(): void {
    if (!this.persist) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.flush(); }, 500);
  }

  async flush(): Promise<void> {
    if (!this.persist || !this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      const seen = [...this.seen].slice(-60000);
      await platform().writeData(FILE, JSON.stringify({ ...this.data, seen }));
    } catch (e) { log.error('builds', `erro a guardar: ${(e as Error).message || e}`); }
  }

  // ---------- patches ----------
  // ordena "14.23" > "14.9" > "unknown"
  patchList(): string[] {
    const v = (p: string) => (p === 'unknown' ? [-1, -1] : p.split('.').map(Number));
    return Object.keys(this.data.patches).sort((a, b) => { const [a1, a2] = v(a); const [b1, b2] = v(b); return b1 - a1 || b2 - a2; });
  }
  currentPatch(): string | null { return this.patchList()[0] || null; }

  prunePatches(keep = 3): void {
    const list = this.patchList();
    for (const p of list.slice(keep)) delete this.data.patches[p];
  }

  countGames(): number {
    let n = 0;
    for (const agg of Object.values(this.data.patches)) {
      for (const roles of Object.values(agg)) for (const k of ['ALL', 'ARAM', 'ARENA']) if (roles[k]) n += roles[k].n;
    }
    return n;
  }

  champIds(): Set<number> {
    const ids = new Set<number>();
    for (const agg of Object.values(this.data.patches)) for (const id of Object.keys(agg)) ids.add(Number(id));
    return ids;
  }
  hasChamp(id: number): boolean { return this.champIds().has(Number(id)); }

  isStale(): boolean { return !this.data.updated || Date.now() - this.data.updated > STALE_MS || this.countGames() < 200; }

  // ---------- agregação ----------
  addGame(puuid: string, g: Game): boolean {
    if (g.remake || !g.championId) return false;
    let roles: string[];
    if (g.queueId === RANKED_SOLO) roles = [A.roleOf(g) || 'NONE', 'ALL'];
    else if (g.queueId === 450) roles = ['ARAM'];
    else if (g.queueId === 1700 || g.queueId === 1710) roles = ['ARENA'];
    else return false;
    const key = `${g.gameId}:${puuid}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    const patch = g.patch || 'unknown';
    if (!this.data.patches[patch]) { this.data.patches[patch] = {}; this.prunePatches(); if (!this.data.patches[patch]) return false; }
    const agg = this.data.patches[patch];
    const champ = (agg[g.championId] = agg[g.championId] || {});
    const items = [...new Set(g.items)];
    for (const r of roles) {
      const b = champ[r] || (champ[r] = emptyBucket());
      b.n++; if (g.win) b.w++;
      for (const id of items) {
        if (TRINKETS.has(id)) continue;
        if (this.gd.isBoots(id)) bump(b.boots, id, g.win);
        else if (this.gd.isCompleted(id)) bump(b.items, id, g.win);
      }
      if (g.perks.length === 6 && g.primaryStyle && g.subStyle) {
        bump(b.pages, `${g.primaryStyle}|${g.subStyle}|${g.perks.join(',')}|${g.shards.join(',')}`, g.win);
      }
      if (g.spells && g.spells[0] && g.spells[1]) bump(b.spells, [...g.spells].sort((x, y) => x - y).join(','), g.win);
      b.refs.unshift({ g: g.gameId, p: puuid, w: g.win ? 1 : 0, t: g.date });
      if (b.refs.length > 30) b.refs.length = 30;
    }
    this.merged.clear();
    return true;
  }

  // Junta o patch atual com os anteriores (com menos peso) até haver jogos suficientes
  mergedChamp(champId: number): { roles: Record<string, Bucket>; used: { patch: string; games: number; weight: number }[]; current: string | null } {
    const cached = this.merged.get(champId);
    if (cached) return cached;
    const patches = this.patchList();
    const out: Record<string, Bucket> = {};
    const used: { patch: string; games: number; weight: number }[] = [];
    let weight = 1;
    for (let i = 0; i < patches.length; i++) {
      const c = this.data.patches[patches[i]][champId];
      if (c) {
        used.push({ patch: patches[i], games: (c.ALL && c.ALL.n) || (c.ARAM && c.ARAM.n) || (c.ARENA && c.ARENA.n) || 0, weight });
        for (const [role, b] of Object.entries(c)) addInto(out[role] || (out[role] = emptyBucket()), b, weight);
      }
      const total = (out.ALL && out.ALL.n) || 0;
      if (total >= ENOUGH_GAMES) break;
      weight /= 2;
    }
    const res = { roles: out, used, current: patches[0] || null };
    this.merged.set(champId, res);
    return res;
  }

  bucket(champId: number, role: string | null): { b: Bucket | null; role: string | null } {
    const { roles: c } = this.mergedChamp(champId);
    if (!c || !Object.keys(c).length) return { b: null, role: null };
    if (role === 'ARAM' || role === 'ARENA') return { b: c[role] || null, role };
    let r = role && c[role] && c[role].n >= MIN_ROLE_GAMES ? role : null;
    if (!r && !role) {
      const best = ROLES.filter((x) => c[x]).sort((x, y) => c[y].n - c[x].n)[0];
      if (best && c[best].n >= MIN_ROLE_GAMES) r = best;
    }
    if (!r && role && c[role] && c[role].n > 0 && (!c.ALL || c.ALL.n < MIN_ROLE_GAMES)) r = role;
    return r ? { b: c[r], role: r } : { b: c.ALL || null, role: 'ALL' };
  }

  rolesFor(champId: number): { role: string; games: number }[] {
    const { roles: c } = this.mergedChamp(champId);
    return [...ROLES, 'ARAM', 'ARENA'].filter((r) => c[r]).map((r) => ({ role: r, games: Math.round(c[r].n) })).sort((a, b) => b.games - a.games);
  }

  runePage(b: Bucket) {
    const pages = Object.entries(b.pages).map(([k, [n, w]]) => {
      const [p, s, perks, shards] = k.split('|');
      return { primary: Number(p), sub: Number(s), perks: perks.split(',').map(Number), shards: shards ? shards.split(',').map(Number) : [], n, w };
    });
    if (!pages.length) return null;
    const primary = Number(wmode(pages.map((p) => [p.primary, p.n])));
    const withP = pages.filter((p) => p.primary === primary);
    const perks = [0, 1, 2, 3].map((i) => Number(wmode(withP.map((p) => [p.perks[i], p.n]))));
    const sub = Number(wmode(withP.map((p) => [p.sub, p.n])));
    const withS = withP.filter((p) => p.sub === sub);
    const pair = String(wmode(withS.map((p) => [[p.perks[4], p.perks[5]].sort((a, b) => a - b).join(','), p.n]))).split(',').map(Number);
    // manter a ordem das filas da árvore secundária
    const st = this.gd.style(sub);
    if (st.slots) pair.sort((a, b) => st.slots.findIndex((s) => s.includes(a)) - st.slots.findIndex((s) => s.includes(b)));
    const withShards = withP.filter((p) => p.shards.length === 3);
    const shards = withShards.length ? [0, 1, 2].map((i) => Number(wmode(withShards.map((p) => [p.shards[i], p.n])))) : [5008, 5008, 5011];
    const total = pages.reduce((t, p) => t + p.n, 0);
    const key = pages.filter((p) => p.perks[0] === perks[0]);
    const kn = key.reduce((t, p) => t + p.n, 0);
    const kw = key.reduce((t, p) => t + p.w, 0);
    return { primary, sub, perks: [...perks, ...pair], shards, keystonePick: pct(kn, total), keystoneWr: pct(kw, kn) };
  }

  getBuild(champIdIn: number | string, role: string | null): any {
    const champId = Number(champIdIn);
    const { b, role: usedRole } = this.bucket(champId, role);
    if (!b || !b.n) return null;
    const gd = this.gd;
    const list = (obj: Counter) => Object.entries(obj).map(([id, [n, w]]) => ({ id: Number(id), name: gd.itemName(Number(id)), icon: gd.itemIcon(Number(id)), pick: pct(n, b.n), wr: pct(w, n), n: Math.round(n * 10) / 10 }))
      .sort((x, y) => y.n - x.n);
    const items = list(b.items).filter((x) => x.n >= 1.5 || b.n < 10);
    const boots = list(b.boots).slice(0, 2);
    const page = this.runePage(b);
    const spells = Object.entries(b.spells).map(([k, [n, w]]) => ({ ids: k.split(',').map(Number), pick: pct(n, b.n), wr: pct(w, n), n })).sort((x, y) => y.n - x.n).slice(0, 2);
    let det = this.data.details[`${champId}:${usedRole}`];
    if (det && det.patch && det.patch !== this.currentPatch()) det = null;
    let core = items.slice(0, 3);
    if (det && det.order && det.order.length) {
      // ordenar o core pela ordem real de compra
      const ord: number[] = det.order;
      core = [...core].sort((x, y) => (ord.indexOf(x.id) < 0 ? 9 : ord.indexOf(x.id)) - (ord.indexOf(y.id) < 0 ? 9 : ord.indexOf(y.id)));
    }
    const c = gd.champ(champId);
    return {
      championId: champId,
      championName: c ? c.name : `#${champId}`,
      role: usedRole,
      requestedRole: role || null,
      roles: this.rolesFor(champId),
      games: Math.round(b.n),
      winrate: pct(b.w, b.n),
      smallSample: b.n < SMALL_SAMPLE,
      patch: this.mergedChamp(champId).current,
      patchesUsed: this.mergedChamp(champId).used,
      core,
      situational: items.slice(3, 9),
      boots,
      runes: page ? {
        ...page,
        primaryStyle: gd.style(page.primary),
        subStyle: gd.style(page.sub),
        perkInfo: page.perks.map((id) => gd.rune(id)),
        shardInfo: page.shards.map((id) => gd.rune(id))
      } : null,
      spells,
      details: det && det.at && Date.now() - det.at < DETAILS_MS * 7 ? {
        starting: (det.starting || []).map((id: number) => ({ id, name: gd.itemName(id), icon: gd.itemIcon(id) })),
        skillOrder: det.skillOrder || null,
        skillSeq: det.skillSeq || [],
        sample: det.sample || 0
      } : null,
      region: this.data.region,
      updated: this.data.updated
    };
  }

  // ---------- build contra o adversário desta partida ----------
  matchupBuild(base: any, ctx: MatchupCtx | null): any {
    if (!base || !ctx) return base;
    const { b } = this.bucket(base.championId, base.requestedRole);
    if (!b) return base;
    const gd = this.gd;
    const comp = ctx.enemyComp || null;
    const opp = ctx.opp || null;
    const coreIds = new Set(base.core.map((x: any) => x.id));
    const minN = Math.max(2, Math.round(b.n * 0.03));
    const pool = Object.entries(b.items).map(([id, [n, w]]) => ({ id: Number(id), n, w }))
      .filter((x) => !coreIds.has(x.id) && (x.n >= minN || b.n < 15));
    const scored = pool.map((x) => {
      let score = pct(x.n, b.n) * 0.3;
      const why: { key: string; p?: Record<string, any> }[] = [];
      const armor = gd.itemHas(x.id, 'Armor');
      const mr = gd.itemHas(x.id, 'SpellBlock');
      if (comp && comp.adPct >= 60 && armor) { score += 40; why.push({ key: 'why.armor', p: { pct: comp.adPct } }); }
      if (comp && comp.apPct >= 55 && mr) { score += 40; why.push({ key: 'why.mr', p: { pct: comp.apPct } }); }
      if (opp && opp.damageType === 'AD' && armor) { score += 25; why.push({ key: 'why.laneArmor', p: { champ: opp.name } }); }
      if (opp && opp.damageType === 'AP' && mr) { score += 25; why.push({ key: 'why.laneMr', p: { champ: opp.name } }); }
      if (comp && comp.heal >= 1 && gd.isAntiHeal(x.id)) { score += 35 * Math.min(comp.heal, 2); why.push({ key: 'why.antiheal', p: { names: comp.healers.join(', ') } }); }
      if (comp && comp.tanks >= 2 && (gd.itemHas(x.id, 'ArmorPenetration') || gd.itemHas(x.id, 'MagicPenetration'))) { score += 30; why.push({ key: 'why.pen', p: { n: comp.tanks } }); }
      if (!why.length) why.push({ key: 'why.popular' });
      return { ...x, score, why };
    }).sort((x, y) => y.score - x.score);
    const item = (x: { id: number; n: number; w: number; why: any[] }) => ({ id: x.id, name: gd.itemName(x.id), icon: gd.itemIcon(x.id), pick: pct(x.n, b.n), wr: pct(x.w, x.n), n: x.n, why: x.why });
    const forMatch = scored.filter((x) => x.why[0].key !== 'why.popular').slice(0, 3).map(item);
    const chosen = new Set(forMatch.map((x) => x.id));
    const situational = scored.filter((x) => !chosen.has(x.id)).slice(0, 5).map(item);

    // botas
    const bootsPool = Object.entries(b.boots).map(([id, [n, w]]) => ({ id: Number(id), n, w })).sort((x, y) => y.n - x.n);
    let boots = base.boots;
    let bootsWhy: { key: string } | null = null;
    const has = (id: number) => bootsPool.find((x) => x.id === id);
    const pickBoots = (id: number, key: string) => { const x = has(id); if (x) { boots = [item({ ...x, why: [] }), ...base.boots.filter((y: any) => y.id !== id)].slice(0, 2); bootsWhy = { key }; } };
    if (comp && (comp.adPct >= 65 || (opp && opp.damageType === 'AD' && comp.adPct >= 55))) pickBoots(3047, 'why.bootsArmor');
    else if (comp && (comp.apPct >= 60 || comp.cc >= 3 || (opp && opp.damageType === 'AP' && comp.apPct >= 50))) pickBoots(3111, 'why.bootsMr');

    // item inicial: corpo-a-corpo contra alguém à distância no topo
    let starting = base.details ? base.details.starting : null;
    let startWhy: { key: string; p: Record<string, any> } | null = null;
    if (opp && opp.ranged && ctx.meRanged === false && (base.role === 'TOP' || base.requestedRole === 'TOP') && gd.item(1054)) {
      starting = [1054, 2003].map((id) => ({ id, name: gd.itemName(id), icon: gd.itemIcon(id) }));
      startWhy = { key: 'why.doranShield', p: { champ: opp.name } };
    }
    const tips: { key: string; p: Record<string, any> }[] = [];
    if (opp && opp.ranged && ctx.meRanged === false) tips.push({ key: 'mu.runeTip', p: { champ: opp.name } });

    return {
      ...base,
      vs: opp ? { championId: opp.championId, name: opp.name, damageType: opp.damageType, ranged: opp.ranged } : null,
      forMatch, situational, boots, bootsWhy, startWhy, tips,
      details: base.details ? { ...base.details, starting: starting || base.details.starting } : (starting ? { starting, skillOrder: null, skillSeq: [], sample: 0 } : null)
    };
  }

  // ---------- detalhes via timelines (itens iniciais, ordem de itens e habilidades) ----------
  async loadDetails(champIdIn: number | string, role: string | null): Promise<any> {
    const champId = Number(champIdIn);
    const { b, role: usedRole } = this.bucket(champId, role);
    if (!b) return null;
    const key = `${champId}:${usedRole}`;
    const cached = this.data.details[key];
    if (cached && Date.now() - cached.at < DETAILS_MS && cached.sample >= 3 && (!cached.patch || cached.patch === this.currentPatch())) return this.getBuild(champId, role);
    const refs = [...b.refs].sort((x, y) => y.w - x.w || y.t - x.t).slice(0, 10);
    const starts: string[] = [], orders: number[][] = [], firsts: string[] = [], maxes: string[] = [], seqs: string[][] = [];
    for (const ref of refs) {
      try {
        const game = await this.lcu.safeGet(`/lol-match-history/v1/games/${ref.g}`);
        if (!game) continue;
        const ident = (game.participantIdentities || []).find((i: any) => i.player && i.player.puuid === ref.p);
        const pid = ident ? ident.participantId : null;
        if (!pid) continue;
        const tl = await this.lcu.safeGet(`/lol-match-history/v1/game-timelines/${ref.g}`);
        if (!tl || !tl.frames) continue;
        const ev = tl.frames.flatMap((f: any) => f.events || []).filter((e: any) => e.participantId === pid).sort((a: any, b2: any) => a.timestamp - b2.timestamp);
        const buys = ev.filter((e: any) => e.type === 'ITEM_PURCHASED');
        const start = buys.filter((e: any) => e.timestamp <= 60000 && !TRINKETS.has(e.itemId)).map((e: any) => e.itemId as number);
        if (start.length) starts.push(start.sort((a: number, b2: number) => a - b2).join(','));
        const order: number[] = [];
        for (const e of buys) if (this.gd.isCompleted(e.itemId) && !this.gd.isBoots(e.itemId) && !order.includes(e.itemId)) order.push(e.itemId);
        if (order.length) orders.push(order.slice(0, 3));
        const skills: string[] = ev.filter((e: any) => e.type === 'SKILL_LEVEL_UP' && (!e.levelUpType || e.levelUpType === 'NORMAL')).map((e: any) => KEYS[e.skillSlot]).filter(Boolean);
        if (skills.length >= 3) {
          firsts.push(skills.slice(0, 3).join(''));
          seqs.push(skills.slice(0, 18));
          const cnt: Record<string, number> = { Q: 0, W: 0, E: 0 }, done: string[] = [];
          for (const s of skills) { if (s in cnt) { cnt[s]++; if (cnt[s] === 5) done.push(s); } }
          const rest = ['Q', 'W', 'E'].filter((s) => !done.includes(s)).sort((x, y) => cnt[y] - cnt[x]);
          maxes.push([...done, ...rest].join(' > '));
        }
        await sleep(150);
      } catch { /* jogo sem timeline */ }
    }
    const orderPos = (i: number) => { const m = mode(orders.map((o) => o[i])); return m ? Number(m.value) : null; };
    const order: number[] = [];
    for (let i = 0; i < 3; i++) { const v = orderPos(i); if (v && !order.includes(v)) order.push(v); }
    const seqMode: (string | null)[] = [];
    for (let i = 0; i < 18; i++) { const m = mode(seqs.map((s) => s[i])); seqMode.push(m ? m.value : null); }
    const startMode = mode(starts);
    const maxMode = mode(maxes);
    const firstMode = mode(firsts);
    this.data.details[key] = {
      at: Date.now(),
      patch: this.currentPatch(),
      sample: Math.max(seqs.length, orders.length),
      starting: startMode ? startMode.value.split(',').map(Number) : [],
      order,
      skillOrder: maxMode ? maxMode.value : null,
      first: firstMode ? firstMode.value : null,
      skillSeq: seqMode
    };
    this.save();
    return this.getBuild(champId, role);
  }

  // ---------- recolha de jogos ----------
  async collect({ maxPlayers = 150 }: { maxPlayers?: number } = {}): Promise<void> {
    if (this.status.running) return;
    this.status = { ...this.status, running: true, done: 0, total: 0, error: null };
    this.emit('status', this.status);
    try {
      await this.gd.load();
      const region = await this.lcu.safeGet('/riotclient/region-locale', {});
      this.data.region = (region && (region.region || region.webRegion)) || this.data.region;
      let players: string[] = [];
      for (const tier of ['CHALLENGER', 'GRANDMASTER', 'MASTER']) {
        if (players.length >= maxPlayers) break;
        const lad = await this.lcu.safeGet(`/lol-ranked/v1/apex-leagues/RANKED_SOLO_5x5/${tier}`);
        const st = (lad && (lad.divisions || []).flatMap((d: any) => d.standings || [])) || [];
        players.push(...st.filter((s: any) => s.puuid).sort((a: any, b: any) => (b.leaguePoints || 0) - (a.leaguePoints || 0)).map((s: any) => s.puuid as string));
      }
      players = [...new Set(players)].slice(0, maxPlayers).filter((p) => !this.data.fetched[p] || Date.now() - this.data.fetched[p] > STALE_MS);
      if (!players.length && this.countGames() === 0) throw new Error('err.noLadder');
      this.status.total = players.length;
      this.status.players = players.length;
      let idx = 0;
      const worker = async () => {
        while (idx < players.length) {
          while (this.shouldPause()) await sleep(4000);
          const puuid = players[idx++];
          const h = await this.lcu.safeGet(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=19`);
          for (const g of A.normalizeGames(h, puuid)) this.addGame(puuid, g);
          this.data.fetched[puuid] = Date.now();
          this.status.done++;
          this.status.games = this.countGames();
          if (this.status.done % 5 === 0) { this.emit('status', this.status); this.save(); }
          await sleep(300);
        }
      };
      await Promise.all([worker(), worker()]);
      this.data.updated = Date.now();
      this.save();
    } catch (e) {
      this.status.error = String((e as Error).message || e);
      log.error('builds', this.status.error);
    }
    this.status.running = false;
    this.status.games = this.countGames();
    this.emit('status', this.status);
  }

  info() {
    return { ...this.status, updated: this.data.updated, region: this.data.region, champions: this.champIds().size, patch: this.currentPatch() };
  }
}

// ---------- importar para o cliente ----------

// Fragmentos válidos por fila (desde 2024)
const SHARD_ROWS = [[5008, 5005, 5007], [5008, 5010, 5001], [5011, 5013, 5001]];
const POS_LCU: Record<string, string> = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'middle', BOTTOM: 'bottom', UTILITY: 'utility' };

interface Page { primary: number; sub: number; perks: number[]; shards: number[] }

// Confirma que a página é válida (runas nas árvores e filas certas); corrige os fragmentos
export function validatePage(page: any, gd: GameData | null): Page | null {
  if (!page || !page.primary || !page.sub || page.primary === page.sub) return null;
  const perks = (page.perks || []).map(Number);
  if (perks.length !== 6 || perks.some((x: number) => !x)) return null;
  const P = gd && gd.styles[page.primary];
  const S = gd && gd.styles[page.sub];
  if (P && P.slots && P.slots.length >= 4) {
    for (let i = 0; i < 4; i++) if (!P.slots[i].includes(perks[i])) return null;
  }
  if (S && S.slots && S.slots.length >= 4) {
    const rows = [perks[4], perks[5]].map((id) => S.slots.findIndex((sl, i) => i > 0 && sl.includes(id)));
    if (rows.some((r) => r < 1) || rows[0] === rows[1]) return null;
  }
  const shards = SHARD_ROWS.map((row, i) => (row.includes(Number((page.shards || [])[i])) ? Number(page.shards[i]) : row[0]));
  return { primary: Number(page.primary), sub: Number(page.sub), perks, shards };
}

// Página recomendada pela própria Riot (usada se não houver dados de alto elo)
async function recommendedPage(lcu: LcuLike, championId: number, position: string | null): Promise<Page | null> {
  const pos = POS_LCU[position] || 'none';
  const list = await lcu.safeGet(`/lol-perks/v1/recommended-pages/champion/${championId}/position/${pos}/map/11`)
    || await lcu.safeGet(`/lol-perks/v1/recommended-pages/champion/${championId}/position/none/map/11`);
  const r = Array.isArray(list) && list[0];
  if (!r) return null;
  const ids = (r.perks || []).map((x: any) => (typeof x === 'object' ? x.id : x)).filter(Boolean);
  if (ids.length < 6) return null;
  return { primary: r.primaryPerkStyleId, sub: r.secondaryPerkStyleId, perks: ids.slice(0, 6), shards: ids.slice(6, 9) };
}

export async function importRunes(lcu: LcuLike, build: any, { gd = null, position = null }: { gd?: GameData | null; position?: string | null } = {}) {
  if (!build) throw new Error('err.noRunes');
  let page = build.runes ? validatePage(build.runes, gd) : null;
  let source: 'highElo' | 'riot' = 'highElo';
  if (!page) {
    if (build.runes) log.warn('runes', `página de alto elo inválida para ${build.championName}: ${JSON.stringify({ p: build.runes.primary, s: build.runes.sub, perks: build.runes.perks })}`);
    page = validatePage(await recommendedPage(lcu, build.championId, position || build.requestedRole || build.role), gd);
    source = 'riot';
  }
  if (!page) throw new Error('err.noRunes');

  const name = `LoL Scout ${build.championName}`.slice(0, 25);
  const body = { name, primaryStyleId: page.primary, subStyleId: page.sub, selectedPerkIds: [...page.perks, ...page.shards], current: true };
  const pages: any[] = (await lcu.get('/lol-perks/v1/pages')) || [];
  const editable = pages.filter((p) => p.isEditable !== false && p.isDeletable !== false && !p.isTemporary);
  const ours = editable.find((p) => String(p.name || '').startsWith('LoL Scout'));
  let replaced: string | null = null;
  let pageId: number | null = null;

  const putPage = async (target: any): Promise<number | null> => {
    try {
      await lcu.put(`/lol-perks/v1/pages/${target.id}`, { ...target, ...body, id: target.id });
      return target.id;
    } catch (e) {
      // algumas versões do cliente não aceitam PUT: apagar e criar de novo
      log.warn('runes', `PUT falhou (${(e as Error).message}); a apagar e criar`);
      await lcu.del(`/lol-perks/v1/pages/${target.id}`);
      const created = await lcu.post('/lol-perks/v1/pages', body);
      return created && created.id;
    }
  };

  if (ours) {
    pageId = await putPage(ours);
  } else {
    let created = null;
    try {
      created = await lcu.post('/lol-perks/v1/pages', body);
    } catch (e) {
      // sem páginas livres: substituir a página atual (ou a primeira editável)
      log.warn('runes', `não foi possível criar página (${(e as Error).message}); a substituir a atual`);
      const target = editable.find((p) => p.current) || editable[0];
      if (!target) throw new Error('err.noRunePage');
      replaced = target.name || null;
      pageId = await putPage(target);
    }
    if (created) pageId = created.id;
  }
  if (pageId) { try { await lcu.put('/lol-perks/v1/currentpage', pageId); } catch { /* já é a atual */ } }
  log.info('runes', `runas importadas (${source}) para ${build.championName}${replaced ? `, substituída a página "${replaced}"` : ''}`);
  return { source, replaced };
}

const DEFAULT_LABELS = { start: 'Início', core: 'Itens principais', forMatch: 'Para esta partida', boots: 'Botas', situational: 'Situacionais', consumables: 'Consumíveis' };

export async function importItemSet(lcu: LcuLike, summonerId: number, build: any, labels: typeof DEFAULT_LABELS = DEFAULT_LABELS): Promise<boolean> {
  if (!build) throw new Error('err.noBuild');
  const p = `/lol-item-sets/v1/item-sets/${summonerId}/sets`;
  const cur = (await lcu.get(p)) || {};
  const title = `LoL Scout ${build.championName}`;
  const sets = (cur.itemSets || []).filter((s: any) => !(s.title === title || (String(s.title || '').startsWith('LoL Scout') && (s.associatedChampions || []).includes(build.championId))));
  const blocks: { type: string; items: { id: string; count: number }[] }[] = [];
  const block = (type: string, ids: number[]) => { if (ids.length) blocks.push({ type, items: ids.map((id) => ({ id: String(id), count: 1 })) }); };
  const pickInfo = (x: any) => `${x.pick}%`;
  block(labels.start, build.details && build.details.starting.length ? build.details.starting.map((x: any) => x.id) : []);
  block(`${labels.core} (${build.core.map(pickInfo).join(' · ')})`, build.core.map((x: any) => x.id));
  if (build.forMatch && build.forMatch.length) block(`${labels.forMatch || DEFAULT_LABELS.forMatch}${build.vs ? ' (vs ' + build.vs.name + ')' : ''}`, build.forMatch.map((x: any) => x.id));
  block(labels.boots, build.boots.map((x: any) => x.id));
  block(labels.situational, build.situational.map((x: any) => x.id));
  block(labels.consumables, [2003, 2055]);
  const skill = build.details && build.details.skillOrder ? ` · ${build.details.skillOrder}` : '';
  sets.unshift({
    title: `${title}${build.vs ? ' vs ' + build.vs.name : ''}${skill}`.slice(0, 75), associatedChampions: [build.championId], associatedMaps: [11], blocks,
    map: 'any', mode: 'any', preferredItemSlots: [], sortrank: 0, startedFrom: 'blank', type: 'custom', uid: globalThis.crypto.randomUUID()
  });
  await lcu.put(p, { ...cur, itemSets: sets, timestamp: Date.now() });
  return true;
}

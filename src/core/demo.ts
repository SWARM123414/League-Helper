// Modo demonstração: simula o cliente do LoL para veres a app sem estar a jogar.
// Arranca com:  npm run demo

export const CHAMPS: [number, string][] = [
  [266, 'Aatrox'], [103, 'Ahri'], [84, 'Akali'], [22, 'Ashe'], [432, 'Bard'], [51, 'Caitlyn'], [122, 'Darius'],
  [81, 'Ezreal'], [114, 'Fiora'], [104, 'Graves'], [39, 'Irelia'], [59, 'Jarvan IV'], [222, 'Jinx'], [145, "Kai'Sa"],
  [64, 'Lee Sin'], [99, 'Lux'], [21, 'Miss Fortune'], [25, 'Morgana'], [111, 'Nautilus'], [157, 'Yasuo'], [238, 'Zed'],
  [412, 'Thresh'], [236, 'Lucian'], [117, 'Lulu'], [92, 'Riven'], [141, 'Kayn'], [245, 'Ekko'], [89, 'Leona'],
  [876, 'Lillia'], [517, 'Sylas'], [360, 'Samira'], [497, 'Rakan'], [498, 'Xayah'], [86, 'Garen'], [24, 'Jax']
];

import { ARCH, CHAMP_ARCH } from './demo-static.ts';
import type { LcuLike } from './lcu.ts';

let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

const ME = 'puuid-me';
const PLAYERS: any[] = [
  // aliados
  { puuid: 'a1', name: 'TopDiffKing', tag: 'EUW', champ: 266, pos: 'TOP', tier: 'GOLD', div: 'I', lp: 67, w: 88, l: 80, lvl: 212, main: 0.3, form: 0.52 },
  { puuid: 'a2', name: 'Selva Escura', tag: 'PT1', champ: 64, pos: 'JUNGLE', tier: 'PLATINUM', div: 'IV', lp: 12, w: 50, l: 41, lvl: 340, main: 0.55, form: 0.6, spells: [11, 4] },
  { puuid: ME, name: 'Alex', tag: 'PT1', champ: 103, pos: 'MIDDLE', tier: 'GOLD', div: 'II', lp: 45, w: 60, l: 55, lvl: 287, main: 0.4, form: 0.55 },
  { puuid: 'a4', name: 'Kaisa Enjoyer', tag: 'EUW', champ: 145, pos: 'BOTTOM', tier: 'GOLD', div: 'III', lp: 20, w: 30, l: 37, lvl: 150, main: 0.7, form: 0.4 },
  { puuid: 'a5', name: 'Pinguim', tag: 'LIS', champ: 412, pos: 'UTILITY', tier: 'SILVER', div: 'I', lp: 88, w: 40, l: 42, lvl: 98, main: 0.2, form: 0.3, streakLoss: 4 },
  // inimigos
  { puuid: 'e1', name: 'Fiora Main', tag: '1v9', champ: 114, pos: 'TOP', tier: 'PLATINUM', div: 'II', lp: 50, w: 120, l: 95, lvl: 410, main: 0.8, form: 0.62 },
  { puuid: 'e2', name: 'GankMachine', tag: 'EUW', champ: 141, pos: 'JUNGLE', tier: 'GOLD', div: 'I', lp: 99, w: 70, l: 70, lvl: 230, main: 0.25, form: 0.5, spells: [11, 4], duo: 'x' },
  { puuid: 'e3', name: 'xYasuox', tag: 'EUW', champ: 157, pos: 'MIDDLE', tier: 'DIAMOND', div: 'IV', lp: 30, w: 25, l: 8, lvl: 38, main: 0.9, form: 0.78, smurf: true, streakWin: 5 },
  { puuid: 'e4', name: 'Bot Gap', tag: 'PT', champ: 51, pos: 'BOTTOM', tier: 'SILVER', div: 'II', lp: 5, w: 33, l: 45, lvl: 120, main: 0, form: 0.3, streakLoss: 3 },
  { puuid: 'e5', name: 'HookCity', tag: 'EUW', champ: 111, pos: 'UTILITY', tier: 'GOLD', div: 'IV', lp: 40, w: 52, l: 50, lvl: 175, main: 0.45, form: 0.5, duo: 'x' }
];

function makeHistory(p: any, sharedIds: number[] | null) {
  const games: any[] = [];
  const now = Date.now();
  for (let i = 0; i < 20; i++) {
    let win = rnd() < p.form;
    if (p.streakLoss && i < p.streakLoss) win = false;
    if (p.streakWin && i < p.streakWin) win = true;
    if (p.streakLoss && i === p.streakLoss) win = true;
    if (p.streakWin && i === p.streakWin) win = false;
    const champ = rnd() < p.main ? p.champ : pick(CHAMPS)[0];
    const k = Math.floor(rnd() * (p.smurf ? 14 : 9));
    const d = Math.floor(rnd() * (p.smurf ? 4 : 9));
    const gameId = sharedIds && i < 6 ? sharedIds[i] : 7000000000 + Math.floor(rnd() * 1e8);
    const ar = ARCH[CHAMP_ARCH[champ] || 'bruiser'];
    const its = [...ar.items].sort(() => rnd() - 0.5).slice(0, 3 + Math.floor(rnd() * 3));
    const itemStats: Record<string, number> = {};
    [...its, ar.boots[0], 3340].forEach((id, k) => { itemStats['item' + k] = id; });
    const perkStats: Record<string, number> = { perkPrimaryStyle: ar.page.primary, perkSubStyle: ar.page.sub };
    ar.page.perks.forEach((id, k) => { perkStats['perk' + k] = id; });
    games.push({
      gameId, gameCreation: now - i * 3600 * 1000 * 5, gameDuration: 1500 + Math.floor(rnd() * 900), queueId: 420, gameMode: 'CLASSIC',
      participants: [{
        participantId: 1, championId: champ, teamId: 100, spell1Id: (p.spells || [4, 14])[0], spell2Id: (p.spells || [4, 14])[1],
        stats: { win, kills: k, deaths: d, assists: Math.floor(rnd() * 12), totalMinionsKilled: 120 + Math.floor(rnd() * 100), neutralMinionsKilled: 0, ...itemStats, ...perkStats },
        timeline: { lane: p.pos === 'UTILITY' ? 'BOTTOM' : p.pos, role: p.pos === 'UTILITY' ? 'DUO_SUPPORT' : 'SOLO' }
      }],
      participantIdentities: [{ participantId: 1, player: { puuid: p.puuid, gameName: p.name, tagLine: p.tag } }]
    });
  }
  return { games: { games } };
}

const duoIds = Array.from({ length: 6 }, (_, i) => 6900000000 + i);
const HIST: Record<string, any> = {};
for (const p of PLAYERS) HIST[p.puuid] = makeHistory(p, p.duo ? duoIds : null);

// ---- ranking Challenger falso, para o motor de builds ----
const HI: Record<string, any> = {};      // puuid -> history
const HI_GAMES: Record<string, any> = {}; // gameId -> {puuid, champ, arch, win}
let hiGame = 8000000000;
for (let n = 0; n < 40; n++) {
  const puuid = `hi-${n}`;
  const pool = [pick(CHAMPS)[0], pick(CHAMPS)[0], 103, 157];
  const games: any[] = [];
  for (let i = 0; i < 20; i++) {
    const champ = pick(pool);
    const archName = CHAMP_ARCH[champ] || 'bruiser';
    const ar = ARCH[archName];
    const win = rnd() < 0.53;
    // variação: às vezes trocam o 3.º item / usam outra página
    const its = [...ar.items.slice(0, 2), ...ar.items.slice(2).sort(() => rnd() - 0.5)].slice(0, 4 + Math.floor(rnd() * 2));
    const boots = ar.boots[rnd() < 0.75 ? 0 : ar.boots.length - 1];
    const stats: Record<string, any> = { win, kills: 6, deaths: 3, assists: 7, totalMinionsKilled: 200, neutralMinionsKilled: 0, perkPrimaryStyle: ar.page.primary, perkSubStyle: ar.page.sub,
      statPerk0: ar.page.shards[0], statPerk1: ar.page.shards[1], statPerk2: ar.page.shards[2] };
    [...its, boots, 3364].forEach((id, k) => { stats['item' + k] = id; });
    const perks = [...ar.page.perks];
    if (rnd() < 0.15 && archName === 'mage') perks[0] = 8128;
    perks.forEach((id, k) => { stats['perk' + k] = id; });
    const gameId = hiGame++;
    HI_GAMES[gameId] = { puuid, champ, arch: archName, its, boots, win };
    const lane = ar.role === 'UTILITY' ? 'BOTTOM' : ar.role;
    const aram = i % 7 === 6;
    games.push({ gameId, gameCreation: Date.now() - i * 7200000, gameDuration: 1700, queueId: aram ? 450 : 420, gameMode: aram ? 'ARAM' : 'CLASSIC',
      gameVersion: i < 14 ? '14.23.636.1234' : '14.22.629.5555',
      participants: [{ participantId: 3, championId: champ, teamId: 100, spell1Id: ar.spells[0], spell2Id: ar.spells[1], stats, timeline: { lane, role: ar.role === 'UTILITY' ? 'DUO_SUPPORT' : 'SOLO' } }],
      participantIdentities: [{ participantId: 3, player: { puuid } }] });
  }
  HI[puuid] = { games: { games } };
}

export class DemoLCU implements LcuLike {
  connected = false;
  customDir: string | null = null;
  creds = null;
  t0 = Date.now();
  perkPages: any[] = [{ id: 1, name: 'Página 1', isDeletable: true, isEditable: true, current: true }];
  pageSeq = 100;
  itemSets: any = { accountId: 1, itemSets: [], timestamp: 0 };
  async connect() { this.connected = true; return true; }
  disconnect() { this.connected = false; }
  elapsed() { return (Date.now() - this.t0) / 1000; }
  phase() {
    const t = this.elapsed();
    if (t < 4) return 'Lobby';
    if (t < 6) return 'ReadyCheck';
    if (t < 20) return 'ChampSelect';
    return 'InProgress';
  }
  async safeGet(p: string, fb: any = null): Promise<any> { try { return await this.get(p); } catch { return fb; } }
  async post(path: string, body?: any): Promise<any> {
    if (path === '/lol-perks/v1/pages') {
      // como no cliente real: erro se não houver páginas livres
      if (this.perkPages.filter((p) => p.isDeletable).length >= 3) { const e: any = new Error('HTTP 400 em /lol-perks/v1/pages — Max pages reached'); e.status = 400; throw e; }
      const page = { id: ++this.pageSeq, isDeletable: true, isEditable: true, ...body };
      this.perkPages.forEach((p) => { p.current = false; });
      this.perkPages.push(page);
      return page;
    }
    return {};
  }
  async put(path: string, body?: any): Promise<any> {
    if (path.includes('/lol-item-sets/')) this.itemSets = body;
    const m = /^\/lol-perks\/v1\/pages\/(\d+)$/.exec(path);
    if (m) { const i = this.perkPages.findIndex((p) => p.id === Number(m[1])); if (i >= 0) this.perkPages[i] = { ...this.perkPages[i], ...body }; }
    if (path === '/lol-perks/v1/currentpage') this.perkPages.forEach((p) => { p.current = p.id === body; });
    return {};
  }
  async del(path: string): Promise<any> { const id = Number(path.split('/').pop()); this.perkPages = this.perkPages.filter((p) => p.id !== id); return {}; }
  async get(path: string): Promise<any> {
    const P = (id) => PLAYERS.find((x) => x.puuid === id);
    if (path === '/lol-summoner/v1/current-summoner') return { puuid: ME, gameName: 'Alex', tagLine: 'PT1', summonerLevel: 287, profileIconId: 29, summonerId: 1 };
    if (path === '/riotclient/region-locale') return { region: 'EUW', webRegion: 'euw' };
    if (path === '/lol-game-data/assets/v1/champion-summary.json') return CHAMPS.map(([id, name]) => ({ id, name, alias: name.replace(/[^A-Za-z]/g, '') }));
    if (path === '/lol-gameflow/v1/gameflow-phase') return this.phase();
    if (path === '/lol-matchmaking/v1/ready-check') return { state: 'InProgress', playerResponse: 'None' };
    if (path === '/lol-end-of-game/v1/eog-stats-block') throw new Error('404');
    if (path === '/lol-perks/v1/pages') return this.perkPages;
    if (path === '/lol-perks/v1/inventory') return { ownedPageCount: 3 };
    if (path.startsWith('/lol-perks/v1/recommended-pages/champion/')) {
      return [{ primaryPerkStyleId: 8000, secondaryPerkStyleId: 8400, perks: [8010, 9111, 9104, 8299, 8444, 8451, 5005, 5008, 5011].map((id) => ({ id })) }];
    }
    if (path.startsWith('/lol-item-sets/')) return this.itemSets;
    if (path === '/lol-ranked/v1/apex-leagues/RANKED_SOLO_5x5/CHALLENGER') return { divisions: [{ standings: Object.keys(HI).map((puuid, i) => ({ puuid, leaguePoints: 1500 - i * 10 })) }] };
    if (path.startsWith('/lol-ranked/v1/apex-leagues/')) return { divisions: [] };
    let hm = /^\/lol-match-history\/v1\/products\/lol\/(hi-\d+)\/matches/.exec(path);
    if (hm) return HI[hm[1]];
    hm = /^\/lol-match-history\/v1\/games\/(\d+)$/.exec(path);
    if (hm && HI_GAMES[hm[1]]) {
      const g = HI_GAMES[hm[1]];
      return { gameId: Number(hm[1]), participants: [{ participantId: 1, championId: 1 }, { participantId: 3, championId: g.champ }],
        participantIdentities: [{ participantId: 1, player: { puuid: 'outro' } }, { participantId: 3, player: { puuid: g.puuid } }] };
    }
    hm = /^\/lol-match-history\/v1\/game-timelines\/(\d+)$/.exec(path);
    if (hm && HI_GAMES[hm[1]]) {
      const g = HI_GAMES[hm[1]];
      const ar = ARCH[g.arch];
      const ev: any[] = [];
      ar.start.forEach((id) => ev.push({ type: 'ITEM_PURCHASED', participantId: 3, itemId: id, timestamp: 15000 }));
      ev.push({ type: 'ITEM_PURCHASED', participantId: 3, itemId: 3340, timestamp: 15000 });
      ev.push({ type: 'ITEM_PURCHASED', participantId: 1, itemId: 3157, timestamp: 16000 });
      g.its.forEach((id, k) => ev.push({ type: 'ITEM_PURCHASED', participantId: 3, itemId: id, timestamp: 400000 + k * 300000 }));
      ev.push({ type: 'ITEM_PURCHASED', participantId: 3, itemId: g.boots, timestamp: 500000 });
      [...ar.skills].forEach((k, i) => ev.push({ type: 'SKILL_LEVEL_UP', participantId: 3, skillSlot: { Q: 1, W: 2, E: 3, R: 4 }[k], levelUpType: 'NORMAL', timestamp: 60000 + i * 90000 }));
      return { frames: [{ events: ev.slice(0, 8) }, { events: ev.slice(8) }] };
    }
    let m = /^\/lol-summoner\/v2\/summoners\/puuid\/(.+)$/.exec(path);
    if (m) { const p = P(m[1]); return { puuid: p.puuid, gameName: p.name, tagLine: p.tag, summonerLevel: p.lvl, profileIconId: 1 + (p.lvl % 28) }; }
    m = /^\/lol-ranked\/v1\/ranked-stats\/(.+)$/.exec(path);
    if (m) { const p = P(m[1]); return { queueMap: { RANKED_SOLO_5x5: { tier: p.tier, division: p.div, leaguePoints: p.lp, wins: p.w, losses: p.l, previousSeasonEndTier: p.tier } } }; }
    m = /^\/lol-match-history\/v1\/products\/lol\/([^/]+)\/matches/.exec(path);
    if (m) return HIST[m[1]];
    m = /^\/lol-match-history\/v1\/games\/(\d+)$/.exec(path);
    if (m) {
      const ps = PLAYERS.map((p, i) => ({ participantId: i + 1, teamId: i < 5 ? 100 : 200, championId: p.champ, stats: { win: i < 5, kills: Math.floor(rnd() * 10), deaths: Math.floor(rnd() * 8), assists: Math.floor(rnd() * 12), totalMinionsKilled: 150, neutralMinionsKilled: 10, totalDamageDealtToChampions: 15000 + Math.floor(rnd() * 15000), goldEarned: 11000, visionScore: 20, item0: 3089, item1: 3020, item2: 3157 } }));
      return { gameId: Number(m[1]), gameDuration: 1800, queueId: 420, gameCreation: Date.now() - 3600000, participants: ps, participantIdentities: PLAYERS.map((p, i) => ({ participantId: i + 1, player: { puuid: p.puuid, gameName: p.name, tagLine: p.tag } })) };
    }
    if (path === '/lol-champ-select/v1/session') {
      const t = this.elapsed();
      const allies = PLAYERS.slice(0, 5);
      const enemies = PLAYERS.slice(5);
      return {
        localPlayerCellId: 2,
        timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: Math.max(0, (20 - t) * 1000) },
        myTeam: allies.map((p, i) => ({ cellId: i, championId: t > 8 + i * 2 ? p.champ : 0, championPickIntent: p.champ, assignedPosition: p.pos.toLowerCase().replace('middle', 'middle'), puuid: p.puuid === ME ? ME : '', gameName: p.puuid === ME ? 'Alex' : '' })),
        theirTeam: enemies.map((p, i) => ({ cellId: 5 + i, championId: t > 9 + i * 2 ? p.champ : 0, assignedPosition: '' })),
        actions: [[
          { type: 'ban', completed: true, actorCellId: 0, championId: 238 },
          { type: 'ban', completed: true, actorCellId: 1, championId: 360 },
          { type: 'ban', completed: true, actorCellId: 5, championId: 222 },
          { type: 'ban', completed: true, actorCellId: 6, championId: 517 }
        ]]
      };
    }
    if (path === '/lol-gameflow/v1/session') {
      const ent = (p) => ({ puuid: p.puuid, championId: p.champ, selectedPosition: p.pos, gameName: p.name, tagLine: p.tag, summonerId: p.puuid === ME ? 1 : 0 });
      return {
        gameData: {
          gameId: 7123456789, queue: { id: 420, mapId: 11, description: 'Ranked Solo/Duo' },
          teamOne: PLAYERS.slice(0, 5).map(ent), teamTwo: PLAYERS.slice(5).map(ent),
          playerChampionSelections: PLAYERS.map((p) => ({ puuid: p.puuid, championId: p.champ, spell1Id: (p.spells || [4, 14])[0], spell2Id: (p.spells || [4, 14])[1] }))
        }
      };
    }
    throw new Error('404 ' + path);
  }
}

export function demoLive(lcu: DemoLCU) {
  return async () => {
    const t = lcu.elapsed() - 20;
    if (t < 0) return null;
    const gt = 60 + t * 10;
    return {
      activePlayer: { riotId: 'Alex#PT1' },
      gameData: { gameTime: gt, gameMode: 'CLASSIC' },
      allPlayers: PLAYERS.map((p, i) => ({
        riotId: `${p.name}#${p.tag}`, riotIdGameName: p.name, riotIdTagLine: p.tag, team: i < 5 ? 'ORDER' : 'CHAOS', position: p.pos,
        level: Math.min(18, 1 + Math.floor(gt / 90)), isDead: i === 8 && Math.floor(gt) % 60 < 15, respawnTimer: 12,
        scores: { kills: Math.floor((gt / 300) * (i % 3 + (p.smurf ? 2 : 0))), deaths: Math.floor((gt / 400) * ((i + 1) % 3)), assists: Math.floor((gt / 200) * (i % 4)), creepScore: Math.floor(gt / 10) },
        items: gt > 300 ? [{ itemID: 1055, displayName: 'Doran' }, { itemID: 3006, displayName: 'Botas' }] : [{ itemID: 1055, displayName: 'Doran' }]
      }))
    };
  };
}

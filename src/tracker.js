// Cérebro da app: segue o estado do cliente (lobby, seleção de campeões, jogo,
// fim de jogo), vai buscar os dados de cada jogador e monta o "estado" que a
// interface mostra.

const { EventEmitter } = require('events');
const A = require('./analyzer');
const { matchTips } = require('./gamedata');
const I18N = require('../renderer/i18n');
const log = require('./log');
const { importRunes, importItemSet } = require('./builds');

const POS_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const IN_GAME = new Set(['GameStart', 'InProgress', 'Reconnect']);
const POST_GAME = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame']);
const CACHE_MS = 10 * 60 * 1000;
const SMITE = 11;

function modeRole(queueId) {
  if (queueId === 450 || queueId === 720) return 'ARAM';
  if (queueId === 1700 || queueId === 1710) return 'ARENA';
  return null;
}

function normPos(p) {
  const v = String(p || '').toUpperCase();
  if (v === 'MID') return 'MIDDLE';
  if (v === 'BOT' || v === 'ADC') return 'BOTTOM';
  if (v === 'SUPPORT' || v === 'SUP') return 'UTILITY';
  return POS_ORDER.includes(v) ? v : null;
}

class Tracker extends EventEmitter {
  constructor({ lcu, live, store, gamedata = null, builds = null, interval = 2000 }) {
    super();
    this.gd = gamedata;
    this.builds = builds;
    this.detailsLoading = new Set();
    this.imported = new Set();
    if (builds) builds.shouldPause = () => ['ChampSelect', 'GameStart', 'InProgress', 'Reconnect'].includes(this.state.phase);
    this.lcu = lcu;
    this.live = live;
    this.store = store;
    this.interval = interval;
    this.raw = new Map();      // puuid -> { at, promise }
    this.analysis = new Map(); // `${puuid}:${champ}` -> resultado
    this.pending = new Set();
    this.champs = {};
    this.state = { status: 'searching', phase: null, me: null, region: null, view: 'idle' };
    this.lastGame = null;
    this.notifiedGame = null;
    this.recordedGame = null;
    this.acceptedReadyCheck = false;
    this.ticking = false;
  }

  start() {
    const loop = async () => {
      if (!this.ticking) {
        this.ticking = true;
        try { await this.tick(); } catch (e) { this.state.error = String(e.message || e); }
        this.ticking = false;
        this.emit('state', this.state);
      }
      this.timer = setTimeout(loop, this.interval);
    };
    loop();
  }

  stop() { clearTimeout(this.timer); }

  champName(id) {
    // nomes no idioma da app (Data Dragon); se ainda não carregou, os do cliente
    const c = this.gd && this.gd.ready && this.gd.champ(id);
    if (c) return c.name;
    if (this.champs[id]) return this.champs[id].name;
    return id ? `#${id}` : '?';
  }

  // Build recomendada (alto elo) para um campeão/posição; carrega detalhes em segundo plano
  buildFor(champId, position, ctx = null) {
    if (!this.builds || !champId) return null;
    let b = this.builds.getBuild(champId, position);
    if (b && !b.details) {
      const key = `${champId}:${b.role}`;
      if (!this.detailsLoading.has(key)) {
        this.detailsLoading.add(key);
        this.builds.loadDetails(champId, position).catch(() => {}).finally(() => this.emit('state', this.state));
      }
    }
    if (b && ctx) b = this.builds.matchupBuild(b, ctx);
    if (b) { this.currentBuilds = this.currentBuilds || new Map(); this.currentBuilds.set(Number(champId), b); }
    return b;
  }

  // contexto para a build contra: composição inimiga + adversário de lane
  matchupCtx(meChamp, oppChamp, enemyIds) {
    if (!this.gd || !this.gd.ready) return null;
    const enemyComp = this.gd.composition(enemyIds.filter(Boolean));
    const opp = oppChamp ? { championId: oppChamp, name: this.champName(oppChamp), damageType: this.gd.damageType(oppChamp), ranged: this.gd.isRanged(oppChamp) } : null;
    return { enemyComp, opp, meRanged: this.gd.isRanged(meChamp) };
  }

  async importBuild(champId, position, what = 'both') {
    const cur = this.currentBuilds && this.currentBuilds.get(Number(champId));
    const b = cur || (this.builds && this.builds.getBuild(champId, position));
    if (!b) throw new Error('err.noBuild');
    const done = [];
    const lang = this.store.settings.lang || 'pt';
    let runeInfo = null;
    if (what === 'both' || what === 'runes') { runeInfo = await importRunes(this.lcu, b, { gd: this.gd, position }); done.push('runes'); }
    if (what === 'both' || what === 'items') {
      const me = this.state.me || (await this.lcu.get('/lol-summoner/v1/current-summoner'));
      const L = (k) => I18N.t(lang, k);
      await importItemSet(this.lcu, me.summonerId, b, { start: L('b.start'), core: L('b.core'), forMatch: L('mu.forMatch'), boots: L('b.boots'), situational: L('b.situational'), consumables: L('b.consumables') });
      done.push('items');
    }
    return { key: 'imp.done', what: done, champ: b.championName, runeSource: runeInfo && runeInfo.source, replaced: runeInfo && runeInfo.replaced };
  }

  composition(enemyIds, allyIds) {
    if (!this.gd || !this.gd.ready) return null;
    const enemy = this.gd.composition(enemyIds.filter(Boolean));
    const ally = this.gd.composition(allyIds.filter(Boolean));
    return { enemy, ally, tips: matchTips(enemy, ally) };
  }

  async onConnect() {
    const me = await this.lcu.get('/lol-summoner/v1/current-summoner');
    const region = await this.lcu.safeGet('/riotclient/region-locale', {});
    const champs = await this.lcu.safeGet('/lol-game-data/assets/v1/champion-summary.json', []);
    this.champs = {};
    for (const c of champs || []) if (c.id > 0) this.champs[c.id] = { name: c.name, alias: c.alias };
    this.state.me = {
      puuid: me.puuid, name: me.gameName || me.displayName, tag: me.tagLine,
      level: me.summonerLevel, iconId: me.profileIconId, summonerId: me.summonerId
    };
    this.state.region = (region && (region.webRegion || region.region)) || null;
    this.state.champions = this.champs;
    this.backfillResults().then(() => this.backfillMatchups()).catch(() => {});
    if (this.gd) this.gd.load().then(() => this.emit('state', this.state)).catch(() => {});
    if (this.builds && this.store.settings.collectBuilds !== false && this.builds.isStale()) {
      this.builds.collect({ maxPlayers: this.store.settings.buildPlayers || 150 }).catch(() => {});
    }
  }

  // Preenche resultados de jogos antigos (para "já jogaste com/contra X")
  async backfillResults() {
    const me = this.state.me;
    if (!me) return;
    const h = await this.lcu.safeGet(`/lol-match-history/v1/products/lol/${me.puuid}/matches?begIndex=0&endIndex=49`);
    for (const g of A.normalizeGames(h, me.puuid)) {
      if (!this.store.data.results[g.gameId] || this.store.data.results[g.gameId].win === undefined) {
        this.store.recordResult(g.gameId, { win: g.win, date: g.date, championId: g.championId, queueId: g.queueId });
      }
    }
  }

  // Vê os teus últimos jogos para saber contra que campeões jogaste (e na tua lane)
  async backfillMatchups(limit = 20) {
    const me = this.state.me;
    if (!me) return;
    const h = await this.lcu.safeGet(`/lol-match-history/v1/products/lol/${me.puuid}/matches?begIndex=0&endIndex=${limit - 1}`);
    const laneOf = (p) => A.roleOf({ lane: p.timeline && p.timeline.lane, role: p.timeline && p.timeline.role, spells: [p.spell1Id, p.spell2Id] });
    for (const g of A.normalizeGames(h, me.puuid)) {
      if (g.remake || this.store.hasGame(g.gameId)) continue;
      const d = await this.lcu.safeGet(`/lol-match-history/v1/games/${g.gameId}`);
      if (!d || !d.participants) continue;
      const ident = (d.participantIdentities || []).find((i) => i.player && i.player.puuid === me.puuid);
      const mine = ident && d.participants.find((p) => p.participantId === ident.participantId);
      if (!mine) continue;
      const enemies = d.participants.filter((p) => p.teamId !== mine.teamId);
      const allies = d.participants.filter((p) => p.teamId === mine.teamId && p !== mine);
      const myLane = laneOf(mine);
      const opp = myLane ? enemies.find((e) => laneOf(e) === myLane) : null;
      this.store.recordGame(g.gameId, {
        myChamp: mine.championId, enemies: enemies.map((p) => p.championId), allies: allies.map((p) => p.championId), laneOpp: opp ? opp.championId : null
      });
      if (!this.store.data.results[g.gameId]) this.store.recordResult(g.gameId, { win: g.win, date: g.date, championId: g.championId, queueId: g.queueId });
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Perfil completo de um jogador (substitui o op.gg)
  async playerProfile(puuid) {
    if (!puuid) return null;
    const raw = await this.fetchRaw(puuid);
    const isCompleted = this.gd && this.gd.ready ? (id) => this.gd.isCompleted(id) : null;
    const a = A.analyzePlayer({ puuid, ...raw, champName: (id) => this.champName(id), isCompleted });
    const games = A.normalizeGames(raw.history, puuid).map((g) => ({ ...g, championName: this.champName(g.championId), kda: A.kda(g.kills, g.deaths, g.assists) }));
    const real = games.filter((g) => !g.remake);
    const byChamp = {};
    for (const g of real) (byChamp[g.championId] = byChamp[g.championId] || []).push(g);
    const champs = Object.entries(byChamp).map(([id, gs]) => ({ championId: Number(id), name: this.champName(Number(id)), ...A.aggregate(gs) }))
      .sort((x, y) => y.games - x.games).slice(0, 8);
    const sm = raw.summoner || {};
    return {
      puuid, name: sm.gameName || a.name, tag: sm.tagLine || a.tag, level: sm.summonerLevel, iconId: sm.profileIconId,
      rank: a.rank, recent: a.recent, streak: a.streak, mainRole: a.mainRole, tags: a.tags, champs, games,
      encounter: this.store.history(puuid), isMe: this.state.me && this.state.me.puuid === puuid
    };
  }

  // Testa as partes do cliente que a app usa (para o ecrã de diagnóstico)
  async diagnose() {
    const out = [];
    const check = async (name, fn) => {
      try { const detail = await fn(); out.push({ name, ok: true, detail: detail || '' }); } catch (e) { out.push({ name, ok: false, detail: String(e.message || e) }); }
    };
    await check('client', async () => {
      if (!this.lcu.connected && !(await this.lcu.connect())) throw new Error('cliente não encontrado');
      return `porta ${this.lcu.creds ? this.lcu.creds.port : '?'}`;
    });
    if (!this.lcu.connected) return out;
    const me = await this.lcu.get('/lol-summoner/v1/current-summoner').catch(() => null);
    await check('summoner', async () => { if (!me || !me.puuid) throw new Error('sem invocador'); return `nível ${me.summonerLevel}`; });
    await check('phase', async () => this.lcu.get('/lol-gameflow/v1/gameflow-phase'));
    await check('ranked', async () => { const r = await this.lcu.get(`/lol-ranked/v1/ranked-stats/${me.puuid}`); return Object.keys(r.queueMap || {}).join(', ') || 'vazio'; });
    await check('history', async () => {
      const h = await this.lcu.get(`/lol-match-history/v1/products/lol/${me.puuid}/matches?begIndex=0&endIndex=4`);
      const g = A.normalizeGames(h, me.puuid);
      if (!g.length) throw new Error('0 jogos');
      return `${g.length} jogos · itens ${g[0].items.length} · runas ${g[0].perks.length} · patch ${g[0].patch || '?'}`;
    });
    await check('ladder', async () => {
      const lad = await this.lcu.get('/lol-ranked/v1/apex-leagues/RANKED_SOLO_5x5/CHALLENGER');
      const st = (lad.divisions || []).flatMap((d) => d.standings || []);
      const withPuuid = st.filter((x) => x.puuid).length;
      if (!withPuuid) throw new Error(`${st.length} jogadores, nenhum com puuid`);
      return `${withPuuid} jogadores`;
    });
    await check('timeline', async () => {
      const h = await this.lcu.get(`/lol-match-history/v1/products/lol/${me.puuid}/matches?begIndex=0&endIndex=0`);
      const g = A.normalizeGames(h, me.puuid)[0];
      if (!g) throw new Error('sem jogos');
      const tl = await this.lcu.get(`/lol-match-history/v1/game-timelines/${g.gameId}`);
      const ev = (tl.frames || []).flatMap((f) => f.events || []);
      return `${(tl.frames || []).length} frames · ${ev.filter((e) => e.type === 'ITEM_PURCHASED').length} compras · ${ev.filter((e) => e.type === 'SKILL_LEVEL_UP').length} skills`;
    });
    await check('runePages', async () => {
      const pages = await this.lcu.get('/lol-perks/v1/pages');
      const inv = await this.lcu.safeGet('/lol-perks/v1/inventory', {});
      const ed = pages.filter((p) => p.isEditable !== false && p.isDeletable !== false && !p.isTemporary).length;
      return `${pages.length} páginas · ${ed} editáveis · máx ${inv.ownedPageCount ?? '?'}`;
    });
    await check('itemSets', async () => { const r = await this.lcu.get(`/lol-item-sets/v1/item-sets/${me.summonerId}/sets`); return `${(r.itemSets || []).length} conjuntos`; });
    await check('gameData', async () => { if (!this.gd) return 'n/a'; await this.gd.load(); if (!this.gd.ready) throw new Error('sem internet / Data Dragon'); return `versão ${this.gd.version} · ${this.gd.lang}`; });
    await check('builds', async () => {
      if (!this.builds) return 'n/a';
      const i = this.builds.info();
      if (i.error) throw new Error(i.error);
      return `${i.games} jogos · ${i.champions} campeões · patch ${i.patch || '?'}`;
    });
    await check('liveClient', async () => { const l = await this.live(); return l ? `em jogo (${Math.round(l.gameData.gameTime)}s)` : 'fora de jogo'; });
    return out;
  }

  async tick() {
    if (!this.lcu.connected) {
      this.state.status = 'searching';
      this.lcu.customDir = this.store.settings.leagueDir || null;
      const ok = await this.lcu.connect();
      if (!ok) { this.state.view = 'idle'; return; }
      await this.onConnect();
    }
    this.state.status = 'connected';
    let phase;
    try { phase = await this.lcu.get('/lol-gameflow/v1/gameflow-phase'); } catch (e) {
      if (!this.lcu.connected) { this.state.status = 'searching'; this.state.me = null; }
      return;
    }
    this.state.phase = phase;
    this.state.error = null;

    if (phase === 'ReadyCheck') await this.handleReadyCheck();
    else this.acceptedReadyCheck = false;

    if (phase !== 'ChampSelect') this.lastImportMsg = null;
    // modo de jogo (ARAM/Arena têm builds próprias) — lido uma vez ao entrar na seleção
    if (phase === 'ChampSelect' && this.lastPhase !== 'ChampSelect') {
      const gs = await this.lcu.safeGet('/lol-gameflow/v1/session');
      this.csQueueId = gs && gs.gameData && gs.gameData.queue ? gs.gameData.queue.id : null;
    }
    this.lastPhase = phase;
    if (phase === 'ChampSelect') {
      this.state.view = 'champselect';
      this.state.champSelect = await this.buildChampSelect();
    } else if (IN_GAME.has(phase)) {
      this.state.view = 'game';
      this.state.game = await this.buildGame();
      this.lastGame = this.state.game;
    } else if (POST_GAME.has(phase)) {
      this.state.view = this.lastGame ? 'postgame' : 'idle';
      await this.handleEndOfGame();
      this.state.game = this.lastGame;
    } else {
      this.state.view = this.lastGame ? 'postgame' : 'idle';
      this.state.game = this.lastGame;
    }
  }

  async handleReadyCheck() {
    if (!this.store.settings.autoAccept || this.acceptedReadyCheck) return;
    const rc = await this.lcu.safeGet('/lol-matchmaking/v1/ready-check');
    if (rc && rc.state === 'InProgress' && rc.playerResponse === 'None') {
      try { await this.lcu.post('/lol-matchmaking/v1/ready-check/accept'); this.acceptedReadyCheck = true; this.emit('notify', { title: { key: 'notif.accepted.t' }, lines: [{ key: 'notif.accepted.b' }] }); } catch { /* tenta no próximo tick */ }
    }
  }

  async handleEndOfGame() {
    const eog = await this.lcu.safeGet('/lol-end-of-game/v1/eog-stats-block');
    if (!eog || !eog.gameId) return;
    const myTeam = (eog.teams || []).find((t) => t.isPlayerTeam);
    let win = myTeam ? !!myTeam.isWinningTeam : undefined;
    if (win === undefined && eog.localPlayer && eog.localPlayer.stats) win = eog.localPlayer.stats.WIN === 1;
    if (win === undefined) return;
    this.store.recordResult(eog.gameId, { win, date: Date.now(), championId: eog.localPlayer && eog.localPlayer.championId, queueId: eog.queueId });
    if (this.lastGame && this.lastGame.gameId === eog.gameId) this.lastGame.result = win ? 'win' : 'loss';
  }

  // ---------- dados dos jogadores ----------

  fetchRaw(puuid) {
    const c = this.raw.get(puuid);
    if (c && Date.now() - c.at < CACHE_MS) return c.promise;
    const n = Math.max(5, Math.min(this.store.settings.historyCount || 20, 50));
    const promise = Promise.all([
      this.lcu.safeGet(`/lol-summoner/v2/summoners/puuid/${puuid}`, {}),
      this.lcu.safeGet(`/lol-ranked/v1/ranked-stats/${puuid}`, null),
      this.lcu.safeGet(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=${n - 1}`, null)
    ]).then(([summoner, ranked, history]) => ({ summoner, ranked, history }));
    this.raw.set(puuid, { at: Date.now(), promise });
    promise.catch(() => this.raw.delete(puuid));
    return promise;
  }

  // Devolve a análise se já existir; senão começa a carregar e devolve null.
  getAnalysis(puuid, championId) {
    if (!puuid) return null;
    const key = `${puuid}:${championId || 0}`;
    if (this.analysis.has(key)) return this.analysis.get(key);
    if (!this.pending.has(key)) {
      this.pending.add(key);
      this.fetchRaw(puuid).then((raw) => {
        const isCompleted = this.gd && this.gd.ready ? (id) => this.gd.isCompleted(id) : null;
        this.analysis.set(key, A.analyzePlayer({ puuid, ...raw, championId, champName: (id) => this.champName(id), isCompleted }));
      }).catch(() => {
        // Sem dados: guardar uma análise vazia para não ficar a carregar para sempre
        this.analysis.set(key, A.analyzePlayer({ puuid, championId, champName: (id) => this.champName(id) }));
      }).finally(() => {
        this.pending.delete(key);
        this.emit('state', this.state);
      });
    }
    return null;
  }

  async lookupRiotId(riotId) {
    if (!riotId || !riotId.includes('#')) return null;
    this.riotIdCache = this.riotIdCache || new Map();
    if (this.riotIdCache.has(riotId)) return this.riotIdCache.get(riotId);
    const [gameName, tagLine] = riotId.split('#');
    const r = await this.lcu.safeGet(`/lol-summoner/v1/alias/lookup?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`)
      || await this.lcu.safeGet(`/lol-summoner/v1/summoners?name=${encodeURIComponent(riotId)}`);
    const puuid = r && r.puuid ? r.puuid : null;
    this.riotIdCache.set(riotId, puuid);
    return puuid;
  }

  // ---------- seleção de campeões ----------

  async buildChampSelect() {
    const s = await this.lcu.safeGet('/lol-champ-select/v1/session');
    if (!s) return null;
    const myCells = new Set((s.myTeam || []).map((p) => p.cellId));
    const bans = { mine: [], theirs: [] };
    for (const group of s.actions || []) {
      for (const a of group) {
        if (a.type === 'ban' && a.completed && a.championId > 0) {
          (myCells.has(a.actorCellId) ? bans.mine : bans.theirs).push({ id: a.championId, name: this.champName(a.championId) });
        }
      }
    }
    if (!bans.mine.length && s.bans) {
      bans.mine = (s.bans.myTeamBans || []).filter((x) => x > 0).map((id) => ({ id, name: this.champName(id) }));
      bans.theirs = (s.bans.theirTeamBans || []).filter((x) => x > 0).map((id) => ({ id, name: this.champName(id) }));
    }

    const mapPlayer = (p, mine) => {
      const champ = p.championId || p.championPickIntent || 0;
      const isMe = mine && p.cellId === s.localPlayerCellId;
      const puuid = p.puuid || (isMe && this.state.me ? this.state.me.puuid : null);
      const name = p.gameName || (isMe && this.state.me ? this.state.me.name : null);
      const analysis = mine && puuid ? this.getAnalysis(puuid, champ) : null;
      return {
        cellId: p.cellId, isMe, puuid, name, tag: p.tagLine || null,
        championId: champ, championName: champ ? this.champName(champ) : null,
        hovering: !p.championId && !!p.championPickIntent,
        position: normPos(p.assignedPosition),
        analysis,
        encounter: puuid && !isMe ? this.store.history(puuid) : null
      };
    };
    const allies = (s.myTeam || []).map((p) => mapPlayer(p, true));
    const enemies = (s.theirTeam || []).map((p) => mapPlayer(p, false));
    const me = allies.find((p) => p.isMe);
    for (const e of enemies) if (e.championId) e.vsRecord = this.store.vsRecord(e.championId, me ? me.championId : null);
    // provável adversário de lane: o inimigo cuja posição habitual (alto elo) é a tua
    let likelyOpp = null;
    if (me && me.position && this.builds) {
      const cands = enemies.filter((e) => e.championId).map((e) => {
        const roles = this.builds.rolesFor(e.championId);
        const total = roles.reduce((t, r) => t + r.games, 0);
        const mine = roles.find((r) => r.role === me.position);
        return { e, share: total ? (mine ? mine.games : 0) / total : 0, main: roles[0] && roles[0].role };
      }).filter((c) => c.main === me.position || c.share >= 0.4).sort((x, y) => y.share - x.share);
      if (cands.length) { likelyOpp = cands[0].e; likelyOpp.likelyLane = true; }
    }
    const myLocked = me && me.championId && !me.hovering;
    const mode = modeRole(this.csQueueId);
    if (mode && likelyOpp) { likelyOpp.likelyLane = false; likelyOpp = null; }
    const ctx = me && me.championId ? this.matchupCtx(me.championId, likelyOpp ? likelyOpp.championId : null, enemies.map((p) => p.championId)) : null;
    const myBuild = me && me.championId ? this.buildFor(me.championId, mode || me.position, ctx) : null;
    let importMsg = this.lastImportMsg || null;
    if (myLocked && myBuild && this.store.settings.autoImport) {
      const key = `${s.gameId || 'cs'}:${me.championId}`;
      if (!this.imported.has(key)) {
        this.imported.add(key);
        this.importBuild(me.championId, me.position).then((m) => { this.lastImportMsg = { ok: true, ...m }; }).catch((e) => { log.error('import', e.message); this.lastImportMsg = { ok: false, err: String(e.message || e) }; })
          .finally(() => this.emit('state', this.state));
      }
    }
    return {
      myBuild,
      importMsg,
      comp: this.composition(enemies.map((p) => p.championId), allies.map((p) => p.championId)),
      timer: s.timer ? { phase: s.timer.phase, left: Math.max(0, Math.round((s.timer.adjustedTimeLeftInPhase || 0) / 1000)) } : null,
      myPosition: me ? me.position : null,
      myChampion: me ? me.championId : null,
      allies, enemies, bans,
      namesHidden: allies.filter((p) => !p.isMe).every((p) => !p.name)
    };
  }

  // ---------- jogo em curso ----------

  async buildGame() {
    const [gs, live] = await Promise.all([this.lcu.safeGet('/lol-gameflow/v1/session'), this.live()]);
    const gd = (gs && gs.gameData) || {};
    const me = this.state.me || {};
    const selections = gd.playerChampionSelections || [];
    const livePlayers = (live && live.allPlayers) || [];

    let teamA = gd.teamOne || [];
    let teamB = gd.teamTwo || [];

    const toPlayer = (p) => {
      const sel = selections.find((x) => (x.puuid && x.puuid === p.puuid) || (x.summonerInternalName && x.summonerInternalName === p.summonerInternalName)) || {};
      const name = p.gameName || p.summonerName || null;
      return {
        puuid: p.puuid || null,
        name, tag: p.tagLine || null,
        championId: p.championId || sel.championId || 0,
        spells: [sel.spell1Id || p.spell1Id, sel.spell2Id || p.spell2Id].filter(Boolean),
        position: normPos(p.selectedPosition)
      };
    };

    let allies, enemies;
    if (teamA.length || teamB.length) {
      const inA = teamA.some((p) => p.puuid === me.puuid || (me.summonerId && p.summonerId === me.summonerId));
      allies = (inA ? teamA : teamB).map(toPlayer);
      enemies = (inA ? teamB : teamA).map(toPlayer);
    } else if (livePlayers.length) {
      // Sem dados do gameflow: usar a API do jogo e procurar os puuids pelo Riot ID
      const myRiot = live.activePlayer ? live.activePlayer.riotId : null;
      const mine = livePlayers.find((p) => p.riotId === myRiot);
      const myTeam = mine ? mine.team : 'ORDER';
      const conv = async (lp) => ({
        puuid: await this.lookupRiotId(lp.riotId), name: lp.riotIdGameName || (lp.riotId || '').split('#')[0], tag: lp.riotIdTagLine || null,
        championId: Number(Object.keys(this.champs).find((id) => this.champs[id].name === lp.championName)) || 0,
        spells: [], position: normPos(lp.position)
      });
      allies = await Promise.all(livePlayers.filter((p) => p.team === myTeam).map(conv));
      enemies = await Promise.all(livePlayers.filter((p) => p.team !== myTeam).map(conv));
    } else {
      return { gameId: gd.gameId || null, loading: true, allies: [], enemies: [] };
    }

    const gameId = gd.gameId || (live && live.gameData ? `live-${Math.round(Date.now() / 3600000)}` : null);

    // Juntar estatísticas ao vivo (KDA, nível, itens)
    const liveFor = (p) => {
      const lp = livePlayers.find((x) => (x.riotIdGameName && x.riotIdGameName === p.name) || (x.riotId && p.name && x.riotId.split('#')[0] === p.name) || x.summonerName === p.name);
      if (!lp) return null;
      if (!p.position) p.position = normPos(lp.position);
      return {
        level: lp.level, isDead: lp.isDead, respawn: Math.round(lp.respawnTimer || 0),
        k: lp.scores ? lp.scores.kills : 0, d: lp.scores ? lp.scores.deaths : 0, a: lp.scores ? lp.scores.assists : 0,
        cs: lp.scores ? lp.scores.creepScore : 0,
        items: (lp.items || []).map((i) => ({ id: i.itemID, name: i.displayName }))
      };
    };

    let loaded = 0;
    const enrich = (p, ally) => {
      const isMe = p.puuid && p.puuid === me.puuid;
      const analysis = this.getAnalysis(p.puuid, p.championId);
      if (analysis || !p.puuid) loaded++;
      if (!p.position && p.spells.includes(SMITE)) p.position = 'JUNGLE';
      return {
        ...p, ally, isMe,
        championName: this.champName(p.championId),
        analysis,
        threat: analysis ? A.threatScore(analysis) : null,
        encounter: p.puuid && !isMe ? this.store.history(p.puuid, gameId) : null,
        live: liveFor(p)
      };
    };
    allies = allies.map((p) => enrich(p, true));
    enemies = enemies.map((p) => enrich(p, false));

    // Ordenar por posição para alinhar adversários de lane
    const ord = (p) => (p.position ? POS_ORDER.indexOf(p.position) : 9);
    allies.sort((a, b) => ord(a) - ord(b));
    enemies.sort((a, b) => ord(a) - ord(b));

    // Duos / premades
    const markPremades = (team, label) => {
      const withData = team.filter((p) => p.analysis);
      const groups = A.detectPremades(withData.map((p) => p.analysis));
      groups.forEach((g, gi) => g.forEach((i) => { withData[i].premade = { group: gi + 1, size: g.length, label }; }));
      return groups.map((g) => g.map((i) => withData[i].name || withData[i].championName));
    };
    const premades = { allies: markPremades(allies, 'A'), enemies: markPremades(enemies, 'E') };

    // Adversário direto
    const meP = allies.find((p) => p.isMe);
    if (meP && meP.position) {
      const opp = enemies.find((p) => p.position === meP.position);
      if (opp) opp.laneOpponent = true;
    }

    // Mais perigoso / elo mais fraco
    const scored = enemies.filter((p) => p.threat !== null);
    if (scored.length >= 2) {
      const sorted = [...scored].sort((a, b) => b.threat - a.threat);
      sorted[0].mostDangerous = true;
      sorted[sorted.length - 1].weakest = true;
    }
    const allyScored = allies.filter((p) => p.threat !== null && !p.isMe);
    if (allyScored.length >= 2) [...allyScored].sort((a, b) => b.threat - a.threat)[0].carry = true;

    const avg = (team) => {
      const v = team.map((p) => p.analysis && p.analysis.rank.solo ? p.analysis.rank.solo.value : null).filter((x) => x !== null);
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    };

    const oppGame = enemies.find((p) => p.laneOpponent);
    const gctx = meP && meP.championId ? this.matchupCtx(meP.championId, oppGame ? oppGame.championId : null, enemies.map((p) => p.championId)) : null;
    const gmode = modeRole(gd.queue ? gd.queue.id : null);
    const myBuild = meP && meP.championId ? this.buildFor(meP.championId, gmode || meP.position, gctx) : null;
    const comp = this.composition(enemies.map((p) => p.championId), allies.map((p) => p.championId));
    for (const p of enemies) {
      if (this.gd && this.gd.ready) {
        p.damageType = this.gd.damageType(p.championId);
        // cooldown da ultimate (para o overlay); os detalhes carregam em segundo plano
        const det = this.gd.details[p.championId];
        if (det && det.spells[3]) p.ultCd = det.spells[3].cooldown;
        else this.gd.champion(p.championId).catch(() => {});
      }
      p.vsRecord = this.store.vsRecord(p.championId, meP ? meP.championId : null, gameId);
    }

    const game = {
      gameId,
      myBuild,
      comp,
      queue: gd.queue ? (gd.queue.description || gd.queue.gameMode) : (live && live.gameData ? live.gameData.gameMode : null),
      queueId: gd.queue ? gd.queue.id : null,
      mapId: gd.queue ? gd.queue.mapId : null,
      gameTime: live && live.gameData ? Math.round(live.gameData.gameTime) : null,
      allies, enemies, premades,
      avgRank: { allies: avg(allies), enemies: avg(enemies) },
      loaded, total: allies.length + enemies.length,
      loading: loaded < allies.length + enemies.length
    };

    // Registar encontros (uma vez por jogo) e notificar quando tudo carregar
    if (gameId && !game.loading && this.recordedGame !== gameId) {
      this.recordedGame = gameId;
      const oppP = enemies.find((p) => p.laneOpponent);
      this.store.recordGame(gameId, {
        myChamp: meP ? meP.championId : null, enemies: enemies.map((p) => p.championId),
        allies: allies.filter((p) => !p.isMe).map((p) => p.championId), laneOpp: oppP ? oppP.championId : null
      });
      for (const p of [...allies, ...enemies]) {
        if (p.puuid && !p.isMe) this.store.recordEncounter({ puuid: p.puuid, name: p.name, tag: p.tag, gameId, ally: p.ally, championId: p.championId });
      }
    }
    if (gameId && !game.loading && this.notifiedGame !== gameId && this.store.settings.notifyDanger) {
      this.notifiedGame = gameId;
      const lines = [];
      const danger = enemies.find((p) => p.mostDangerous);
      if (danger) lines.push({ key: 'notif.danger', p: { name: danger.name || danger.championName, champ: danger.championName } });
      const opp = enemies.find((p) => p.laneOpponent);
      if (opp && opp.analysis) lines.push({ key: 'notif.vsYou', p: { champ: opp.championName }, rank: opp.analysis.rank.solo });
      if (premades.enemies.length) lines.push({ key: 'notif.duo', p: { groups: premades.enemies.map((g) => g.join(' + ')).join(' | ') } });
      if (lines.length) this.emit('notify', { title: { key: 'notif.match.t' }, lines });
    }
    return game;
  }

  // ---------- histórico próprio ----------

  async ownHistory() {
    const me = this.state.me;
    if (!me) return { games: [], summary: null };
    const n = Math.max(10, Math.min(this.store.settings.historyCount || 20, 50));
    const h = await this.lcu.safeGet(`/lol-match-history/v1/products/lol/${me.puuid}/matches?begIndex=0&endIndex=${n - 1}`);
    const games = A.normalizeGames(h, me.puuid).map((g) => ({ ...g, championName: this.champName(g.championId), kda: A.kda(g.kills, g.deaths, g.assists) }));
    const real = games.filter((g) => !g.remake);
    const agg = A.aggregate(real);
    const byChamp = {};
    for (const g of real) (byChamp[g.championId] = byChamp[g.championId] || []).push(g);
    const champs = Object.entries(byChamp).map(([id, gs]) => ({ championId: Number(id), name: this.champName(Number(id)), ...A.aggregate(gs) }))
      .sort((a, b) => b.games - a.games);
    return { games, summary: { ...agg, streak: A.streak(real), champs } };
  }

  async gameDetails(gameId) {
    const g = await this.lcu.safeGet(`/lol-match-history/v1/games/${Number(gameId)}`);
    if (!g) return null;
    const ids = {};
    for (const i of g.participantIdentities || []) ids[i.participantId] = i.player || {};
    const me = this.state.me || {};
    const players = (g.participants || []).map((p) => {
      const pl = ids[p.participantId] || {};
      const s = p.stats || {};
      return {
        teamId: p.teamId, name: pl.gameName || pl.summonerName, tag: pl.tagLine, puuid: pl.puuid, isMe: pl.puuid === me.puuid,
        championId: p.championId, championName: this.champName(p.championId),
        k: s.kills, d: s.deaths, a: s.assists, cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0),
        damage: s.totalDamageDealtToChampions, gold: s.goldEarned, vision: s.visionScore, win: !!s.win,
        items: [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6].filter((x) => x > 0)
      };
    });
    return { gameId: g.gameId, duration: g.gameDuration, queueId: g.queueId, queue: g.gameMode, date: g.gameCreation, players };
  }
}

module.exports = { Tracker, normPos };

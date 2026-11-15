// Guarda localmente: definições, jogadores já encontrados, notas e resultados.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  settings: {
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
  },
  players: {}, // puuid -> { name, tag, notes, encounters: [{gameId, date, ally, championId}] }
  results: {}, // gameId -> { win, date, championId, queueId }
  games: {}     // gameId -> { myChamp, enemies: [champIds], allies: [champIds], laneOpp }
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'lol-scout-data.json');
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...loaded, settings: { ...DEFAULTS.settings, ...(loaded.settings || {}) } };
      if (!this.data.games) this.data.games = {};
    } catch { /* primeira vez */ }
    this._timer = null;
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1));
      } catch (e) { console.error('Erro a guardar dados', e); }
    }, 300);
  }

  get settings() { return this.data.settings; }
  setSettings(patch) { Object.assign(this.data.settings, patch); this.save(); return this.data.settings; }

  recordEncounter({ puuid, name, tag, gameId, ally, championId, date = Date.now() }) {
    if (!puuid) return;
    const p = this.data.players[puuid] || (this.data.players[puuid] = { name, tag, notes: '', encounters: [] });
    if (name) { p.name = name; p.tag = tag; }
    if (!p.encounters.some((e) => e.gameId === gameId)) {
      p.encounters.push({ gameId, date, ally, championId });
      if (p.encounters.length > 50) p.encounters.shift();
      this.save();
    }
  }

  recordResult(gameId, info) {
    if (!gameId) return;
    this.data.results[gameId] = { ...(this.data.results[gameId] || {}), ...info };
    this.save();
  }

  // Resumo de encontros anteriores (exclui o jogo atual)
  history(puuid, currentGameId) {
    const p = this.data.players[puuid];
    if (!p) return { notes: '', withW: 0, withL: 0, vsW: 0, vsL: 0, total: 0, last: null };
    let withW = 0, withL = 0, vsW = 0, vsL = 0, total = 0, last = null;
    for (const e of p.encounters) {
      if (e.gameId === currentGameId) continue;
      total++;
      last = Math.max(last || 0, e.date);
      const r = this.data.results[e.gameId];
      if (!r || r.win === undefined) continue;
      if (e.ally) r.win ? withW++ : withL++;
      else r.win ? vsW++ : vsL++;
    }
    return { notes: p.notes || '', withW, withL, vsW, vsL, total, last };
  }

  // Guarda os campeões de um jogo teu (para "o teu histórico contra X")
  recordGame(gameId, info) {
    if (!gameId) return;
    this.data.games[gameId] = { ...(this.data.games[gameId] || {}), ...info };
    const ids = Object.keys(this.data.games);
    if (ids.length > 1500) delete this.data.games[ids[0]];
    this.save();
  }

  hasGame(gameId) { return !!this.data.games[gameId]; }

  // O teu histórico contra um campeão: em qualquer posição, na tua lane, e na lane com o mesmo campeão teu
  vsRecord(champId, myChamp, excludeGameId) {
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

  setNote(puuid, name, notes) {
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

module.exports = { Store };

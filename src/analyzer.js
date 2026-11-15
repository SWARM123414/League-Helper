// Análise de jogadores: rank, winrate, streaks, experiência no campeão,
// mains/one-tricks, possíveis smurfs, tilt, duos e "nível de ameaça".
// Funções puras (sem rede) para poderem ser testadas sem o cliente aberto.

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVS = { IV: 0, III: 1, II: 2, I: 3 };


const REMAKE_SECONDS = 300;

function rankValue(entry) {
  if (!entry || !entry.tier || entry.tier === 'NONE' || entry.tier === '') return null;
  const t = TIERS.indexOf(entry.tier);
  if (t < 0) return null;
  if (t >= 7) return 28 + (t - 7) * 2 + Math.min((entry.leaguePoints || 0) / 500, 1.9); // Master+
  return t * 4 + (DIVS[entry.division] ?? 0) + (entry.leaguePoints || 0) / 100;
}

function formatRank(entry) {
  if (!entry || !entry.tier || entry.tier === 'NONE' || entry.tier === '') return null;
  return {
    tier: entry.tier,
    division: TIERS.indexOf(entry.tier) >= 7 || entry.division === 'NA' ? null : entry.division,
    lp: entry.leaguePoints || 0,
    wins: entry.wins || 0,
    losses: entry.losses || 0,
    winrate: (entry.wins + entry.losses) > 0 ? Math.round((entry.wins / (entry.wins + entry.losses)) * 100) : null,
    games: (entry.wins || 0) + (entry.losses || 0),
    value: rankValue(entry)
  };
}

function parseRanked(ranked) {
  const map = (ranked && ranked.queueMap) || {};
  const solo = formatRank(map.RANKED_SOLO_5x5);
  const flex = formatRank(map.RANKED_FLEX_SR);
  const prevTier = map.RANKED_SOLO_5x5 && map.RANKED_SOLO_5x5.previousSeasonEndTier;
  const highest = map.RANKED_SOLO_5x5 && map.RANKED_SOLO_5x5.highestTier;
  return {
    solo,
    flex,
    previousSeason: prevTier && prevTier !== 'NONE' && prevTier !== '' ? prevTier : null,
    highest: highest && highest !== 'NONE' && highest !== '' ? highest : null
  };
}

// Normaliza os jogos que vêm de /lol-match-history/v1/products/lol/{puuid}/matches
function normalizeGames(historyResponse, puuid) {
  const list = (historyResponse && historyResponse.games && historyResponse.games.games) || [];
  const out = [];
  for (const g of list) {
    const parts = g.participants || [];
    const ids = g.participantIdentities || [];
    let p = parts[0];
    if (puuid && ids.length) {
      const ident = ids.find((i) => i.player && i.player.puuid === puuid);
      if (ident) p = parts.find((x) => x.participantId === ident.participantId) || p;
    }
    if (!p || !p.stats) continue;
    const s = p.stats;
    out.push({
      participantId: p.participantId,
      items: [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6].filter((x) => x > 0),
      perks: [s.perk0, s.perk1, s.perk2, s.perk3, s.perk4, s.perk5].filter((x) => x > 0),
      primaryStyle: s.perkPrimaryStyle || null,
      subStyle: s.perkSubStyle || null,
      shards: [s.statPerk0, s.statPerk1, s.statPerk2].filter((x) => x > 0),
      gameId: g.gameId,
      date: g.gameCreation,
      duration: g.gameDuration,
      queueId: g.queueId,
      gameMode: g.gameMode || null,
      patch: g.gameVersion ? String(g.gameVersion).split('.').slice(0, 2).join('.') : null,
      championId: p.championId,
      win: !!p.stats.win,
      kills: p.stats.kills || 0,
      deaths: p.stats.deaths || 0,
      assists: p.stats.assists || 0,
      cs: (p.stats.totalMinionsKilled || 0) + (p.stats.neutralMinionsKilled || 0),
      lane: p.timeline ? p.timeline.lane : null,
      role: p.timeline ? p.timeline.role : null,
      spells: [p.spell1Id, p.spell2Id],
      remake: (g.gameDuration || 0) < REMAKE_SECONDS
    });
  }
  out.sort((a, b) => b.date - a.date);
  return out;
}

function kda(k, d, a) {
  return d === 0 ? (k + a > 0 ? '∞' : '0.00') : ((k + a) / d).toFixed(2);
}

function aggregate(games) {
  const n = games.length;
  if (!n) return { games: 0, wins: 0, losses: 0, winrate: null, kda: null, k: 0, d: 0, a: 0 };
  let w = 0, k = 0, d = 0, a = 0;
  for (const g of games) { if (g.win) w++; k += g.kills; d += g.deaths; a += g.assists; }
  return {
    games: n, wins: w, losses: n - w, winrate: Math.round((w / n) * 100),
    kda: kda(k, d, a), k: +(k / n).toFixed(1), d: +(d / n).toFixed(1), a: +(a / n).toFixed(1)
  };
}

function streak(games) {
  if (!games.length) return { type: null, count: 0 };
  const first = games[0].win;
  let c = 0;
  for (const g of games) { if (g.win === first) c++; else break; }
  return { type: first ? 'win' : 'loss', count: c };
}

const LANE_FROM_TIMELINE = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MIDDLE', MID: 'MIDDLE', BOTTOM: 'BOTTOM', BOT: 'BOTTOM' };

function roleOf(g) {
  if (g.spells && g.spells.includes(11)) return 'JUNGLE';
  let r = LANE_FROM_TIMELINE[g.lane] || null;
  if (r === 'BOTTOM' && (g.role === 'DUO_SUPPORT' || g.role === 'SUPPORT')) r = 'UTILITY';
  return r;
}

function mainRole(games) {
  const counts = {};
  for (const g of games) {
    const r = roleOf(g);
    if (r) counts[r] = (counts[r] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

/**
 * Analisa um jogador.
 * @param {object} o
 * @param {string} o.puuid
 * @param {object} o.summoner  resposta de /lol-summoner/v2/summoners/puuid/{puuid}
 * @param {object} o.ranked    resposta de /lol-ranked/v1/ranked-stats/{puuid}
 * @param {object} o.history   resposta de /lol-match-history/.../matches
 * @param {number} o.championId campeão que está a jogar agora
 * @param {function} o.champName (id) => nome
 */
function analyzePlayer(o) {
  const { puuid, summoner = {}, ranked, history, championId, champName = (id) => String(id), isCompleted = null } = o;
  const allGames = normalizeGames(history, puuid);
  const games = allGames.filter((g) => !g.remake);
  const rank = parseRanked(ranked);
  const recent = aggregate(games);
  const st = streak(games);

  const onChamp = games.filter((g) => g.championId === championId);
  const champStats = aggregate(onChamp);

  const byChamp = {};
  for (const g of games) (byChamp[g.championId] = byChamp[g.championId] || []).push(g);
  const topChamps = Object.entries(byChamp)
    .map(([id, gs]) => ({ championId: Number(id), name: champName(Number(id)), ...aggregate(gs) }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 3);

  // Itens que este jogador costuma fazer com o campeão atual
  let champItems = [];
  if (isCompleted && onChamp.length) {
    const cnt = {};
    for (const g of onChamp) for (const id of new Set(g.items)) if (isCompleted(id)) cnt[id] = (cnt[id] || 0) + 1;
    champItems = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([id, n]) => ({ id: Number(id), pct: Math.round((n / onChamp.length) * 100) }));
  }
  // Keystone habitual no campeão
  const ks = {};
  for (const g of onChamp) if (g.perks[0]) ks[g.perks[0]] = (ks[g.perks[0]] || 0) + 1;
  const keystone = Object.entries(ks).sort((a, b) => b[1] - a[1])[0];

  const level = summoner.summonerLevel || null;
  const tags = [];
  const add = (type, key, p = {}) => tags.push({ type, key, p });
  const cn = championId ? champName(championId) : '';

  // Experiência no campeão
  if (championId) {
    if (games.length >= 5 && onChamp.length === 0) add('good', 'firstTime', { champ: cn, n: games.length });
    else if (games.length >= 5 && onChamp.length / games.length >= 0.6) add('bad', 'oneTrick', { n: onChamp.length, total: games.length, champ: cn });
    else if (onChamp.length >= 5) add('bad', 'main', { n: onChamp.length, champ: cn });
    if (onChamp.length >= 4 && champStats.winrate >= 65) add('bad', 'champWr', { wr: champStats.winrate, w: champStats.wins, l: champStats.losses, champ: cn });
  }

  // Forma recente
  if (st.type === 'loss' && st.count >= 3) add('good', 'tilt', { n: st.count });
  if (st.type === 'win' && st.count >= 3) add('bad', 'onFire', { n: st.count });
  if (recent.games >= 8 && recent.winrate <= 35) add('good', 'badRun', { wr: recent.winrate, n: recent.games });

  // Smurf?
  const soloWr = rank.solo ? rank.solo.winrate : null;
  if (level && level < 60 && ((soloWr !== null && soloWr >= 62 && rank.solo.games >= 10) || (recent.games >= 8 && recent.winrate >= 70))) {
    add('bad', 'smurf', { level });
  }
  if (rank.solo && rank.solo.games >= 30 && soloWr >= 60) add('bad', 'highWr', { wr: soloWr, n: rank.solo.games });
  if (rank.solo && rank.solo.games < 10 && rank.solo.games > 0) add('info', 'fewRanked', { n: rank.solo.games });
  if (!rank.solo && !rank.flex) add('info', 'unranked');

  // KDA alto
  if (recent.games >= 5 && recent.d > 0 && (recent.k + recent.a) / recent.d >= 4) add('bad', 'kda', { kda: recent.kda });
  if (recent.games >= 5 && recent.d >= 8) add('good', 'feeds', { d: recent.d });

  return {
    puuid,
    name: summoner.gameName || summoner.displayName || null,
    tag: summoner.tagLine || null,
    level,
    profileIconId: summoner.profileIconId || null,
    privacy: summoner.privacy || null,
    rank,
    recent,
    streak: st,
    champion: championId ? { id: championId, name: champName(championId), ...champStats } : null,
    topChamps,
    champItems,
    keystone: keystone ? Number(keystone[0]) : null,
    mainRole: mainRole(games),
    tags,
    recentResults: games.slice(0, 10).map((g) => g.win),
    gameIds: allGames.map((g) => g.gameId)
  };
}

// Pontuação de "ameaça" relativa: combina rank, forma e experiência no campeão.
function threatScore(p) {
  const rv = p.rank.solo ? p.rank.solo.value : p.rank.flex ? p.rank.flex.value - 2 : null;
  let s = rv !== null ? rv * 2.2 : 25; // ~0..70
  if (p.recent.winrate !== null) s += (p.recent.winrate - 50) * 0.4;
  if (p.champion) {
    s += Math.min(p.champion.games, 10) * 1.5;
    if (p.champion.games >= 4 && p.champion.winrate !== null) s += (p.champion.winrate - 50) * 0.2;
  }
  if (p.streak.type === 'win') s += p.streak.count * 1.5;
  if (p.streak.type === 'loss') s -= p.streak.count * 1.5;
  for (const t of p.tags) if (t.key === 'smurf') s += 10;
  return Math.round(s);
}

// Deteta grupos (duo / premade) por jogos recentes em comum.
function detectPremades(players, minShared = 2) {
  const parent = players.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const sets = players.map((p) => new Set(p.gameIds || []));
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      let shared = 0;
      for (const id of sets[i]) if (sets[j].has(id)) shared++;
      if (shared >= minShared) parent[find(i)] = find(j);
    }
  }
  const groups = {};
  players.forEach((_, i) => { (groups[find(i)] = groups[find(i)] || []).push(i); });
  return Object.values(groups).filter((g) => g.length > 1);
}

function slug(name) {
  const special = { 'Nunu & Willump': 'nunu', 'Renata Glasc': 'renata', Wukong: 'wukong' };
  if (special[name]) return special[name];
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

module.exports = {
  analyzePlayer, threatScore, detectPremades, normalizeGames, roleOf, parseRanked, aggregate, streak, kda, slug,
  TIERS
};

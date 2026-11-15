/* global api, I18N */
'use strict';

// ---------- idioma ----------
let LANG = 'pt';
const T = (k, p) => I18N.t(LANG, k, p);
const rankLabel = (r) => I18N.rankLabel(LANG, r);
const queueName = (id, fb) => I18N.queueName(LANG, id, fb);
const posName = (p) => (p ? T('pos.' + p) : '');

// ---------- utilitários ----------
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1';
const champIcon = (id) => (id > 0 ? `${CD}/champion-icons/${id}.png` : `${CD}/champion-icons/-1.png`);
const profileIcon = (id) => `${CD}/profile-icons/${id || 29}.jpg`;
let ddVersion = '14.24.1';
fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json()).then((v) => { if (v && v[0]) ddVersion = v[0]; }).catch(() => {});
const itemIcon = (id) => `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/item/${id}.png`;
const SPELLS = { 1: 'SummonerBoost', 3: 'SummonerExhaust', 4: 'SummonerFlash', 6: 'SummonerHaste', 7: 'SummonerHeal', 11: 'SummonerSmite', 12: 'SummonerTeleport', 13: 'SummonerMana', 14: 'SummonerDot', 21: 'SummonerBarrier', 32: 'SummonerSnowball' };
const spellIcon = (id) => (SPELLS[id] ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/spell/${SPELLS[id]}.png` : null);
const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return T('ago.min', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return T('ago.h', { n: h });
  return T('ago.d', { n: Math.round(h / 24) });
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const wrClass = (wr) => (wr === null || wr === undefined ? '' : wr >= 55 ? 'hi' : wr <= 45 ? 'lo' : '');
const numFmt = (n) => (n || 0).toLocaleString(LANG);
// tradução de uma mensagem que pode ser uma chave (ex.: "err.noBuild") ou texto
const tr = (msg) => (typeof msg === 'string' && /^[a-z]+\.[\w.]+$/.test(msg) ? T(msg) : msg);

let state = null;
let lastKey = '';
let currentTab = 'match';

// Imagens que falham (sem internet / ícone novo) ficam como um quadrado vazio
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && !t.dataset.failed) {
    t.dataset.failed = '1';
    t.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#1e2d3d"/></svg>');
  }
}, true);

// ---------- textos fixos da página + seletor de idioma ----------
function applyStatic() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = T(el.dataset.i18nPh); });
  const sel = $('#lang-select');
  if (sel) {
    sel.innerHTML = I18N.LANGS.map((l) => `<option value="${l.code}" ${l.code === LANG ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  }
}

async function setLang(code, save = true) {
  if (!I18N.D[code]) return;
  LANG = code;
  applyStatic();
  if (save) await api.setSettings({ lang: code });
  if (typeof resetLangCaches === 'function') resetLangCaches();
  lastKey = '';
  if (state) { renderHeader(); renderMatch(); }
  showTab(currentTab);
}

$('#lang-select').addEventListener('change', (e) => setLang(e.target.value));
api.getSettings().then((s) => { setLang((s && s.lang) || 'pt', false); });

// ---------- separadores ----------
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.id === `tab-${tab}`));
  if (tab === 'history') loadHistory();
  if (tab === 'builds') loadBuildsTab();
  if (tab === 'notes') loadNotes();
  if (tab === 'settings') loadSettings();
}

// Cliques: importar, info do campeão, perfil, notas (a app não abre links externos)
document.addEventListener('click', (e) => {
  const pr = e.target.closest('[data-profile]');
  if (pr) { e.preventDefault(); openProfile(pr.dataset.profile); return; }
  const ci = e.target.closest('[data-csinfo]');
  if (ci) { e.preventDefault(); toggleCsInfo(Number(ci.dataset.csinfo)); return; }
  const imp = e.target.closest('[data-import]');
  if (imp) { e.preventDefault(); const [c, r, w] = imp.dataset.import.split('|'); doImport(Number(c), r || null, w); return; }
  const inf = e.target.closest('[data-info]');
  if (inf) { e.preventDefault(); toggleInfo(inf.dataset.info, Number(inf.dataset.champ)); return; }
  const n = e.target.closest('[data-note]');
  if (n) { e.preventDefault(); openNote(n.dataset.note, n.dataset.name, n.dataset.text || ''); }
});

// ---------- estado ----------
api.onState((s) => {
  state = s;
  if (s.settings && s.settings.lang && s.settings.lang !== LANG) { LANG = s.settings.lang; applyStatic(); lastKey = ''; }
  renderHeader();
  const key = JSON.stringify([s.view, s.status, s.phase, s.champSelect, s.game, s.error]);
  if (key !== lastKey) { lastKey = key; renderMatch(); }
});

function renderHeader() {
  const s = state;
  $('#status').innerHTML = s.status === 'connected'
    ? `<span class="dot on"></span>${esc(T('status.connected'))} · ${esc(s.phase ? T('phase.' + s.phase) : '')}${s.demo ? ' · DEMO' : ''}`
    : `<span class="dot wait"></span>${esc(T('status.searching'))}`;
  $('#me').innerHTML = s.me
    ? `<img src="${profileIcon(s.me.iconId)}" alt=""><div><div>${esc(s.me.name)} <small>#${esc(s.me.tag || '')}</small></div><small>${esc(T('me.level', { n: s.me.level }))} · ${esc(s.region || '')}</small></div>`
    : '';
}

function renderMatch() {
  const el = $('#tab-match');
  const s = state;
  if (!s) return;
  if (s.status !== 'connected') {
    el.innerHTML = `<div class="empty"><div class="spinner"></div><h2>${esc(T('wait.title'))}</h2>
      <p>${esc(T('wait.text'))}</p>
      <ul class="hint-list">
        <li>${T('wait.hint1', { dir: '<b>C:\\Riot Games\\League of Legends</b>', settings: `<a href="#" id="go-settings">${esc(T('tab.settings'))}</a>` })}</li>
        <li>${T('wait.hint2', { cmd: '<b>npm run demo</b>' })}</li>
      </ul></div>`;
    const g = $('#go-settings'); if (g) g.addEventListener('click', (e) => { e.preventDefault(); showTab('settings'); });
    return;
  }
  if (s.view === 'champselect' && s.champSelect) return renderChampSelect(el, s.champSelect);
  if ((s.view === 'game' || s.view === 'postgame') && s.game) return renderGame(el, s.game, s.view === 'postgame');
  let title, desc;
  if (s.phase === 'Matchmaking') { title = T('idle.Matchmaking.t'); desc = T('idle.Matchmaking.d'); }
  else if (s.phase === 'ReadyCheck') { title = T('idle.ReadyCheck.t'); desc = s.settings && s.settings.autoAccept ? T('idle.ReadyCheck.auto') : T('idle.ReadyCheck.manual'); }
  else if (s.phase === 'Lobby') { title = T('idle.Lobby.t'); desc = T('idle.Lobby.d'); }
  else { title = T('idle.ready.t'); desc = T('idle.ready.d'); }
  el.innerHTML = `<div class="empty"><div class="spinner"></div><h2>${esc(title)}</h2><p>${esc(desc)}</p></div>`;
}

// texto do resultado de uma importação (inclui avisos de página substituída / runas da Riot)
function importText(m) {
  let text = T('imp.done', { what: m.what.map((w) => T('imp.' + w)).join(` ${T('and')} `), champ: m.champ });
  if (m.replaced) text += ' ' + T('imp.replaced', { name: m.replaced });
  if (m.runeSource === 'riot') text += ' ' + T('imp.riot');
  return text;
}

// ---------- seleção de campeões ----------
function importMsgHtml(m) {
  if (!m) return '';
  const text = m.ok ? importText(m) : T('imp.err', { msg: tr(m.err) });
  return `<div class="alert ${m.ok ? 'gold' : 'enemy'}" style="margin-bottom:8px">${esc(text)}</div>`;
}

function renderChampSelect(el, cs) {
  const ban = (b) => `<img src="${champIcon(b.id)}" title="${esc(b.name)}" alt="">`;
  const myChamp = cs.myChampion ? (cs.allies.find((p) => p.isMe) || {}).championName : null;
  for (const p of cs.enemies) if (p.championId && csExpanded.has(p.championId)) ensureChampData(p.championId);

  const ally = (p) => {
    const a = p.analysis;
    const rank = a && a.rank.solo ? `<span class="t-${a.rank.solo.tier}">${esc(rankLabel(a.rank.solo))}</span> · ${a.rank.solo.winrate}%` : a ? `<span class="muted">${esc(T('cs.unranked'))}</span>` : '';
    const champLine = a && a.champion ? ` · ${esc(T('cs.champGames', { n: a.champion.games, champ: a.champion.name }))}${a.champion.games ? ` (${a.champion.winrate}%)` : ''}` : '';
    return `<div class="cs-pick ${p.isMe ? 'me' : ''} ${p.hovering ? 'hover' : ''}">
      ${p.championId ? `<img src="${champIcon(p.championId)}" alt="">` : '<div class="ph">?</div>'}
      <div class="grow">
        <div class="name">${p.name ? esc(p.name) : `<span class="muted">${esc(T('cs.hidden'))}</span>`}${p.isMe ? ` <small>${esc(T('cs.you'))}</small>` : ''}</div>
        <div class="sub">${p.position ? esc(posName(p.position)) + ' · ' : ''}${p.championName ? esc(p.championName) + (p.hovering ? ' ' + esc(T('cs.hovering')) : '') : esc(T('cs.choosing'))}</div>
        ${a ? `<div class="sub">${rank}${champLine}</div>` : ''}
        ${a && a.tags.length ? `<div class="tags">${a.tags.slice(0, 4).map(tag).join('')}</div>` : ''}
        ${p.encounter && p.encounter.total ? `<div class="encounter">${esc(encounterText(p.encounter))}</div>` : ''}
      </div></div>`;
  };
  const enemy = (p) => {
    const open = p.championId && csExpanded.has(p.championId);
    const rec = p.vsRecord;
    const recLine = rec && (rec.all.w + rec.all.l) ? `<div class="sub">${esc(T('vs.all', rec.all))}${rec.lane.w + rec.lane.l ? ' · ' + esc(T('vs.lane', rec.lane)) : ''}</div>` : '';
    return `<div class="cs-pick">
      ${p.championId ? `<img src="${champIcon(p.championId)}" alt="">` : '<div class="ph">?</div>'}
      <div class="grow">
        <div class="name">${p.championName ? esc(p.championName) : `<span class="muted">${esc(T('cs.choosing'))}</span>`}${p.likelyLane ? ` <span class="badge opp">${esc(T('mu.likely'))}</span>` : ''}</div>
        ${recLine}
        ${p.championId ? `<div class="links"><a href="#" data-csinfo="${p.championId}">${esc(open ? T('card.less') : T('card.info'))}</a></div>` : ''}
      </div></div>
      ${open ? `<div class="cs-info">${champInfoPanel({ ...p, ally: false, analysis: null, name: null }, myChamp)}</div>` : ''}`;
  };

  const b = cs.myBuild;
  el.innerHTML = `
    <div class="matchbar">
      <span class="q">${esc(T('cs.title'))}</span>
      ${cs.timer ? `<span class="timer">${cs.timer.left}s</span>` : ''}
      <span class="sp"></span>
      <span class="k">${esc(T('cs.bans'))}</span>
      <div class="bans">${cs.bans.mine.map(ban).join('')}</div>
      <span class="muted">${esc(T('cs.vs'))}</span>
      <div class="bans">${cs.bans.theirs.map(ban).join('')}</div>
    </div>
    ${b ? `<div class="panel"><div class="panel-title">${esc(b.championName)}${b.role !== 'ALL' ? ' · ' + esc(posName(b.role)) : ''} — ${esc(b.vs ? T('mu.title', { champ: b.vs.name }) : T('mu.titleNoOpp'))}</div>${importMsgHtml(cs.importMsg)}${renderBuild(b, { compact: true, importable: true })}</div>`
    : cs.myChampion ? `<div class="panel muted">${esc(T('cs.noBuildData'))}</div>` : ''}
    ${compPanel(cs.comp)}
    ${cs.namesHidden ? `<div class="alerts"><div class="alert gold">${esc(T('cs.hiddenNote'))}</div></div>` : ''}
    <div class="cs-grid">
      <div class="cs-col a"><h3>${esc(T('cs.yourTeam'))}</h3>${cs.allies.map(ally).join('')}</div>
      <div class="cs-col e"><h3>${esc(T('cs.enemyPicks'))}</h3>${cs.enemies.map(enemy).join('')}</div>
    </div>`;
}

// ---------- jogo ----------
function tag(t) { return `<span class="tag ${t.type}" title="${esc(T('tagT.' + t.key, t.p))}">${esc(T('tag.' + t.key, t.p))}</span>`; }

function encounterText(e) {
  const parts = [];
  if (e.vsW + e.vsL) parts.push(T('enc.vs', { w: e.vsW, l: e.vsL }));
  if (e.withW + e.withL) parts.push(T('enc.with', { w: e.withW, l: e.withL }));
  return `⟳ ${T('enc.met', { n: e.total })} ${parts.length ? '(' + parts.join(' · ') + ')' : ''}${e.last ? ' · ' + ago(e.last) : ''}`;
}

function card(p, game) {
  const a = p.analysis;
  const side = p.ally ? 'ally' : 'enemy';
  const cls = ['card', side];
  if (p.isMe) cls.push('me');
  if (p.laneOpponent) cls.push('opp');
  if (p.mostDangerous) cls.push('danger');
  if (!a && p.puuid) cls.push('loading');

  const badges = [];
  if (p.laneOpponent) badges.push(`<span class="badge opp">${esc(T('badge.opp'))}</span>`);
  if (p.mostDangerous) badges.push(`<span class="badge danger">${esc(T('badge.danger'))}</span>`);
  if (p.weakest) badges.push(`<span class="badge weak">${esc(T('badge.weak'))}</span>`);
  if (p.carry) badges.push(`<span class="badge carry">${esc(T('badge.carry'))}</span>`);
  if (p.premade) badges.push(`<span class="badge duo">${esc(T(p.premade.size === 2 ? 'badge.duo' : 'badge.premade'))} ${p.premade.group}</span>`);
  if (p.encounter && p.encounter.total) badges.push(`<span class="badge met">${esc(T('badge.met'))}</span>`);

  const solo = a && a.rank.solo;
  const flex = a && a.rank.flex;
  const rankHtml = solo
    ? `<div class="rank t-${solo.tier}">${esc(rankLabel(solo))} <small>${solo.lp} LP</small></div><div class="wr">${esc(T('card.season'))}: <b class="${wrClass(solo.winrate)}">${solo.winrate}%</b> · ${esc(T('card.wl', { w: solo.wins, l: solo.losses }))}</div>`
    : flex ? `<div class="rank t-${flex.tier}">${esc(rankLabel(flex))} <small>${esc(T('card.flex'))}</small></div><div class="wr">${flex.winrate}% · ${esc(T('card.games', { n: flex.games }))}</div>`
      : a ? `<div class="rank t-NONE">${esc(T('card.unranked'))}</div>${a.rank.previousSeason ? `<div class="wr">${esc(T('card.prevSeason', { tier: T('tier.' + a.rank.previousSeason) }))}</div>` : ''}` : `<div class="rank t-NONE">${esc(T('card.loading'))}</div>`;

  const recent = a && a.recent.games ? `<div class="wr">${esc(T('card.lastN', { n: a.recent.games }))}: <b class="${wrClass(a.recent.winrate)}">${a.recent.winrate}%</b> · KDA ${esc(a.recent.kda)}</div>` : '';
  const champLine = a && a.champion
    ? `<div class="sub">${esc(p.championName)}: <b>${esc(T('card.games', { n: a.champion.games }))}</b>${a.champion.games ? ` · <b class="${wrClass(a.champion.winrate)}">${a.champion.winrate}%</b> · KDA ${esc(a.champion.kda)}` : ' ' + esc(T('card.recent'))}</div>`
    : `<div class="sub">${esc(p.championName || '')}</div>`;
  const form = a && a.recentResults.length ? `<div class="form" title="${esc(T('card.formTitle'))}">${a.recentResults.map((w) => `<i class="${w ? 'w' : 'l'}"></i>`).join('')}</div>` : '';
  const tops = a && a.topChamps.length ? `<div class="top-champs"><span class="muted">${esc(T('card.mostPlayed'))}</span>${a.topChamps.map((c) => `<span title="${esc(T('card.champTitle', { name: c.name, n: c.games, wr: c.winrate }))}"><img src="${champIcon(c.championId)}" alt="">${c.games}</span>`).join('')}</div>` : '';

  const live = p.live ? `<div class="live"><span class="kda">${p.live.k}/${p.live.d}/${p.live.a}</span> · ${p.live.cs} CS</div>${p.live.items.length ? `<div class="items">${p.live.items.slice(0, 7).map((i) => `<img src="${itemIcon(i.id)}" title="${esc(i.name)}" alt="">`).join('')}</div>` : ''}` : '';
  const threat = !p.ally && p.threat !== null && p.threat !== undefined ? `<div class="threat" title="${esc(T('card.threat', { n: p.threat }))}"><div style="width:${Math.max(5, Math.min(100, p.threat))}%"></div></div>` : '';

  const links = [];
  links.push(`<a href="#" data-info="${esc(infoKey(p))}" data-champ="${p.championId}">${esc(expanded.has(infoKey(p)) ? T('card.less') : T('card.info'))}</a>`);
  if (p.puuid) links.push(`<a href="#" data-profile="${esc(p.puuid)}">${esc(T('card.profile'))}</a>`);
  if (p.puuid && !p.isMe) links.push(`<a href="#" data-note="${esc(p.puuid)}" data-name="${esc(p.name || p.championName)}" data-text="${esc(p.encounter ? p.encounter.notes : '')}">${esc(p.encounter && p.encounter.notes ? T('card.editNote') : T('card.addNote'))}</a>`);

  return `<div class="${cls.join(' ')}">
    <div class="badges">${badges.join('')}</div>
    <div class="champ">
      <img class="icon" src="${champIcon(p.championId)}" alt="">
      ${p.live && p.live.level ? `<span class="lvl">${p.live.level}</span>` : ''}
      ${p.live && p.live.isDead ? `<div class="dead">${p.live.respawn}s</div>` : ''}
      <div class="spells">${(p.spells || []).map((s) => (spellIcon(s) ? `<img src="${spellIcon(s)}" alt="">` : '')).join('')}</div>
      <div class="pos">${esc(posName(p.position))}</div>
    </div>
    <div class="info">
      <div class="name">${p.name ? esc(p.name) : esc(p.championName)}${p.tag ? ` <small>#${esc(p.tag)}</small>` : ''}${p.isMe ? ` <small>${esc(T('cs.you'))}</small>` : ''}${a && a.level ? ` <small>· ${esc(T('card.lvl', { n: a.level }))}</small>` : ''}</div>
      ${champLine}
      ${form}
      ${a && a.tags.length ? `<div class="tags">${a.tags.map(tag).join('')}</div>` : ''}
      ${tops}
      ${p.encounter && p.encounter.total ? `<div class="encounter">${esc(encounterText(p.encounter))}</div>` : ''}
      ${p.encounter && p.encounter.notes ? `<div class="note">📝 ${esc(p.encounter.notes)}</div>` : ''}
      <div class="links">${links.join('')}</div>
    </div>
    <div class="stats">${rankHtml}${recent}${live}${threat}</div>
  </div>`;
}

function rankFromValue(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 28) return T('tier.masterPlus');
  const tiers = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
  const t = tiers[Math.floor(v / 4)];
  return t ? rankLabel({ tier: t, division: ['IV', 'III', 'II', 'I'][Math.floor(v % 4)] }) : '?';
}

function renderGame(el, g, post) {
  if (!g.allies.length && !g.enemies.length) {
    el.innerHTML = `<div class="empty"><div class="spinner"></div><h2>${esc(T('game.loading.t'))}</h2><p>${esc(T('game.loading.d'))}</p></div>`;
    return;
  }
  const n = Math.max(g.allies.length, g.enemies.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const a = g.allies[i];
    const e = g.enemies[i];
    const lane = a && e && a.position && a.position === e.position ? posName(a.position) : '';
    rows.push(`<div class="row">${a ? card(a, g) : '<div></div>'}<div class="vs"><b>VS</b>${esc(lane)}</div>${e ? card(e, g) : '<div></div>'}</div>`);
    const open = [a, e].filter((p) => p && expanded.has(infoKey(p)));
    const myName = (g.allies.find((x) => x.isMe) || {}).championName;
    if (open.length) rows.push(`<div class="info-row">${open.map((p) => champInfoPanel(p, myName)).join('')}</div>`);
  }
  const alerts = [];
  const names = (grp) => `<b>${grp.map(esc).join(' + ')}</b>`;
  for (const grp of g.premades.enemies) alerts.push(`<div class="alert enemy">⚠ ${T(grp.length === 2 ? 'alert.enemyDuo' : 'alert.enemyPremade', { names: names(grp) })}</div>`);
  for (const grp of g.premades.allies) alerts.push(`<div class="alert ally">${T(grp.length === 2 ? 'alert.allyDuo' : 'alert.allyPremade', { names: names(grp) })}</div>`);
  const opp = g.enemies.find((p) => p.laneOpponent);
  if (opp && opp.analysis) {
    const a = opp.analysis;
    const bits = [T('alert.vsYou', { champ: `<b>${esc(opp.championName)}</b>` }) + (opp.name ? ` (${esc(opp.name)})` : '')];
    if (a.rank.solo) bits.push(esc(rankLabel(a.rank.solo)));
    if (a.champion) bits.push(esc(a.champion.games ? T('alert.champGames', { n: a.champion.games, wr: a.champion.winrate }) : T('alert.champNone')));
    alerts.unshift(`<div class="alert gold">🎯 ${bits.join(' · ')}</div>`);
  }
  const danger = g.enemies.find((p) => p.mostDangerous);
  if (danger) alerts.push(`<div class="alert enemy">☠ ${T('alert.danger', { name: `<b>${esc(danger.name || danger.championName)}</b>`, champ: esc(danger.championName) })}</div>`);
  const weak = g.enemies.find((p) => p.weakest);
  if (weak) alerts.push(`<div class="alert ally">🎯 ${T('alert.weak', { name: `<b>${esc(weak.name || weak.championName)}</b>`, champ: esc(weak.championName) })}</div>`);

  const mb = g.myBuild;
  el.innerHTML = `
    <div class="matchbar">
      <span class="q">${esc(g.queueId !== null && g.queueId !== undefined ? queueName(g.queueId, g.queue) : (g.queue || T('game.match')))}</span>
      ${g.gameTime !== null && g.gameTime !== undefined && !post ? `<span><span class="k">${esc(T('game.time'))}</span> <span class="v">${mmss(g.gameTime)}</span></span>` : ''}
      <span><span class="k">${esc(T('game.avgAlly'))}</span> <span class="v">${esc(rankFromValue(g.avgRank.allies))}</span></span>
      <span><span class="k">${esc(T('game.avgEnemy'))}</span> <span class="v">${esc(rankFromValue(g.avgRank.enemies))}</span></span>
      <span class="sp"></span>
      ${post && g.result ? `<span class="result ${g.result}">${esc(T(g.result === 'win' ? 'game.victory' : 'game.defeat'))}</span>` : post ? `<span class="muted">${esc(T('game.last'))}</span>` : ''}
      <button class="btn small ghost" id="btn-refresh">${esc(T('game.refresh'))}</button>
    </div>
    ${g.loading ? `<div class="loadbar"><div style="width:${Math.round((g.loaded / Math.max(1, g.total)) * 100)}%"></div></div>` : ''}
    <div class="alerts">${alerts.join('')}</div>
    ${compPanel(g.comp)}
    ${mb ? `<details class="panel" ${buildOpen ? 'open' : ''} id="mybuild"><summary>${esc(mb.championName)}${mb.role !== 'ALL' ? ' · ' + esc(posName(mb.role)) : ''} — ${esc(mb.vs ? T('mu.title', { champ: mb.vs.name }) : T('mu.titleNoOpp'))}</summary>${renderBuild(mb, { compact: true, importable: false })}</details>` : ''}
    <div class="teams-head"><div class="a">${esc(T('game.yourTeam'))}</div><div></div><div class="e">${esc(T('game.enemyTeam'))}</div></div>
    ${rows.join('')}`;
  const b = $('#btn-refresh');
  if (b) b.addEventListener('click', () => { api.refresh(); lastKey = ''; });
  const det = $('#mybuild');
  if (det) det.addEventListener('toggle', () => { buildOpen = det.open; });
}

// ---------- histórico ----------
async function loadHistory() {
  const el = $('#tab-history');
  if (!state || state.status !== 'connected') { el.innerHTML = `<div class="empty"><h2>${esc(T('hist.noConn.t'))}</h2><p>${esc(T('hist.noConn.d'))}</p></div>`; return; }
  el.innerHTML = `<div class="empty"><div class="spinner"></div><p>${esc(T('hist.loading'))}</p></div>`;
  const h = await api.history();
  if (!h || !h.games.length) { el.innerHTML = `<div class="empty"><h2>${esc(T('hist.none.t'))}</h2><p>${esc(T('hist.none.d'))}</p></div>`; return; }
  const s = h.summary;
  const st = s.streak.type ? T(s.streak.type === 'win' ? 'hist.wins' : 'hist.losses', { n: s.streak.count }) : '—';
  el.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="k">${esc(T('hist.wr', { n: s.games }))}</div><div class="v ${wrClass(s.winrate)}">${s.winrate}% <small>${esc(T('card.wl', { w: s.wins, l: s.losses }))}</small></div></div>
      <div class="tile"><div class="k">${esc(T('hist.kda'))}</div><div class="v">${esc(s.kda)} <small>${s.k} / ${s.d} / ${s.a}</small></div></div>
      <div class="tile"><div class="k">${esc(T('hist.streak'))}</div><div class="v">${esc(st)}</div></div>
      <div class="tile"><div class="k">${esc(T('hist.mostPlayed'))}</div><div class="v">${s.champs[0] ? esc(s.champs[0].name) + ` <small>${esc(T('card.games', { n: s.champs[0].games }))} · ${s.champs[0].winrate}%</small>` : '—'}</div></div>
    </div>
    <div class="section-title">${esc(T('hist.champs'))}</div>
    <div class="champ-strip">${s.champs.slice(0, 8).map((c) => `<div><img src="${champIcon(c.championId)}" alt=""><div><b>${esc(c.name)}</b><div class="sub">${esc(T('card.games', { n: c.games }))} · <b class="${wrClass(c.winrate)}">${c.winrate}%</b> · KDA ${esc(c.kda)}</div></div></div>`).join('')}</div>
    <div class="section-title">${esc(T('hist.games'))} <span class="muted">${esc(T('hist.click'))}</span></div>
    <div id="games">${h.games.map(gameRow).join('')}</div>`;
  el.querySelectorAll('.game').forEach((row) => row.addEventListener('click', () => toggleDetails(row)));
}

// linha de jogo reutilizada no histórico e no perfil
function gameRow(g) {
  return `<div class="game ${g.remake ? 'r' : g.win ? 'w' : 'l'}" data-game="${g.gameId}">
    <div class="bar"></div>
    <img src="${champIcon(g.championId)}" alt="">
    <div><div class="res">${esc(T(g.remake ? 'hist.remake' : g.win ? 'hist.win' : 'hist.loss'))}</div><div class="sub">${esc(queueName(g.queueId, g.gameMode))}</div></div>
    <div><b>${g.kills} / ${g.deaths} / ${g.assists}</b><div class="sub">KDA ${esc(g.kda)}</div></div>
    <div><b>${g.cs} CS</b><div class="sub">${(g.cs / Math.max(1, g.duration / 60)).toFixed(1)}/min</div></div>
    <div><b>${mmss(g.duration)}</b><div class="sub">${esc(ago(g.date))}</div></div>
    <div class="muted">▾</div>
  </div>`;
}

async function toggleDetails(row) {
  const next = row.nextElementSibling;
  if (next && next.classList.contains('details')) { next.remove(); return; }
  const box = document.createElement('div');
  box.className = 'details';
  box.textContent = T('card.loading');
  row.after(box);
  const d = await api.gameDetails(row.dataset.game);
  if (!d) { box.textContent = T('hist.detErr'); return; }
  const teams = [100, 200].map((t) => d.players.filter((p) => p.teamId === t));
  box.innerHTML = teams.map((team) => `<table>
    <tr><th>${team[0] && team[0].win ? `<span style="color:var(--good)">${esc(T('hist.win'))}</span>` : `<span style="color:var(--bad)">${esc(T('hist.loss'))}</span>`}</th><th>${esc(T('th.kda'))}</th><th>${esc(T('th.cs'))}</th><th>${esc(T('th.dmg'))}</th><th>${esc(T('th.gold'))}</th><th>${esc(T('th.vision'))}</th><th>${esc(T('th.items'))}</th></tr>
    ${team.map((p) => `<tr class="${p.isMe ? 'me' : ''} ${p.win ? 'team-w' : 'team-l'}">
      <td><img src="${champIcon(p.championId)}" alt=""> ${esc(p.name || p.championName)}${p.tag ? ` <span class="muted">#${esc(p.tag)}</span>` : ''}</td>
      <td>${p.k}/${p.d}/${p.a}</td><td>${p.cs}</td><td>${numFmt(p.damage)}</td><td>${numFmt(p.gold)}</td><td>${p.vision ?? '-'}</td>
      <td>${p.items.map((i) => `<img src="${itemIcon(i)}" alt="">`).join('')}</td></tr>`).join('')}
  </table>`).join('<br>');
}

// ---------- notas ----------
async function loadNotes() {
  const el = $('#tab-notes');
  const list = await api.notedPlayers();
  el.innerHTML = `<div class="section-title">${esc(T('notes.title'))}</div>
    <p class="muted">${esc(T('notes.desc'))}</p>
    ${list.length ? list.map((p) => `<div class="note-row"><div><b>${esc(p.name || '?')}</b> <span class="muted">#${esc(p.tag || '')} · ${esc(T('notes.met', { n: p.encounters }))}</span><div class="note">${esc(p.notes)}</div></div>
      <div><a href="#" data-note="${esc(p.puuid)}" data-name="${esc(p.name)}" data-text="${esc(p.notes)}">${esc(T('notes.edit'))}</a></div></div>`).join('') : `<p class="muted">${esc(T('notes.none'))}</p>`}`;
}

let notePuuid = null;
let noteName = null;
function openNote(puuid, name, text) {
  notePuuid = puuid; noteName = name;
  $('#modal-title').textContent = T('modal.title', { name });
  $('#modal-text').value = text;
  $('#modal').classList.remove('hidden');
  $('#modal-text').focus();
}
$('#modal-cancel').addEventListener('click', () => $('#modal').classList.add('hidden'));
$('#modal-save').addEventListener('click', async () => {
  await api.setNote(notePuuid, noteName, $('#modal-text').value);
  $('#modal').classList.add('hidden');
  lastKey = '';
  if ($('#tab-notes').classList.contains('active')) loadNotes();
});

// ---------- definições ----------
const HOTKEYS = ['Ctrl+Shift+Z', 'Alt+Z', 'Ctrl+Shift+X', 'Alt+X', 'F9', 'F10', 'F11', 'Ctrl+Tab'];

async function loadSettings() {
  const s = await api.getSettings();
  const el = $('#tab-settings');
  const sw = (key, k) => `<div class="setting"><div><h4>${esc(T(k))}</h4><p>${esc(T(k + 'D'))}</p></div>
    <label class="switch"><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}><span></span></label></div>`;
  const sel = (key, k, opts, cur) => `<div class="setting"><div><h4>${esc(T(k))}</h4><p>${esc(T(k + 'D'))}</p></div>
    <select data-key="${key}">${opts.map(([v, label]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>`;
  const num = (arr) => arr.map((n) => [n, String(n)]);
  el.innerHTML = `<div class="settings">
    <div class="section-title">${esc(T('set.sec.general'))}</div>
    ${sel('lang', 'set.lang', I18N.LANGS.map((l) => [l.code, l.name]), LANG)}
    ${sw('autoAccept', 'set.autoAccept')}
    ${sw('notifyDanger', 'set.notify')}
    ${sel('historyCount', 'set.history', num([10, 20, 30, 50]), s.historyCount)}
    <div class="setting"><div><h4>${esc(T('set.dir'))}</h4><p>${esc(T('set.dirD'))}</p></div>
      <input type="text" data-key="leagueDir" value="${esc(s.leagueDir || '')}" placeholder="${esc(T('set.dirPh'))}"></div>

    <div class="section-title">${esc(T('set.sec.overlay'))}</div>
    ${sw('overlay', 'set.overlay')}
    ${sel('overlayKey', 'set.overlayKey', HOTKEYS.map((k) => [k, k]), s.overlayKey)}
    ${sel('overlayAutoSeconds', 'set.overlayAuto', num([0, 10, 20, 30, 60]), s.overlayAutoSeconds)}
    ${sel('overlaySide', 'set.overlaySide', [['right', T('set.right')], ['left', T('set.left')]], s.overlaySide)}
    <div class="setting"><div></div><button class="btn small" id="ov-test">${esc(T('set.overlayTest'))}</button></div>

    <div class="section-title">${esc(T('set.sec.builds'))}</div>
    ${sw('autoImport', 'set.autoImport')}
    ${sw('collectBuilds', 'set.collect')}
    ${sel('buildPlayers', 'set.players', num([50, 100, 150, 250, 400]), s.buildPlayers || 150)}

    <div class="section-title">${esc(T('set.sec.perf'))}</div>
    ${sw('lightMode', 'set.light')}
    ${sw('closeToTray', 'set.tray')}
    ${sw('startWithWindows', 'set.startup')}
    ${sw('alwaysOnTop', 'set.onTop')}

    <div class="section-title">${esc(T('set.sec.diag'))}</div>
    <p class="muted">${esc(T('diag.desc'))}</p>
    <div class="diag-actions">
      <button class="btn" id="diag-run">${esc(T('diag.run'))}</button>
      <button class="btn ghost" id="diag-copy">${esc(T('diag.copy'))}</button>
      <button class="btn ghost small" id="diag-clear">${esc(T('diag.clear'))}</button>
    </div>
    <div id="diag-results"></div>
    <div class="bh" style="margin-top:12px">${esc(T('diag.log'))}</div>
    <pre class="log" id="diag-log"></pre>
    <p class="muted" style="margin-top:20px">${esc(T('set.footer'))}</p>
  </div>`;
  el.querySelectorAll('[data-key]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.key;
    if (k === 'lang') { setLang(inp.value); return; }
    let v = inp.type === 'checkbox' ? inp.checked : inp.value;
    if (['historyCount', 'buildPlayers', 'overlayAutoSeconds'].includes(k)) v = Number(v);
    if (k === 'leagueDir') v = String(v).trim();
    api.setSettings({ [k]: v });
  }));
  $('#ov-test').addEventListener('click', () => api.overlayTest());
  $('#diag-run').addEventListener('click', runDiagnose);
  $('#diag-copy').addEventListener('click', copyDiagnose);
  $('#diag-clear').addEventListener('click', async () => { await api.clearLog(); refreshLog(); });
  refreshLog();
}

let lastDiag = null;
async function runDiagnose() {
  const box = $('#diag-results');
  box.innerHTML = `<p class="muted">${esc(T('diag.running'))}</p>`;
  lastDiag = await api.diagnose();
  box.innerHTML = `<table class="diag">${lastDiag.map((c) => `<tr class="${c.ok ? 'ok' : 'bad'}"><td>${c.ok ? '✔' : '✖'}</td><td>${esc(T('diag.' + c.name))}</td><td>${esc(c.detail)}</td></tr>`).join('')}</table>`;
  refreshLog();
}

async function refreshLog() {
  const el = $('#diag-log');
  if (!el) return;
  const text = await api.getLog();
  el.textContent = text || T('diag.empty');
  el.scrollTop = el.scrollHeight;
}

async function copyDiagnose() {
  if (!lastDiag) await runDiagnose();
  const info = await api.appInfo();
  const s = await api.getSettings();
  const safe = { ...s }; delete safe.leagueDir;
  const text = [
    `LoL Scout ${info.version} · Electron ${info.electron} · ${info.os} · ${LANG}`,
    '--- diagnóstico ---',
    ...(lastDiag || []).map((c) => `${c.ok ? 'OK ' : 'ERRO'} ${c.name}: ${c.detail}`),
    '--- definições ---',
    JSON.stringify(safe),
    '--- registo ---',
    await api.getLog()
  ].join('\n');
  await api.copyText(text);
  toast(T('diag.copied'));
}

// erros da interface vão para o registo
window.addEventListener('error', (e) => { if (e.message) api.reportError(`${e.message} @ ${e.filename || ''}:${e.lineno || ''}`); });
window.addEventListener('unhandledrejection', (e) => api.reportError(String(e.reason && e.reason.stack ? e.reason.stack : e.reason)));

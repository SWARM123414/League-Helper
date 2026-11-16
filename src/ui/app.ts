// Interface da janela principal: partida, builds, histórico, notas, definições
// e a moldura própria (botões de minimizar/maximizar/fechar ao estilo do cliente).
import { api } from '../app/backend.ts';
import type { UiState } from '../app/backend.ts';
import * as I18N from '../core/i18n.ts';

// ---------- idioma ----------
let LANG = 'pt';
const T = (k: string, p?: Record<string, any>): string => I18N.t(LANG, k, p);
const rankLabel = (r: any) => I18N.rankLabel(LANG, r);
const queueName = (id: number, fb?: string | null) => I18N.queueName(LANG, id, fb);
const posName = (p: string | null | undefined) => (p ? T('pos.' + p) : '');

// ---------- utilitários ----------
const $ = (s: string): any => document.querySelector(s);
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1';
const champIcon = (id: number) => (id > 0 ? `${CD}/champion-icons/${id}.png` : `${CD}/champion-icons/-1.png`);
const profileIcon = (id: number) => `${CD}/profile-icons/${id || 29}.jpg`;
let ddVersion = '14.24.1';
const itemIcon = (id: number) => `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/item/${id}.png`;
const SPELLS: Record<number, string> = { 1: 'SummonerBoost', 3: 'SummonerExhaust', 4: 'SummonerFlash', 6: 'SummonerHaste', 7: 'SummonerHeal', 11: 'SummonerSmite', 12: 'SummonerTeleport', 13: 'SummonerMana', 14: 'SummonerDot', 21: 'SummonerBarrier', 32: 'SummonerSnowball' };
const spellIcon = (id: number) => (SPELLS[id] ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/spell/${SPELLS[id]}.png` : null);
const ago = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return T('ago.min', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return T('ago.h', { n: h });
  return T('ago.d', { n: Math.round(h / 24) });
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const wrClass = (wr: number | null | undefined) => (wr === null || wr === undefined ? '' : wr >= 55 ? 'hi' : wr <= 45 ? 'lo' : '');
const numFmt = (n: number) => (n || 0).toLocaleString(LANG);
// tradução de uma mensagem que pode ser uma chave (ex.: "err.noBuild") ou texto
const tr = (msg: any) => (typeof msg === 'string' && /^[a-z]+\.[\w.]+$/.test(msg) ? T(msg) : msg);

let state: UiState | null = null;
let lastKey = '';
let currentTab = 'match';

// ---------- textos fixos da página + seletor de idioma ----------
function applyStatic() {
  document.documentElement.lang = LANG;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = T(el.dataset.i18n); });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => { el.placeholder = T(el.dataset.i18nPh); });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => { el.title = T(el.dataset.i18nTitle); });
  const sel = $('#lang-select');
  if (sel) sel.innerHTML = I18N.LANGS.map((l) => `<option value="${l.code}" ${l.code === LANG ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
}

async function setLang(code: string, save = true) {
  if (!I18N.D[code]) return;
  LANG = code;
  applyStatic();
  if (save) await api.setSettings({ lang: code });
  resetLangCaches();
  lastKey = '';
  if (state) { renderHeader(); renderMatch(); }
  showTab(currentTab);
}

// ---------- separadores ----------
function showTab(tab: string) {
  currentTab = tab;
  document.querySelectorAll<HTMLElement>('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.id === `tab-${tab}`));
  if (tab === 'history') loadHistory();
  if (tab === 'builds') loadBuildsTab();
  if (tab === 'notes') loadNotes();
  if (tab === 'settings') loadSettings();
}

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
        <li>${T('wait.hint2', { cmd: '<b>LoL Scout.exe --demo</b>' })}</li>
      </ul></div>`;
    const g = $('#go-settings'); if (g) g.addEventListener('click', (e: Event) => { e.preventDefault(); showTab('settings'); });
    return;
  }
  if (s.view === 'champselect' && s.champSelect) return renderChampSelect(el, s.champSelect);
  if ((s.view === 'game' || s.view === 'postgame') && s.game) return renderGame(el, s.game, s.view === 'postgame');
  let title: string, desc: string;
  if (s.phase === 'Matchmaking') { title = T('idle.Matchmaking.t'); desc = T('idle.Matchmaking.d'); }
  else if (s.phase === 'ReadyCheck') { title = T('idle.ReadyCheck.t'); desc = s.settings && s.settings.autoAccept ? T('idle.ReadyCheck.auto') : T('idle.ReadyCheck.manual'); }
  else if (s.phase === 'Lobby') { title = T('idle.Lobby.t'); desc = T('idle.Lobby.d'); }
  else { title = T('idle.ready.t'); desc = T('idle.ready.d'); }
  el.innerHTML = `<div class="empty"><div class="spinner"></div><h2>${esc(title)}</h2><p>${esc(desc)}</p></div>`;
}

// texto do resultado de uma importação (inclui avisos de página substituída / runas da Riot)
function importText(m: any) {
  let text = T('imp.done', { what: m.what.map((w: string) => T('imp.' + w)).join(` ${T('and')} `), champ: m.champ });
  if (m.replaced) text += ' ' + T('imp.replaced', { name: m.replaced });
  if (m.runeSource === 'riot') text += ' ' + T('imp.riot');
  return text;
}

// ---------- seleção de campeões ----------
function importMsgHtml(m: any) {
  if (!m) return '';
  const text = m.ok ? importText(m) : T('imp.err', { msg: tr(m.err) });
  return `<div class="alert ${m.ok ? 'gold' : 'enemy'}" style="margin-bottom:8px">${esc(text)}</div>`;
}

function renderChampSelect(el: HTMLElement, cs: any) {
  const ban = (b: any) => `<img src="${champIcon(b.id)}" title="${esc(b.name)}" alt="">`;
  const myChamp = cs.myChampion ? (cs.allies.find((p: any) => p.isMe) || {}).championName : null;
  for (const p of cs.enemies) if (p.championId && csExpanded.has(p.championId)) ensureChampData(p.championId);

  const ally = (p: any) => {
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
  const enemy = (p: any) => {
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
function tag(t: any) { return `<span class="tag ${t.type}" title="${esc(T('tagT.' + t.key, t.p))}">${esc(T('tag.' + t.key, t.p))}</span>`; }

function encounterText(e: any) {
  const parts: string[] = [];
  if (e.vsW + e.vsL) parts.push(T('enc.vs', { w: e.vsW, l: e.vsL }));
  if (e.withW + e.withL) parts.push(T('enc.with', { w: e.withW, l: e.withL }));
  return `⟳ ${T('enc.met', { n: e.total })} ${parts.length ? '(' + parts.join(' · ') + ')' : ''}${e.last ? ' · ' + ago(e.last) : ''}`;
}

function card(p: any) {
  const a = p.analysis;
  const side = p.ally ? 'ally' : 'enemy';
  const cls = ['card', side];
  if (p.isMe) cls.push('me');
  if (p.laneOpponent) cls.push('opp');
  if (p.mostDangerous) cls.push('danger');
  if (!a && p.puuid) cls.push('loading');

  const badges: string[] = [];
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
  const form = a && a.recentResults.length ? `<div class="form" title="${esc(T('card.formTitle'))}">${a.recentResults.map((w: boolean) => `<i class="${w ? 'w' : 'l'}"></i>`).join('')}</div>` : '';
  const tops = a && a.topChamps.length ? `<div class="top-champs"><span class="muted">${esc(T('card.mostPlayed'))}</span>${a.topChamps.map((c: any) => `<span title="${esc(T('card.champTitle', { name: c.name, n: c.games, wr: c.winrate }))}"><img src="${champIcon(c.championId)}" alt="">${c.games}</span>`).join('')}</div>` : '';

  const live = p.live ? `<div class="live"><span class="kda">${p.live.k}/${p.live.d}/${p.live.a}</span> · ${p.live.cs} CS</div>${p.live.items.length ? `<div class="items">${p.live.items.slice(0, 7).map((i: any) => `<img src="${itemIcon(i.id)}" title="${esc(i.name)}" alt="">`).join('')}</div>` : ''}` : '';
  const threat = !p.ally && p.threat !== null && p.threat !== undefined ? `<div class="threat" title="${esc(T('card.threat', { n: p.threat }))}"><div style="width:${Math.max(5, Math.min(100, p.threat))}%"></div></div>` : '';

  const links: string[] = [];
  links.push(`<a href="#" data-info="${esc(infoKey(p))}" data-champ="${p.championId}">${esc(expanded.has(infoKey(p)) ? T('card.less') : T('card.info'))}</a>`);
  if (p.puuid) links.push(`<a href="#" data-profile="${esc(p.puuid)}">${esc(T('card.profile'))}</a>`);
  if (p.puuid && !p.isMe) links.push(`<a href="#" data-note="${esc(p.puuid)}" data-name="${esc(p.name || p.championName)}" data-text="${esc(p.encounter ? p.encounter.notes : '')}">${esc(p.encounter && p.encounter.notes ? T('card.editNote') : T('card.addNote'))}</a>`);

  return `<div class="${cls.join(' ')}">
    <div class="badges">${badges.join('')}</div>
    <div class="champ">
      <img class="icon" src="${champIcon(p.championId)}" alt="">
      ${p.live && p.live.level ? `<span class="lvl">${p.live.level}</span>` : ''}
      ${p.live && p.live.isDead ? `<div class="dead">${p.live.respawn}s</div>` : ''}
      <div class="spells">${(p.spells || []).map((s: number) => (spellIcon(s) ? `<img src="${spellIcon(s)}" alt="">` : '')).join('')}</div>
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

function rankFromValue(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  if (v >= 28) return T('tier.masterPlus');
  const tiers = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
  const t = tiers[Math.floor(v / 4)];
  return t ? rankLabel({ tier: t, division: ['IV', 'III', 'II', 'I'][Math.floor(v % 4)] }) : '?';
}

function renderGame(el: HTMLElement, g: any, post: boolean) {
  if (!g.allies.length && !g.enemies.length) {
    el.innerHTML = `<div class="empty"><div class="spinner"></div><h2>${esc(T('game.loading.t'))}</h2><p>${esc(T('game.loading.d'))}</p></div>`;
    return;
  }
  const n = Math.max(g.allies.length, g.enemies.length);
  const rows: string[] = [];
  const myName = (g.allies.find((x: any) => x.isMe) || {}).championName;
  for (let i = 0; i < n; i++) {
    const a = g.allies[i];
    const e = g.enemies[i];
    const lane = a && e && a.position && a.position === e.position ? posName(a.position) : '';
    rows.push(`<div class="row">${a ? card(a) : '<div></div>'}<div class="vs"><b>VS</b>${esc(lane)}</div>${e ? card(e) : '<div></div>'}</div>`);
    const open = [a, e].filter((p) => p && expanded.has(infoKey(p)));
    if (open.length) rows.push(`<div class="info-row">${open.map((p) => champInfoPanel(p, myName)).join('')}</div>`);
  }
  const alerts: string[] = [];
  const names = (grp: string[]) => `<b>${grp.map(esc).join(' + ')}</b>`;
  for (const grp of g.premades.enemies) alerts.push(`<div class="alert enemy">⚠ ${T(grp.length === 2 ? 'alert.enemyDuo' : 'alert.enemyPremade', { names: names(grp) })}</div>`);
  for (const grp of g.premades.allies) alerts.push(`<div class="alert ally">${T(grp.length === 2 ? 'alert.allyDuo' : 'alert.allyPremade', { names: names(grp) })}</div>`);
  const opp = g.enemies.find((p: any) => p.laneOpponent);
  if (opp && opp.analysis) {
    const a = opp.analysis;
    const bits = [T('alert.vsYou', { champ: `<b>${esc(opp.championName)}</b>` }) + (opp.name ? ` (${esc(opp.name)})` : '')];
    if (a.rank.solo) bits.push(esc(rankLabel(a.rank.solo)));
    if (a.champion) bits.push(esc(a.champion.games ? T('alert.champGames', { n: a.champion.games, wr: a.champion.winrate }) : T('alert.champNone')));
    alerts.unshift(`<div class="alert gold">🎯 ${bits.join(' · ')}</div>`);
  }
  const danger = g.enemies.find((p: any) => p.mostDangerous);
  if (danger) alerts.push(`<div class="alert enemy">☠ ${T('alert.danger', { name: `<b>${esc(danger.name || danger.championName)}</b>`, champ: esc(danger.championName) })}</div>`);
  const weak = g.enemies.find((p: any) => p.weakest);
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
    <div class="champ-strip">${s.champs.slice(0, 8).map((c: any) => `<div><img src="${champIcon(c.championId)}" alt=""><div><b>${esc(c.name)}</b><div class="sub">${esc(T('card.games', { n: c.games }))} · <b class="${wrClass(c.winrate)}">${c.winrate}%</b> · KDA ${esc(c.kda)}</div></div></div>`).join('')}</div>
    <div class="section-title">${esc(T('hist.games'))} <span class="muted">${esc(T('hist.click'))}</span></div>
    <div id="games">${h.games.map(gameRow).join('')}</div>`;
  el.querySelectorAll('.game').forEach((row: HTMLElement) => row.addEventListener('click', () => toggleDetails(row)));
}

// linha de jogo reutilizada no histórico e no perfil
function gameRow(g: any) {
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

async function toggleDetails(row: HTMLElement) {
  const next = row.nextElementSibling;
  if (next && next.classList.contains('details')) { next.remove(); return; }
  const box = document.createElement('div');
  box.className = 'details';
  box.textContent = T('card.loading');
  row.after(box);
  const d = await api.gameDetails(row.dataset.game);
  if (!d) { box.textContent = T('hist.detErr'); return; }
  const teams = [100, 200].map((t) => d.players.filter((p: any) => p.teamId === t));
  box.innerHTML = teams.map((team) => `<table>
    <tr><th>${team[0] && team[0].win ? `<span style="color:var(--good)">${esc(T('hist.win'))}</span>` : `<span style="color:var(--bad)">${esc(T('hist.loss'))}</span>`}</th><th>${esc(T('th.kda'))}</th><th>${esc(T('th.cs'))}</th><th>${esc(T('th.dmg'))}</th><th>${esc(T('th.gold'))}</th><th>${esc(T('th.vision'))}</th><th>${esc(T('th.items'))}</th></tr>
    ${team.map((p: any) => `<tr class="${p.isMe ? 'me' : ''} ${p.win ? 'team-w' : 'team-l'}">
      <td><img src="${champIcon(p.championId)}" alt=""> ${esc(p.name || p.championName)}${p.tag ? ` <span class="muted">#${esc(p.tag)}</span>` : ''}</td>
      <td>${p.k}/${p.d}/${p.a}</td><td>${p.cs}</td><td>${numFmt(p.damage)}</td><td>${numFmt(p.gold)}</td><td>${p.vision ?? '-'}</td>
      <td>${p.items.map((i: number) => `<img src="${itemIcon(i)}" alt="">`).join('')}</td></tr>`).join('')}
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

let notePuuid: string | null = null;
let noteName: string | null = null;
function openNote(puuid: string, name: string, text: string) {
  notePuuid = puuid; noteName = name;
  $('#modal-title').textContent = T('modal.title', { name });
  $('#modal-text').value = text;
  $('#modal').classList.remove('hidden');
  $('#modal-text').focus();
}

// ---------- definições ----------
const HOTKEYS = ['Ctrl+Shift+Z', 'Alt+Z', 'Ctrl+Shift+X', 'Alt+X', 'F9', 'F10', 'F11', 'Ctrl+Tab'];

async function loadSettings() {
  const s = await api.getSettings();
  const el = $('#tab-settings');
  const sw = (key: string, k: string) => `<div class="setting"><div><h4>${esc(T(k))}</h4><p>${esc(T(k + 'D'))}</p></div>
    <label class="switch"><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}><span></span></label></div>`;
  const sel = (key: string, k: string, opts: [string | number, string][], cur: unknown) => `<div class="setting"><div><h4>${esc(T(k))}</h4><p>${esc(T(k + 'D'))}</p></div>
    <select data-key="${key}">${opts.map(([v, label]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>`;
  const num = (arr: number[]) => arr.map((n): [number, string] => [n, String(n)]);
  el.innerHTML = `<div class="settings">
    <div class="section-title">${esc(T('set.sec.general'))}</div>
    ${sel('lang', 'set.lang', I18N.LANGS.map((l): [string, string] => [l.code, l.name]), LANG)}
    ${sw('autoAccept', 'set.autoAccept')}
    ${sw('notifyDanger', 'set.notify')}
    ${sel('historyCount', 'set.history', num([10, 20, 30, 50]), s.historyCount)}
    <div class="setting"><div><h4>${esc(T('set.dir'))}</h4><p>${esc(T('set.dirD'))}</p></div>
      <input type="text" data-key="leagueDir" value="${esc(s.leagueDir || '')}" placeholder="${esc(T('set.dirPh'))}"></div>

    <div class="section-title">${esc(T('set.sec.overlay'))}</div>
    ${sw('overlay', 'set.overlay')}
    ${sel('overlayKey', 'set.overlayKey', HOTKEYS.map((k): [string, string] => [k, k]), s.overlayKey)}
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
  el.querySelectorAll('[data-key]').forEach((inp: HTMLInputElement) => inp.addEventListener('change', () => {
    const k = inp.dataset.key;
    if (k === 'lang') { setLang(inp.value); return; }
    let v: string | number | boolean = inp.type === 'checkbox' ? inp.checked : inp.value;
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

let lastDiag: { name: string; ok: boolean; detail: string }[] | null = null;
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
  const safe: Record<string, unknown> = { ...s }; delete safe.leagueDir;
  const text = [
    `LoL Scout ${info.version} · Tauri ${info.tauri} · ${info.os} · ${LANG}`,
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

// =====================================================================
// Builds, informação dos campeões e dicas da partida.

const expanded = new Set<string>();
const csExpanded = new Set<number>();
const champInfoCache: Record<number, any> = {};
const enemyBuildCache: Record<number, any> = {};
let buildOpen = true;

// carrega (uma vez) a info e a build de alto elo de um campeão
function ensureChampData(champId: number) {
  if (!champInfoCache[champId]) {
    champInfoCache[champId] = 'loading';
    api.champInfo(champId).then((d) => { champInfoCache[champId] = d || 'error'; rerender(); });
  }
  if (enemyBuildCache[champId] === undefined) {
    enemyBuildCache[champId] = 'loading';
    api.getBuild(champId, null).then((b) => { enemyBuildCache[champId] = b || null; rerender(); });
  }
}

function toggleCsInfo(champId: number) {
  if (csExpanded.has(champId)) csExpanded.delete(champId); else csExpanded.add(champId);
  ensureChampData(champId);
  rerender();
}

function infoKey(p: any) { return `${p.ally ? 'a' : 'e'}:${p.puuid || p.championId}`; }

function toggleInfo(key: string, champId: number) {
  if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
  ensureChampData(champId);
  rerender();
}
function rerender() { lastKey = ''; renderMatch(); }

// chamado quando o idioma muda: os nomes vêm noutro idioma
function resetLangCaches() {
  for (const k of Object.keys(champInfoCache)) delete champInfoCache[k];
  for (const k of Object.keys(enemyBuildCache)) delete enemyBuildCache[k];
  champList = [];
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string, ok = true) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${ok ? '' : 'err'}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 5000);
}

async function doImport(champId: number, role: string | null, what: string) {
  toast(T('b.importing'));
  const r = await api.importBuild(champId, role, what);
  if (r.ok) toast(importText(r));
  else toast(T('imp.err', { msg: tr(r.err) }), false);
}

// ---------- painel de composição + dicas ----------
function compPanel(comp: any) {
  if (!comp || !comp.enemy) return '';
  const bar = (c: any, label: string, cls: string) => `<div class="comp-line"><span class="comp-label ${cls}">${label}</span>
    <div class="comp-bar"><div class="ad" style="width:${c.adPct}%">${c.adPct >= 15 ? `AD ${c.adPct}%` : ''}</div><div class="ap" style="width:${c.apPct}%">${c.apPct >= 15 ? `AP ${c.apPct}%` : ''}</div></div></div>`;
  return `<div class="panel">
    <div class="panel-title">${esc(T('comp.title'))}</div>
    ${bar(comp.ally, esc(T('comp.ally')), 'a')}
    ${bar(comp.enemy, esc(T('comp.enemy')), 'e')}
    <ul class="tips">${comp.tips.map((t: any) => `<li><span>${t.icon}</span>${esc(T(t.key, t.p))}</li>`).join('')}</ul>
  </div>`;
}

// ---------- info do campeão (habilidades, dicas, build do jogador) ----------
// resumo da build de alto elo de um campeão (runa principal, itens, botas, feitiços)
function miniBuild(b: any) {
  if (b === 'loading') return `<span class="muted">${esc(T('card.loading'))}</span>`;
  if (!b) return `<span class="muted">${esc(T('ci.likelyNone'))}</span>`;
  const ks = b.runes && b.runes.perkInfo[0];
  const img = (x: any) => `<div class="it" title="${esc(x.name)} · ${esc(T('b.used', { pick: x.pick, wr: x.wr }))}"><img src="${x.icon}" alt=""><small>${x.pick}%</small></div>`;
  return `<div class="mini-build">
    ${ks ? `<div class="rune big" title="${esc(T('ci.keystone'))}">${ks.icon ? `<img src="${ks.icon}" alt="">` : ''}<span>${esc(ks.name)}</span></div>` : ''}
    <div class="item-row">${b.core.map(img).join('')}${b.boots.slice(0, 1).map(img).join('')}</div>
    ${b.spells[0] ? `<div class="item-row">${b.spells[0].ids.map((id: number) => (spellIcon(id) ? `<img class="sp-ic" src="${spellIcon(id)}" alt="">` : '')).join('')}</div>` : ''}
  </div><div class="sub">${esc(T('b.games', { n: b.games }))} · ${b.winrate}% ${esc(T('b.wins'))}</div>`;
}

function vsBlock(p: any, myChampName: string | null) {
  const r = p.vsRecord;
  if (!r) return '';
  const has = r.all.w + r.all.l;
  const lines = has ? [T('vs.all', r.all)] : [];
  if (r.lane.w + r.lane.l) lines.push(T('vs.lane', r.lane));
  if (myChampName && r.laneMine.w + r.laneMine.l) lines.push(T('vs.laneMine', { ...r.laneMine, mine: myChampName }));
  return `<div class="ci-sec"><div class="ci-h">${esc(T('vs.record', { champ: p.championName }))}</div>
    ${has ? `<div class="vs-rec">${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</div>` : `<span class="muted">${esc(T('vs.none', { champ: p.championName }))}</span>`}</div>`;
}

function champInfoPanel(p: any, myChampName: string | null) {
  const d = champInfoCache[p.championId];
  const side = p.ally ? 'ally' : 'enemy';
  if (!d || d === 'loading') return `<div class="cinfo ${side}"><span class="muted">${esc(T('ci.loading', { champ: p.championName }))}</span></div>`;
  if (d === 'error') return `<div class="cinfo ${side}"><span class="muted">${esc(T('ci.err', { champ: p.championName }))}</span></div>`;
  const a = p.analysis;
  const dmg = d.damageType === 'AD' ? T('ci.ad') : d.damageType === 'AP' ? T('ci.ap') : '';
  const diff = d.info && d.info.difficulty ? ` · ${T('ci.diff', { n: d.info.difficulty })}` : '';
  const tips = p.ally ? d.allytips : d.enemytips;
  const personal = a && a.champItems && a.champItems.length
    ? `<div class="ci-sec"><div class="ci-h">${esc(T('ci.personal', { name: p.name || T('ci.thisPlayer'), champ: d.name }))}</div>
       <div class="item-row">${a.champItems.map((it: any) => `<div class="it"><img src="${itemIcon(it.id)}" alt=""><small>${it.pct}%</small></div>`).join('')}</div></div>` : '';
  return `<div class="cinfo ${side}">
    <div class="ci-head"><img src="${champIcon(d.id)}" alt=""><div><b>${esc(d.name)}</b> <span class="muted">${esc(d.title)}</span>
      <div class="sub">${esc(dmg)} · ${esc((d.tags || []).join(', '))}${diff}${d.partype ? ' · ' + esc(d.partype) : ''}</div></div></div>
    <div class="spells-list">
      ${d.passive ? `<div class="ab"><img src="${d.passive.icon}" alt=""><div><b>${esc(T('ci.passive'))} — ${esc(d.passive.name)}</b><p>${esc(d.passive.description)}</p></div></div>` : ''}
      ${d.spells.map((s: any) => `<div class="ab"><img src="${s.icon}" alt=""><div><b>${s.key} — ${esc(s.name)}</b> <span class="cd">⏱ ${esc(s.cooldown)}s</span><p>${esc(s.description)}</p></div></div>`).join('')}
    </div>
    ${tips && tips.length ? `<div class="ci-sec"><div class="ci-h">${esc(T(p.ally ? 'ci.tipsAlly' : 'ci.tipsEnemy'))}</div><ul class="tips">${tips.map((t: string) => `<li><span>•</span>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${personal}
    ${!p.ally ? vsBlock(p, myChampName) : ''}
    ${!p.ally ? `<div class="ci-sec"><div class="ci-h">${esc(T('ci.likely'))}</div>${miniBuild(enemyBuildCache[p.championId])}</div>` : ''}
  </div>`;
}

// ---------- build ----------
function renderBuild(b: any, { compact = false, importable = true } = {}) {
  if (!b) return `<p class="muted">${esc(T('b.none'))}</p>`;
  const whyText = (x: any) => (x.why && x.why.length ? ' · ' + x.why.map((w: any) => T(w.key, w.p)).join(' · ') : '');
  const it = (x: any, extra = '') => `<div class="it" title="${esc(x.name)}${x.pick !== undefined ? ' · ' + esc(T('b.used', { pick: x.pick, wr: x.wr })) : ''}${esc(whyText(x))}"><img src="${x.icon}" alt="">${x.pick !== undefined ? `<small>${x.pick}%</small>` : ''}${extra}</div>`;
  const r = b.runes;
  const rname = (ri: any) => (ri.shard ? T('shard.' + ri.id) : ri.name);
  const rune = (ri: any, big = false) => `<div class="rune ${big ? 'big' : ''}" title="${esc(rname(ri))}${ri.shortDesc ? ' — ' + esc(ri.shortDesc) : ''}">${ri.icon ? `<img src="${ri.icon}" alt="">` : ''}<span>${esc(rname(ri))}</span></div>`;
  const runes = r ? `<div class="bsec"><div class="bh">${esc(T('b.runes'))} <span class="muted">· ${esc(T('b.keystone', { pick: r.keystonePick, wr: r.keystoneWr }))}</span></div>
    <div class="runes">
      <div class="tree"><div class="tree-name">${r.primaryStyle.icon ? `<img src="${r.primaryStyle.icon}" alt="">` : ''}${esc(r.primaryStyle.name)}</div>${r.perkInfo.slice(0, 4).map((x: any, i: number) => rune(x, i === 0)).join('')}</div>
      <div class="tree"><div class="tree-name">${r.subStyle.icon ? `<img src="${r.subStyle.icon}" alt="">` : ''}${esc(r.subStyle.name)}</div>${r.perkInfo.slice(4).map((x: any) => rune(x)).join('')}
        <div class="shards">${r.shardInfo.map((x: any) => `<span>${esc(rname(x))}</span>`).join('')}</div></div>
    </div></div>` : '';
  const spells = b.spells.length ? `<div class="bsec"><div class="bh">${esc(T('b.spells'))}</div><div class="item-row">${b.spells.map((s: any) => `<div class="it sp">${s.ids.map((id: number) => (spellIcon(id) ? `<img src="${spellIcon(id)}" alt="">` : '')).join('')}<small>${s.pick}% · ${s.wr}%${esc(T('b.wShort'))}</small></div>`).join('')}</div></div>` : '';
  const det = b.details;
  const skills = det && det.skillOrder ? `<div class="bsec"><div class="bh">${esc(T('b.skills'))} <span class="muted">· ${esc(T('b.max', { order: det.skillOrder }))}</span></div>
    <div class="skill-grid">${['Q', 'W', 'E', 'R'].map((k) => `<div class="sk-row"><b>${k}</b>${det.skillSeq.map((x: string) => `<i class="${x === k ? 'on' : ''}">${x === k ? k : ''}</i>`).join('')}</div>`).join('')}</div></div>`
    : `<div class="bsec"><div class="bh">${esc(T('b.skills'))}</div><span class="muted">${esc(T('b.analyzing'))}</span></div>`;
  const starting = det && det.starting.length ? `<div class="bgroup"><div class="bh">${esc(T('b.start'))}</div><div class="item-row">${det.starting.map((x: any) => it(x)).join('')}</div></div>` : '';
  const items = `<div class="bsec items-sec">
    ${starting}
    <div class="bgroup"><div class="bh">${esc(T('b.core'))}</div><div class="item-row core">${b.core.map((x: any, i: number) => it(x) + (i < b.core.length - 1 ? '<span class="arrow">›</span>' : '')).join('')}</div></div>
    ${b.forMatch && b.forMatch.length ? `<div class="bgroup formatch"><div class="bh">${esc(T('mu.forMatch'))}${b.vs ? ' · vs ' + esc(b.vs.name) : ''}</div><div class="item-row">${b.forMatch.map((x: any) => it(x)).join('')}</div></div>` : ''}
    ${b.boots.length ? `<div class="bgroup"><div class="bh">${esc(T('b.boots'))}</div><div class="item-row">${b.boots.map((x: any) => it(x)).join('')}</div></div>` : ''}
    ${b.situational.length ? `<div class="bgroup"><div class="bh">${esc(T('b.situational'))}</div><div class="item-row">${b.situational.map((x: any) => it(x)).join('')}</div></div>` : ''}
  </div>`;
  const role = b.requestedRole || (b.role !== 'ALL' ? b.role : '');
  const imp = importable ? `<div class="import">
    <button class="btn" data-import="${b.championId}|${role}|both">${esc(T('b.import'))}</button>
    <button class="btn ghost small" data-import="${b.championId}|${role}|runes">${esc(T('b.onlyRunes'))}</button>
    <button class="btn ghost small" data-import="${b.championId}|${role}|items">${esc(T('b.onlyItems'))}</button>
  </div>` : '';
  const patchTxt = b.patch ? ` · ${esc(T(b.patchesUsed && b.patchesUsed.length > 1 ? 'b.patchMix' : 'b.patch', { p: b.patch }))}` : '';
  const small = b.smallSample ? `<div class="warn small-sample">⚠ ${esc(T('b.small', { n: b.games }))}</div>` : '';
  const src = `${small}<div class="bmeta">${esc(T('b.games', { n: b.games }))}${patchTxt}${b.region ? ' (' + esc(b.region) + ')' : ''} · <b class="${wrClass(b.winrate)}">${b.winrate}%</b> ${esc(T('b.wins'))}${b.role === 'ALL' && b.requestedRole ? ` · <span class="warn">${esc(T('b.fewRole'))}</span>` : ''}</div>`;
  // motivos da build contra o adversário
  const reasons: string[] = [];
  for (const x of b.forMatch || []) reasons.push(`<li><img src="${x.icon}" alt=""><b>${esc(x.name)}</b> — ${esc(x.why.map((w: any) => T(w.key, w.p)).join(' · '))}</li>`);
  if (b.bootsWhy && b.boots[0]) reasons.push(`<li><img src="${b.boots[0].icon}" alt=""><b>${esc(b.boots[0].name)}</b> — ${esc(T(b.bootsWhy.key, b.bootsWhy.p))}</li>`);
  if (b.startWhy) reasons.push(`<li><span>🛡</span>${esc(T(b.startWhy.key, b.startWhy.p))}</li>`);
  for (const t of b.tips || []) reasons.push(`<li><span>💡</span>${esc(T(t.key, t.p))}</li>`);
  const why = reasons.length ? `<div class="bsec why"><div class="bh">${esc(T('mu.why'))}</div><ul>${reasons.join('')}</ul></div>` : '';
  return `<div class="build ${compact ? 'compact' : ''}">${src}${items}${why}<div class="bcols">${runes}<div>${spells}${skills}</div></div>${imp}</div>`;
}

// ---------- separador Builds ----------
let champList: any[] = [];
let selChamp: number | null = null;
let selRole: string | null = null;

async function renderBuildStatus() {
  const el = $('#build-status');
  if (!el) return;
  const s = await api.buildsStatus();
  const prog = s.running && s.total ? Math.round((s.done / s.total) * 100) : null;
  el.innerHTML = `<div>${esc(T('b.status', { games: s.games.toLocaleString(LANG), champs: s.champions }))}${s.region ? ' · ' + esc(s.region) : ''}${s.updated ? ' · ' + esc(T('b.updated', { ago: ago(s.updated) })) : ''}
    ${s.running ? ` · <span class="warn">${esc(T('b.collecting', { done: s.done, total: s.total }))}</span>` : ''}${s.error ? ` · <span class="bad">${esc(tr(s.error))}</span>` : ''}</div>
    <button class="btn small ghost" id="collect-now" ${s.running ? 'disabled' : ''}>${esc(T('b.refresh'))}</button>
    ${prog !== null ? `<div class="loadbar full"><div style="width:${prog}%"></div></div>` : ''}`;
  const btn = $('#collect-now');
  if (btn) btn.addEventListener('click', async () => {
    if (!state || state.status !== 'connected') { toast(T('b.needClient'), false); return; }
    await api.collectNow(); renderBuildStatus();
  });
}

async function loadBuildsTab() {
  const el = $('#tab-builds');
  if (!$('#build-layout') || el.dataset.lang !== LANG) {
    el.dataset.lang = LANG;
    el.innerHTML = `<div class="build-status" id="build-status"></div>
      <div class="build-layout" id="build-layout">
        <div class="champ-pick"><input type="text" id="champ-search" placeholder="${esc(T('b.search'))}"><div id="champ-list"></div></div>
        <div id="build-view"><div class="empty"><h2>${esc(T('b.pick.t'))}</h2><p>${esc(T('b.pick.d1'))}</p><p>${esc(T('b.pick.d2'))}</p></div></div>
      </div>`;
    $('#champ-search').addEventListener('input', renderChampList);
  }
  renderBuildStatus();
  champList = await api.champions();
  if (state && state.champSelect && state.champSelect.myChampion && !selChamp) selChamp = state.champSelect.myChampion;
  renderChampList();
  if (selChamp) showBuild(selChamp, selRole);
}

function renderChampList() {
  const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = norm($('#champ-search').value || '');
  const list = champList.filter((c) => norm(c.name).includes(q));
  $('#champ-list').innerHTML = list.length ? list.map((c) => `<div class="cp ${c.id === selChamp ? 'sel' : ''} ${c.hasBuild ? '' : 'nodata'}" data-c="${c.id}" title="${c.hasBuild ? '' : esc(T('b.noChampData'))}"><img src="${champIcon(c.id)}" alt=""><span>${esc(c.name)}</span></div>`).join('')
    : `<p class="muted">${esc(T('b.noChamps'))}</p>`;
  $('#champ-list').querySelectorAll('.cp').forEach((d: HTMLElement) => d.addEventListener('click', () => { selRole = null; showBuild(Number(d.dataset.c), null); renderChampList(); }));
}

async function showBuild(champId: number, role: string | null) {
  selChamp = champId; selRole = role;
  const view = $('#build-view');
  const c = champList.find((x) => x.id === champId);
  let b = await api.getBuild(champId, role);
  const draw = () => {
    if (!b) {
      view.innerHTML = `<div class="build-head"><img src="${champIcon(champId)}" alt=""><h2>${esc(c ? c.name : '')}</h2></div>
        <p class="muted">${esc(T('b.noData'))}</p>`;
      return;
    }
    const roles = b.roles.filter((r: any) => r.games >= 3);
    view.innerHTML = `<div class="build-head"><img src="${champIcon(champId)}" alt=""><h2>${esc(b.championName)}</h2>
      <div class="role-chips">${roles.map((r: any) => `<button class="chip ${b.role === r.role ? 'on' : ''}" data-role="${r.role}">${esc(posName(r.role))} <small>${r.games}</small></button>`).join('')}</div>
      </div>
      ${renderBuild(b, { importable: true })}`;
    view.querySelectorAll('[data-role]').forEach((x: HTMLElement) => x.addEventListener('click', () => showBuild(champId, x.dataset.role)));
  };
  draw();
  if (b && !b.details) {
    const d = await api.buildDetails(champId, role);
    if (selChamp === champId && selRole === role && d) { b = d; draw(); }
  }
}

// ---------- perfil do jogador (dentro da app) ----------
async function openProfile(puuid: string) {
  const m = $('#profile');
  const box = $('#profile-body');
  m.classList.remove('hidden');
  box.innerHTML = `<div class="empty"><div class="spinner"></div><p>${esc(T('prof.loading'))}</p></div>`;
  const p = await api.playerProfile(puuid);
  if (!p) { box.innerHTML = `<p class="muted">${esc(T('prof.err'))}</p>`; return; }
  const q = (r: any, key: string) => (r ? `<div class="tile"><div class="k">${esc(T(key))}</div><div class="v t-${r.tier}">${esc(rankLabel(r))} <small>${r.lp} LP</small></div><div class="sub">${r.winrate}% · ${esc(T('card.wl', { w: r.wins, l: r.losses }))}</div></div>`
    : `<div class="tile"><div class="k">${esc(T(key))}</div><div class="v t-NONE">${esc(T('card.unranked'))}</div></div>`);
  box.innerHTML = `
    <div class="prof-head">
      <img src="${profileIcon(p.iconId)}" alt="">
      <div><h2>${esc(p.name || '?')} <small class="muted">#${esc(p.tag || '')}</small></h2>
        <div class="sub">${esc(T('me.level', { n: p.level || '?' }))}${p.mainRole ? ' · ' + esc(T('prof.role')) + ': ' + esc(posName(p.mainRole)) : ''}</div>
        ${p.tags.length ? `<div class="tags">${p.tags.map(tag).join('')}</div>` : ''}
        ${p.encounter && p.encounter.total ? `<div class="encounter">${esc(encounterText(p.encounter))}</div>` : ''}
        ${p.encounter && p.encounter.notes ? `<div class="note">📝 ${esc(p.encounter.notes)}</div>` : ''}
      </div>
    </div>
    <div class="tiles">
      ${q(p.rank.solo, 'queue.solo')}
      ${q(p.rank.flex, 'queue.flex')}
      <div class="tile"><div class="k">${esc(T('prof.recent', { n: p.recent.games }))}</div><div class="v ${wrClass(p.recent.winrate)}">${p.recent.winrate ?? '—'}${p.recent.winrate !== null ? '%' : ''} <small>KDA ${esc(p.recent.kda || '—')}</small></div></div>
      <div class="tile"><div class="k">${esc(T('hist.streak'))}</div><div class="v">${p.streak.type ? esc(T(p.streak.type === 'win' ? 'hist.wins' : 'hist.losses', { n: p.streak.count })) : '—'}</div></div>
    </div>
    ${p.champs.length ? `<div class="section-title">${esc(T('prof.champs'))}</div>
    <div class="champ-strip">${p.champs.map((c) => `<div><img src="${champIcon(c.championId)}" alt=""><div><b>${esc(c.name)}</b><div class="sub">${esc(T('card.games', { n: c.games }))} · <b class="${wrClass(c.winrate)}">${c.winrate}%</b> · KDA ${esc(c.kda)}</div></div></div>`).join('')}</div>` : ''}
    <div class="section-title">${esc(T('hist.games'))} <span class="muted">${esc(T('hist.click'))}</span></div>
    ${p.games.length ? p.games.map(gameRow).join('') : `<p class="muted">${esc(T('prof.none'))}</p>`}`;
  box.querySelectorAll('.game').forEach((row: HTMLElement) => row.addEventListener('click', () => toggleDetails(row)));
}

// =====================================================================
// Moldura da janela (sem a barra do Windows): botões ao estilo do cliente do LoL

async function initTitlebar() {
  $('#win-min').addEventListener('click', () => api.minimize());
  $('#win-max').addEventListener('click', () => api.toggleMaximize());
  $('#win-close').addEventListener('click', () => api.close());
  const sync = async () => document.body.classList.toggle('maximized', await api.isMaximized());
  await api.onResized(() => { sync(); });
  sync();
}

// =====================================================================
// Arranque da interface

export function initUI(): void {
  fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json()).then((v) => { if (v && v[0]) ddVersion = v[0]; }).catch(() => {});

  // Imagens que falham (sem internet / ícone novo) ficam como um quadrado vazio
  document.addEventListener('error', (e) => {
    const t = e.target as HTMLImageElement;
    if (t && t.tagName === 'IMG' && !t.dataset.failed) {
      t.dataset.failed = '1';
      t.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#1e2d3d"/></svg>');
    }
  }, true);

  initTitlebar();
  $('#lang-select').addEventListener('change', (e: Event) => setLang((e.target as HTMLSelectElement).value));
  api.getSettings().then((s) => { setLang((s && s.lang) || 'pt', false); });

  document.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // Cliques: importar, info do campeão, perfil, notas (a app não abre links externos)
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const pr = target.closest<HTMLElement>('[data-profile]');
    if (pr) { e.preventDefault(); openProfile(pr.dataset.profile); return; }
    const ci = target.closest<HTMLElement>('[data-csinfo]');
    if (ci) { e.preventDefault(); toggleCsInfo(Number(ci.dataset.csinfo)); return; }
    const imp = target.closest<HTMLElement>('[data-import]');
    if (imp) { e.preventDefault(); const [c, r, w] = imp.dataset.import.split('|'); doImport(Number(c), r || null, w); return; }
    const inf = target.closest<HTMLElement>('[data-info]');
    if (inf) { e.preventDefault(); toggleInfo(inf.dataset.info, Number(inf.dataset.champ)); return; }
    const n = target.closest<HTMLElement>('[data-note]');
    if (n) { e.preventDefault(); openNote(n.dataset.note, n.dataset.name, n.dataset.text || ''); return; }
    // nenhum link sai da app
    const a = target.closest('a');
    if (a) e.preventDefault();
  });

  api.onState((s) => {
    state = s;
    if (s.settings && s.settings.lang && s.settings.lang !== LANG) { LANG = s.settings.lang; applyStatic(); lastKey = ''; }
    renderHeader();
    const key = JSON.stringify([s.view, s.status, s.phase, s.champSelect, s.game, s.error]);
    if (key !== lastKey) { lastKey = key; renderMatch(); }
  });

  api.onBuildsStatus(() => { if ($('#tab-builds').classList.contains('active')) renderBuildStatus(); });

  $('#modal-cancel').addEventListener('click', () => $('#modal').classList.add('hidden'));
  $('#modal-save').addEventListener('click', async () => {
    await api.setNote(notePuuid, noteName, $('#modal-text').value);
    $('#modal').classList.add('hidden');
    lastKey = '';
    if ($('#tab-notes').classList.contains('active')) loadNotes();
  });
  $('#profile-close').addEventListener('click', () => $('#profile').classList.add('hidden'));
  $('#profile').addEventListener('click', (e: Event) => { if ((e.target as HTMLElement).id === 'profile') $('#profile').classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#profile').classList.add('hidden'); });

  // erros da interface vão para o registo
  window.addEventListener('error', (e) => { if (e.message) api.reportError(`${e.message} @ ${e.filename || ''}:${e.lineno || ''}`); });
  window.addEventListener('unhandledrejection', (e) => api.reportError(String(e.reason && e.reason.stack ? e.reason.stack : e.reason)));
}

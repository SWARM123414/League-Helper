/* global importText, api, $, esc, champIcon, spellIcon, posName, ago, wrClass, state, renderMatch, lastKey, T, tr, itemIcon, rankLabel, gameRow, toggleDetails, encounterText, tag */
'use strict';
// Builds, informação dos campeões e dicas da partida.

const expanded = new Set();
const csExpanded = new Set();
const champInfoCache = {};
const enemyBuildCache = {};
let buildOpen = true;

// carrega (uma vez) a info e a build de alto elo de um campeão
function ensureChampData(champId) {
  if (!champInfoCache[champId]) {
    champInfoCache[champId] = 'loading';
    api.champInfo(champId).then((d) => { champInfoCache[champId] = d || 'error'; rerender(); });
  }
  if (enemyBuildCache[champId] === undefined) {
    enemyBuildCache[champId] = 'loading';
    api.getBuild(champId, null).then((b) => { enemyBuildCache[champId] = b || null; rerender(); });
  }
}

function toggleCsInfo(champId) {
  if (csExpanded.has(champId)) csExpanded.delete(champId); else csExpanded.add(champId);
  ensureChampData(champId);
  rerender();
}

function infoKey(p) { return `${p.ally ? 'a' : 'e'}:${p.puuid || p.championId}`; }

function toggleInfo(key, champId) {
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

function toast(msg, ok = true) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${ok ? '' : 'err'}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 5000);
}

async function doImport(champId, role, what) {
  toast(T('b.importing'));
  const r = await api.importBuild(champId, role, what);
  if (r.ok) toast(importText(r));
  else toast(T('imp.err', { msg: tr(r.err) }), false);
}

// ---------- painel de composição + dicas ----------
function compPanel(comp) {
  if (!comp || !comp.enemy) return '';
  const bar = (c, label, cls) => `<div class="comp-line"><span class="comp-label ${cls}">${label}</span>
    <div class="comp-bar"><div class="ad" style="width:${c.adPct}%">${c.adPct >= 15 ? `AD ${c.adPct}%` : ''}</div><div class="ap" style="width:${c.apPct}%">${c.apPct >= 15 ? `AP ${c.apPct}%` : ''}</div></div></div>`;
  return `<div class="panel">
    <div class="panel-title">${esc(T('comp.title'))}</div>
    ${bar(comp.ally, esc(T('comp.ally')), 'a')}
    ${bar(comp.enemy, esc(T('comp.enemy')), 'e')}
    <ul class="tips">${comp.tips.map((t) => `<li><span>${t.icon}</span>${esc(T(t.key, t.p))}</li>`).join('')}</ul>
  </div>`;
}

// ---------- info do campeão (habilidades, dicas, build do jogador) ----------
// resumo da build de alto elo de um campeão (runa principal, itens, botas, feitiços)
function miniBuild(b) {
  if (b === 'loading') return `<span class="muted">${esc(T('card.loading'))}</span>`;
  if (!b) return `<span class="muted">${esc(T('ci.likelyNone'))}</span>`;
  const ks = b.runes && b.runes.perkInfo[0];
  const img = (x) => `<div class="it" title="${esc(x.name)} · ${esc(T('b.used', { pick: x.pick, wr: x.wr }))}"><img src="${x.icon}" alt=""><small>${x.pick}%</small></div>`;
  return `<div class="mini-build">
    ${ks ? `<div class="rune big" title="${esc(T('ci.keystone'))}">${ks.icon ? `<img src="${ks.icon}" alt="">` : ''}<span>${esc(ks.name)}</span></div>` : ''}
    <div class="item-row">${b.core.map(img).join('')}${b.boots.slice(0, 1).map(img).join('')}</div>
    ${b.spells[0] ? `<div class="item-row">${b.spells[0].ids.map((id) => (spellIcon(id) ? `<img class="sp-ic" src="${spellIcon(id)}" alt="">` : '')).join('')}</div>` : ''}
  </div><div class="sub">${esc(T('b.games', { n: b.games }))} · ${b.winrate}% ${esc(T('b.wins'))}</div>`;
}

function vsBlock(p, myChampName) {
  const r = p.vsRecord;
  if (!r) return '';
  const has = r.all.w + r.all.l;
  const lines = has ? [T('vs.all', r.all)] : [];
  if (r.lane.w + r.lane.l) lines.push(T('vs.lane', r.lane));
  if (myChampName && r.laneMine.w + r.laneMine.l) lines.push(T('vs.laneMine', { ...r.laneMine, mine: myChampName }));
  return `<div class="ci-sec"><div class="ci-h">${esc(T('vs.record', { champ: p.championName }))}</div>
    ${has ? `<div class="vs-rec">${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</div>` : `<span class="muted">${esc(T('vs.none', { champ: p.championName }))}</span>`}</div>`;
}

function champInfoPanel(p, myChampName) {
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
       <div class="item-row">${a.champItems.map((it) => `<div class="it"><img src="${itemIcon(it.id)}" alt=""><small>${it.pct}%</small></div>`).join('')}</div></div>` : '';
  return `<div class="cinfo ${side}">
    <div class="ci-head"><img src="${champIcon(d.id)}" alt=""><div><b>${esc(d.name)}</b> <span class="muted">${esc(d.title)}</span>
      <div class="sub">${esc(dmg)} · ${esc((d.tags || []).join(', '))}${diff}${d.partype ? ' · ' + esc(d.partype) : ''}</div></div></div>
    <div class="spells-list">
      ${d.passive ? `<div class="ab"><img src="${d.passive.icon}" alt=""><div><b>${esc(T('ci.passive'))} — ${esc(d.passive.name)}</b><p>${esc(d.passive.description)}</p></div></div>` : ''}
      ${d.spells.map((s) => `<div class="ab"><img src="${s.icon}" alt=""><div><b>${s.key} — ${esc(s.name)}</b> <span class="cd">⏱ ${esc(s.cooldown)}s</span><p>${esc(s.description)}</p></div></div>`).join('')}
    </div>
    ${tips && tips.length ? `<div class="ci-sec"><div class="ci-h">${esc(T(p.ally ? 'ci.tipsAlly' : 'ci.tipsEnemy'))}</div><ul class="tips">${tips.map((t) => `<li><span>•</span>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${personal}
    ${!p.ally ? vsBlock(p, myChampName) : ''}
    ${!p.ally ? `<div class="ci-sec"><div class="ci-h">${esc(T('ci.likely'))}</div>${miniBuild(enemyBuildCache[p.championId])}</div>` : ''}
  </div>`;
}


// ---------- build ----------
function renderBuild(b, { compact = false, importable = true } = {}) {
  if (!b) return `<p class="muted">${esc(T('b.none'))}</p>`;
  const whyText = (x) => (x.why && x.why.length ? ' · ' + x.why.map((w) => T(w.key, w.p)).join(' · ') : '');
  const it = (x, extra = '') => `<div class="it" title="${esc(x.name)}${x.pick !== undefined ? ' · ' + esc(T('b.used', { pick: x.pick, wr: x.wr })) : ''}${esc(whyText(x))}"><img src="${x.icon}" alt="">${x.pick !== undefined ? `<small>${x.pick}%</small>` : ''}${extra}</div>`;
  const r = b.runes;
  const rname = (ri) => (ri.shard ? T('shard.' + ri.id) : ri.name);
  const rune = (ri, big) => `<div class="rune ${big ? 'big' : ''}" title="${esc(rname(ri))}${ri.shortDesc ? ' — ' + esc(ri.shortDesc) : ''}">${ri.icon ? `<img src="${ri.icon}" alt="">` : ''}<span>${esc(rname(ri))}</span></div>`;
  const runes = r ? `<div class="bsec"><div class="bh">${esc(T('b.runes'))} <span class="muted">· ${esc(T('b.keystone', { pick: r.keystonePick, wr: r.keystoneWr }))}</span></div>
    <div class="runes">
      <div class="tree"><div class="tree-name">${r.primaryStyle.icon ? `<img src="${r.primaryStyle.icon}" alt="">` : ''}${esc(r.primaryStyle.name)}</div>${r.perkInfo.slice(0, 4).map((x, i) => rune(x, i === 0)).join('')}</div>
      <div class="tree"><div class="tree-name">${r.subStyle.icon ? `<img src="${r.subStyle.icon}" alt="">` : ''}${esc(r.subStyle.name)}</div>${r.perkInfo.slice(4).map((x) => rune(x)).join('')}
        <div class="shards">${r.shardInfo.map((x) => `<span>${esc(rname(x))}</span>`).join('')}</div></div>
    </div></div>` : '';
  const spells = b.spells.length ? `<div class="bsec"><div class="bh">${esc(T('b.spells'))}</div><div class="item-row">${b.spells.map((s) => `<div class="it sp">${s.ids.map((id) => (spellIcon(id) ? `<img src="${spellIcon(id)}" alt="">` : '')).join('')}<small>${s.pick}% · ${s.wr}%${esc(T('b.wShort'))}</small></div>`).join('')}</div></div>` : '';
  const det = b.details;
  const skills = det && det.skillOrder ? `<div class="bsec"><div class="bh">${esc(T('b.skills'))} <span class="muted">· ${esc(T('b.max', { order: det.skillOrder }))}</span></div>
    <div class="skill-grid">${['Q', 'W', 'E', 'R'].map((k) => `<div class="sk-row"><b>${k}</b>${det.skillSeq.map((x) => `<i class="${x === k ? 'on' : ''}">${x === k ? k : ''}</i>`).join('')}</div>`).join('')}</div></div>`
    : `<div class="bsec"><div class="bh">${esc(T('b.skills'))}</div><span class="muted">${esc(T('b.analyzing'))}</span></div>`;
  const starting = det && det.starting.length ? `<div class="bgroup"><div class="bh">${esc(T('b.start'))}</div><div class="item-row">${det.starting.map((x) => it(x)).join('')}</div></div>` : '';
  const items = `<div class="bsec items-sec">
    ${starting}
    <div class="bgroup"><div class="bh">${esc(T('b.core'))}</div><div class="item-row core">${b.core.map((x, i) => it(x) + (i < b.core.length - 1 ? '<span class="arrow">›</span>' : '')).join('')}</div></div>
    ${b.forMatch && b.forMatch.length ? `<div class="bgroup formatch"><div class="bh">${esc(T('mu.forMatch'))}${b.vs ? ' · vs ' + esc(b.vs.name) : ''}</div><div class="item-row">${b.forMatch.map((x) => it(x)).join('')}</div></div>` : ''}
    ${b.boots.length ? `<div class="bgroup"><div class="bh">${esc(T('b.boots'))}</div><div class="item-row">${b.boots.map((x) => it(x)).join('')}</div></div>` : ''}
    ${b.situational.length ? `<div class="bgroup"><div class="bh">${esc(T('b.situational'))}</div><div class="item-row">${b.situational.map((x) => it(x)).join('')}</div></div>` : ''}
  </div>`;
  const imp = importable ? `<div class="import">
    <button class="btn" data-import="${b.championId}|${b.requestedRole || (b.role !== 'ALL' ? b.role : '')}|both">${esc(T('b.import'))}</button>
    <button class="btn ghost small" data-import="${b.championId}|${b.requestedRole || (b.role !== 'ALL' ? b.role : '')}|runes">${esc(T('b.onlyRunes'))}</button>
    <button class="btn ghost small" data-import="${b.championId}|${b.requestedRole || (b.role !== 'ALL' ? b.role : '')}|items">${esc(T('b.onlyItems'))}</button>
  </div>` : '';
  const patchTxt = b.patch ? ` · ${esc(T(b.patchesUsed && b.patchesUsed.length > 1 ? 'b.patchMix' : 'b.patch', { p: b.patch }))}` : '';
  const small = b.smallSample ? `<div class="warn small-sample">⚠ ${esc(T('b.small', { n: b.games }))}</div>` : '';
  const src = `${small}<div class="bmeta">${esc(T('b.games', { n: b.games }))}${patchTxt}${b.region ? ' (' + esc(b.region) + ')' : ''} · <b class="${wrClass(b.winrate)}">${b.winrate}%</b> ${esc(T('b.wins'))}${b.role === 'ALL' && b.requestedRole ? ` · <span class="warn">${esc(T('b.fewRole'))}</span>` : ''}</div>`;
  // motivos da build contra o adversário
  const reasons = [];
  for (const x of b.forMatch || []) reasons.push(`<li><img src="${x.icon}" alt=""><b>${esc(x.name)}</b> — ${esc(x.why.map((w) => T(w.key, w.p)).join(' · '))}</li>`);
  if (b.bootsWhy && b.boots[0]) reasons.push(`<li><img src="${b.boots[0].icon}" alt=""><b>${esc(b.boots[0].name)}</b> — ${esc(T(b.bootsWhy.key, b.bootsWhy.p))}</li>`);
  if (b.startWhy) reasons.push(`<li><span>🛡</span>${esc(T(b.startWhy.key, b.startWhy.p))}</li>`);
  for (const t of b.tips || []) reasons.push(`<li><span>💡</span>${esc(T(t.key, t.p))}</li>`);
  const why = reasons.length ? `<div class="bsec why"><div class="bh">${esc(T('mu.why'))}</div><ul>${reasons.join('')}</ul></div>` : '';
  return `<div class="build ${compact ? 'compact' : ''}">${src}${items}${why}<div class="bcols">${runes}<div>${spells}${skills}</div></div>${imp}</div>`;
}

// ---------- separador Builds ----------
let champList = [];
let selChamp = null;
let selRole = null;

api.onBuildsStatus(() => { if ($('#tab-builds').classList.contains('active')) renderBuildStatus(); });

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
  const q = ($('#champ-search').value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = champList.filter((c) => c.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
  $('#champ-list').innerHTML = list.length ? list.map((c) => `<div class="cp ${c.id === selChamp ? 'sel' : ''} ${c.hasBuild ? '' : 'nodata'}" data-c="${c.id}" title="${c.hasBuild ? '' : esc(T('b.noChampData'))}"><img src="${champIcon(c.id)}" alt=""><span>${esc(c.name)}</span></div>`).join('')
    : `<p class="muted">${esc(T('b.noChamps'))}</p>`;
  $('#champ-list').querySelectorAll('.cp').forEach((d) => d.addEventListener('click', () => { selRole = null; showBuild(Number(d.dataset.c), null); renderChampList(); }));
}

async function showBuild(champId, role) {
  selChamp = champId; selRole = role;
  const view = $('#build-view');
  const c = champList.find((x) => x.id === champId);
  let b = await api.getBuild(champId, role);
  const draw = () => {
    if (!b) {
      view.innerHTML = `<div class="build-head"><img src="${champIcon(champId)}" alt=""><h2>${esc(c ? c.name : '')}</h2></div>
        <p class="muted">${esc(T('b.noData'))}</p>
`;
      return;
    }
    const roles = b.roles.filter((r) => r.games >= 3);
    view.innerHTML = `<div class="build-head"><img src="${champIcon(champId)}" alt=""><h2>${esc(b.championName)}</h2>
      <div class="role-chips">${roles.map((r) => `<button class="chip ${b.role === r.role ? 'on' : ''}" data-role="${r.role}">${esc(posName(r.role))} <small>${r.games}</small></button>`).join('')}</div>
      </div>
      ${renderBuild(b, { importable: true })}`;
    view.querySelectorAll('[data-role]').forEach((x) => x.addEventListener('click', () => showBuild(champId, x.dataset.role)));
  };
  draw();
  if (b && !b.details) {
    const d = await api.buildDetails(champId, role);
    if (selChamp === champId && selRole === role && d) { b = d; draw(); }
  }
}

// ---------- perfil do jogador (dentro da app) ----------
async function openProfile(puuid) {
  const m = $('#profile');
  const box = $('#profile-body');
  m.classList.remove('hidden');
  box.innerHTML = `<div class="empty"><div class="spinner"></div><p>${esc(T('prof.loading'))}</p></div>`;
  const p = await api.playerProfile(puuid);
  if (!p) { box.innerHTML = `<p class="muted">${esc(T('prof.err'))}</p>`; return; }
  const q = (r, key) => (r ? `<div class="tile"><div class="k">${esc(T(key))}</div><div class="v t-${r.tier}">${esc(rankLabel(r))} <small>${r.lp} LP</small></div><div class="sub">${r.winrate}% · ${esc(T('card.wl', { w: r.wins, l: r.losses }))}</div></div>`
    : `<div class="tile"><div class="k">${esc(T(key))}</div><div class="v t-NONE">${esc(T('card.unranked'))}</div></div>`);
  box.innerHTML = `
    <div class="prof-head">
      <img src="https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${p.iconId || 29}.jpg" alt="">
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
  box.querySelectorAll('.game').forEach((row) => row.addEventListener('click', () => toggleDetails(row)));
}

$('#profile-close').addEventListener('click', () => $('#profile').classList.add('hidden'));
$('#profile').addEventListener('click', (e) => { if (e.target.id === 'profile') $('#profile').classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#profile').classList.add('hidden'); });

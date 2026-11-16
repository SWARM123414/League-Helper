// Overlay dentro do jogo: só redesenha quando chegam dados novos (no máximo a cada 3 s).
import './ui/overlay.css';
import { emitTo, listen } from '@tauri-apps/api/event';
import * as I18N from './core/i18n.ts';

const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1';
const icon = (id: number) => `${CD}/champion-icons/${id > 0 ? id : -1}.png`;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let last = '';

function render(d: any) {
  const key = JSON.stringify(d);
  if (key === last) return; // nada mudou: não toca no ecrã
  last = key;
  const T = (k: string, p?: Record<string, any>) => I18N.t(d.lang || 'pt', k, p);
  const el = document.getElementById('ov');
  const g = d.game;
  const head = `<div class="hd">LOL SCOUT <small>${esc(T('ov.hide', { key: d.hotkey || '' }))}</small></div>`;
  if (!g) { el.innerHTML = head + `<div class="muted">${esc(T('ov.noGame'))}</div>`; return; }

  let html = head;
  const b = g.build;
  if (b) {
    const img = (x: any, cls = '') => `<img class="${cls}" src="${esc(x.icon)}" title="${esc(x.name)}" alt="">`;
    html += `<div class="sec">${esc(b.vs ? T('mu.title', { champ: b.vs }) : T('ov.build'))}</div>
      <div class="items">${b.core.map((x: any) => img(x)).join('<span class="ar">›</span>')}${b.forMatch.length ? '<span class="ar">+</span>' + b.forMatch.map((x: any) => img(x, 'fm')).join('') : ''}${b.boots.map((x: any) => img(x)).join('')}</div>
      ${b.skillOrder ? `<div class="skill">${esc(T('b.max', { order: b.skillOrder }))}</div>` : ''}`;
  }
  html += `<div class="sec">${esc(T('ov.enemies'))}</div>`;
  for (const p of g.enemies) {
    const badges: string[] = [];
    if (p.laneOpponent) badges.push(`<span class="bd opp">${esc(T('badge.opp'))}</span>`);
    if (p.mostDangerous) badges.push(`<span class="bd dg">${esc(T('badge.danger'))}</span>`);
    if (p.weakest) badges.push(`<span class="bd wk">${esc(T('badge.weak'))}</span>`);
    if (p.premade) badges.push(`<span class="bd duo">${esc(T(p.premade.size === 2 ? 'badge.duo' : 'badge.premade'))} ${p.premade.group}</span>`);
    const rank = p.rank ? `<span class="t-${p.rank.tier}">${esc(I18N.rankLabel(d.lang, p.rank))}</span>${p.winrate !== null ? ` · ${p.winrate}%` : ''}` : '<span class="muted">—</span>';
    const tags = p.tags.map((t: any) => `<span class="tg ${t.type === 'good' ? 'g' : ''}">${esc(T('tag.' + t.key, t.p))}</span>`).join(' · ');
    const live = p.live ? (p.live.isDead ? `<span class="dead">${esc(T('ov.dead', { s: p.live.respawn }))}</span>` : `${p.live.k}/${p.live.d}/${p.live.a}`) : '';
    html += `<div class="en ${p.laneOpponent ? 'opp' : ''}">
      <img src="${icon(p.championId)}" alt="">
      <div class="nm">${badges.join('')}<b>${esc(p.championName)}</b> <small>${esc(p.name || '')}</small><br>${rank}${tags ? ' · ' + tags : ''}</div>
      <div class="st">${live}${p.ultCd ? `<br><span class="ult">R ${esc(p.ultCd)}s</span>` : ''}</div>
    </div>`;
  }
  if (g.tips.length) html += `<div class="sec">${esc(T('comp.title'))}</div>` + g.tips.map((t: any) => `<div class="tip">${t.icon} ${esc(T(t.key, t.p))}</div>`).join('');
  el.innerHTML = html;
}

// ícones que falham (sem internet) ficam como um quadrado escuro
document.addEventListener('error', (e) => {
  const t = e.target as HTMLImageElement;
  if (t && t.tagName === 'IMG' && !t.dataset.failed) {
    t.dataset.failed = '1';
    t.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#1e2d3d"/></svg>');
  }
}, true);

listen('overlay', (e) => render(e.payload)).then(() => emitTo('main', 'overlay-ready'));

// Dados estáticos do jogo (campeões, habilidades, itens, runas) da Data Dragon da Riot,
// no idioma da app. Ficam guardados em cache no disco para funcionar mesmo sem internet.

import { platform } from './platform.ts';

const DD = 'https://ddragon.leagueoflegends.com';

export type FetchJson = (url: string) => Promise<any>;

async function defaultFetch(url: string): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

export const stripHtml = (s: unknown): string => String(s || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/\{\{[^}]+\}\}/g, '?')
  .replace(/&nbsp;/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// Itens com Feridas Dolorosas (antecura)
const ANTIHEAL = new Set([3123, 3033, 3165, 3916, 3075, 3076, 6609, 3011, 8020, 3302]);

export const SHARDS = new Set([5008, 5005, 5007, 5010, 5001, 5011, 5013, 5002, 5003]);

// Heurísticas para as dicas da partida (id da Data Dragon)
const HEALERS = new Set(['Aatrox', 'Soraka', 'Vladimir', 'Sylas', 'Yuumi', 'Warwick', 'DrMundo', 'Fiddlesticks', 'Swain', 'Nami', 'Sona', 'Briar', 'Illaoi', 'Olaf', 'Trundle', 'Samira', 'Senna', 'Renekton', 'Volibear', 'Nasus', 'Zac', 'Seraphine', 'Milio', 'Gwen', 'Irelia', 'Viego', 'Belveth', 'Mordekaiser', 'Kayn', 'Darius', 'Sett', 'Yone', 'Ambessa']);
const STEALTH = new Set(['Evelynn', 'Twitch', 'Shaco', 'Rengar', 'Khazix', 'Akshan', 'Pyke', 'MonkeyKing', 'Talon', 'Vayne', 'Teemo', 'Senna', 'KogMaw', 'Wukong', 'Qiyana', 'Neeko']);
const HARD_CC = new Set(['Leona', 'Nautilus', 'Amumu', 'Sejuani', 'Malphite', 'Lissandra', 'Morgana', 'Thresh', 'Blitzcrank', 'Rell', 'Alistar', 'Rakan', 'Maokai', 'Zac', 'Ornn', 'Annie', 'Veigar', 'Lux', 'Ashe', 'Jarvan IV', 'JarvanIV', 'Vi', 'Skarner', 'Galio', 'Sion', 'Rammus', 'Taric', 'Braum', 'Zyra', 'Neeko', 'Seraphine', 'Cassiopeia', 'Pantheon', 'Wukong', 'MonkeyKing']);

export interface Champ { id: number; key: string; name: string; title: string; tags: string[]; info: Record<string, number>; range: number | null }
export interface Style { id: number; name: string; icon?: string; slots?: number[][] }
export interface Rune { id: number; name: string | null; icon?: string; shortDesc?: string; styleId?: number; shard?: boolean }

export interface Composition {
  adPct: number; apPct: number; tanks: number; tankNames: string[]; heal: number; healers: string[]; stealth: number; stealthy: string[]; cc: number;
}

export class GameData {
  useCache: boolean;
  fetchJson: FetchJson;
  lang: string;
  ready = false;
  version: string | null = null;
  champs: Record<number, Champ> = {};
  items: Record<number, any> = {};
  styles: Record<number, Style> = {};
  runes: Record<number, Rune> = {};
  details: Record<number, any> = {};
  private loading: Promise<boolean> | null = null;

  constructor({ useCache = false, fetchJson = defaultFetch, lang = 'pt_BR' }: { useCache?: boolean; fetchJson?: FetchJson; lang?: string } = {}) {
    this.useCache = useCache;
    this.fetchJson = fetchJson;
    this.lang = lang;
  }

  // Muda o idioma dos dados (nomes de campeões, habilidades, itens, runas)
  setLang(lang: string): Promise<boolean> {
    if (lang === this.lang) return this.load();
    this.lang = lang;
    this.ready = false;
    this.details = {};
    this.loading = null;
    return this.load();
  }

  private async readCache(name: string): Promise<any> {
    if (!this.useCache) return null;
    try { const t = await platform().readData(`ddragon/${name}`); return t ? JSON.parse(t) : null; } catch { return null; }
  }

  private writeCache(name: string, data: unknown): void {
    if (!this.useCache) return;
    platform().writeData(`ddragon/${name}`, JSON.stringify(data)).catch(() => { /* sem cache */ });
  }

  load(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    if (!this.loading) this.loading = this.doLoad().finally(() => { this.loading = null; });
    return this.loading;
  }

  private async doLoad(): Promise<boolean> {
    let version: string | null = null;
    try { version = (await this.fetchJson(`${DD}/api/versions.json`))[0]; } catch { /* offline */ }
    let pack = null;
    if (version) {
      pack = await this.readCache(`static-${version}-${this.lang}.json`);
      if (!pack) {
        try {
          const base = `${DD}/cdn/${version}/data/${this.lang}`;
          const [champion, item, runes] = await Promise.all([
            this.fetchJson(`${base}/champion.json`), this.fetchJson(`${base}/item.json`), this.fetchJson(`${base}/runesReforged.json`)
          ]);
          pack = { version, champion, item, runes };
          this.writeCache(`static-${version}-${this.lang}.json`, pack);
          this.writeCache(`static-latest-${this.lang}.json`, pack);
        } catch { pack = null; }
      }
    }
    if (!pack) pack = await this.readCache(`static-latest-${this.lang}.json`);
    if (!pack) return false;
    this.ingest(pack);
    return true;
  }

  ingest({ version, champion, item, runes }: { version: string; champion: any; item: any; runes: any[] }): void {
    this.version = version;
    this.champs = {};
    for (const c of Object.values<any>(champion.data || {})) {
      this.champs[Number(c.key)] = { id: Number(c.key), key: c.id, name: c.name, title: c.title, tags: c.tags || [], info: c.info || {}, range: (c.stats && c.stats.attackrange) || null };
    }
    this.items = {};
    for (const [id, it] of Object.entries(item.data || {})) this.items[Number(id)] = it;
    this.styles = {};
    this.runes = {};
    for (const st of runes || []) {
      this.styles[st.id] = { id: st.id, name: st.name, icon: `${DD}/cdn/img/${st.icon}`, slots: st.slots.map((s: any) => s.runes.map((r: any) => r.id)) };
      for (const s of st.slots) for (const r of s.runes) {
        this.runes[r.id] = { id: r.id, name: r.name, icon: `${DD}/cdn/img/${r.icon}`, shortDesc: stripHtml(r.shortDesc), styleId: st.id };
      }
    }
    this.ready = true;
  }

  // ---------- itens ----------
  item(id: number): any { return this.items[id] || null; }
  itemName(id: number): string { const it = this.items[id]; return it ? it.name : `Item ${id}`; }
  itemIcon(id: number): string { return `${DD}/cdn/${this.version || '14.24.1'}/img/item/${id}.png`; }
  isBoots(id: number): boolean {
    const it = this.items[id];
    return !!(it && (it.tags || []).includes('Boots') && it.depth >= 2);
  }
  isCompleted(id: number): boolean {
    const it = this.items[id];
    if (!it) return false;
    if (this.isBoots(id)) return true;
    const tags = it.tags || [];
    if (tags.includes('Consumable') || tags.includes('Trinket')) return false;
    if (it.maps && it.maps['11'] === false) return false;
    if (it.into && it.into.length) return false;
    return (it.gold && it.gold.total >= 2000) || it.depth >= 3;
  }
  isStarter(id: number): boolean {
    const it = this.items[id];
    if (!it) return false;
    const tags = it.tags || [];
    return (it.gold && it.gold.total <= 500) && !tags.includes('Trinket');
  }

  itemHas(id: number, tag: string): boolean { const it = this.items[id]; return !!(it && (it.tags || []).includes(tag)); }
  isAntiHeal(id: number): boolean { return ANTIHEAL.has(Number(id)); }

  // ---------- runas ----------
  rune(id: number): Rune { return this.runes[id] || (SHARDS.has(id) ? { id, name: null, shard: true } : { id, name: `#${id}` }); }
  style(id: number): Style { return this.styles[id] || { id, name: `#${id}` }; }

  // ---------- campeões ----------
  champ(id: number): Champ | null { return this.champs[id] || null; }
  champList() {
    return Object.values(this.champs).map((c) => ({ id: c.id, name: c.name, key: c.key, tags: c.tags })).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }

  isRanged(id: number): boolean | null {
    const c = this.champs[id];
    if (!c) return null;
    if (c.range) return c.range >= 300;
    return c.tags.includes('Marksman') || (c.tags.includes('Mage') && !c.tags.includes('Fighter'));
  }

  damageType(id: number): 'AD' | 'AP' | null {
    const c = this.champs[id];
    if (!c) return null;
    const { attack = 5, magic = 5 } = c.info;
    if (magic >= attack + 2) return 'AP';
    if (attack >= magic + 2) return 'AD';
    return attack >= magic ? 'AD' : 'AP';
  }

  async champion(id: number): Promise<any> {
    if (this.details[id]) return this.details[id];
    await this.load();
    const c = this.champs[id];
    if (!c) return null;
    const name = `champ-${this.version}-${this.lang}-${c.key}.json`;
    let raw = await this.readCache(name);
    if (!raw) {
      try {
        const r = await this.fetchJson(`${DD}/cdn/${this.version}/data/${this.lang}/champion/${c.key}.json`);
        raw = r.data[c.key];
        this.writeCache(name, raw);
      } catch { return null; }
    }
    const keys = ['Q', 'W', 'E', 'R'];
    const det = {
      id, key: c.key, name: raw.name, title: raw.title, tags: raw.tags || [], info: raw.info || {},
      damageType: this.damageType(id),
      partype: raw.partype,
      allytips: raw.allytips || [],
      enemytips: raw.enemytips || [],
      passive: raw.passive ? { name: raw.passive.name, description: stripHtml(raw.passive.description), icon: `${DD}/cdn/${this.version}/img/passive/${raw.passive.image.full}` } : null,
      spells: (raw.spells || []).map((s: any, i: number) => ({
        key: keys[i], name: s.name, cooldown: s.cooldownBurn, cost: s.costBurn, range: s.rangeBurn,
        description: stripHtml(s.description), icon: `${DD}/cdn/${this.version}/img/spell/${s.image.full}`
      })),
      stats: raw.stats || {}
    };
    this.details[id] = det;
    return det;
  }

  // ---------- análise da composição ----------
  composition(champIds: number[]): Composition {
    let ad = 0, ap = 0, tanks = 0, heal = 0, stealth = 0, cc = 0;
    const healers: string[] = [], stealthy: string[] = [], tankNames: string[] = [];
    for (const id of champIds) {
      const c = this.champs[id];
      if (!c) continue;
      const a = c.info.attack || 5, m = c.info.magic || 5;
      ad += a; ap += m;
      if (c.tags.includes('Tank')) { tanks++; tankNames.push(c.name); }
      if (HEALERS.has(c.key)) { heal++; healers.push(c.name); }
      if (STEALTH.has(c.key)) { stealth++; stealthy.push(c.name); }
      if (HARD_CC.has(c.key) || HARD_CC.has(c.name)) cc++;
    }
    const total = ad + ap || 1;
    return { adPct: Math.round((ad / total) * 100), apPct: Math.round((ap / total) * 100), tanks, tankNames, heal, healers, stealth, stealthy, cc };
  }
}

export interface Tip { icon: string; key: string; p: Record<string, any> }

// Dicas a partir da composição inimiga (devolve chaves de tradução)
export function matchTips(enemyComp: Composition | null, allyComp: Composition | null): Tip[] {
  const tips: Tip[] = [];
  if (!enemyComp) return tips;
  const add = (icon: string, key: string, p: Record<string, any> = {}) => tips.push({ icon, key, p });
  if (enemyComp.adPct >= 65) add('🛡', 'tip.physical', { pct: enemyComp.adPct });
  else if (enemyComp.apPct >= 60) add('🔮', 'tip.magic', { pct: enemyComp.apPct });
  else add('⚖', 'tip.balanced', { ad: enemyComp.adPct, ap: enemyComp.apPct });
  if (enemyComp.heal >= 2) add('🩸', 'tip.healMany', { names: enemyComp.healers.join(', ') });
  else if (enemyComp.heal === 1) add('🩸', 'tip.healOne', { name: enemyComp.healers[0] });
  if (enemyComp.tanks >= 2) add('🪨', 'tip.tanks', { n: enemyComp.tanks, names: enemyComp.tankNames.join(', ') });
  if (enemyComp.stealth >= 1) add('👁', 'tip.stealth', { names: enemyComp.stealthy.join(', ') });
  if (enemyComp.cc >= 3) add('⛓', 'tip.cc');
  if (allyComp) {
    if (allyComp.adPct >= 70) add('⚠', 'tip.allyAD', { pct: allyComp.adPct });
    if (allyComp.apPct >= 70) add('⚠', 'tip.allyAP', { pct: allyComp.apPct });
    if (allyComp.tanks === 0) add('ℹ', 'tip.noTank');
  }
  return tips;
}

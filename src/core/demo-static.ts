// Dados estáticos mínimos para o modo demo funcionar sem internet.
export const ARCH: Record<string, any> = {
  mage: { role: 'MIDDLE', items: [6655, 3157, 3089, 4645, 3135, 3165], boots: [3020], start: [1056, 2003, 2003], spells: [4, 14], skills: 'QWEQQRQWQWRWWEEREE',
    page: { primary: 8100, sub: 8200, perks: [8112, 8139, 8138, 8106, 8226, 8210], shards: [5008, 5008, 5011] } },
  adc: { role: 'BOTTOM', items: [6672, 3031, 3094, 3036, 3072, 3046], boots: [3006], start: [1055, 2003], spells: [4, 7], skills: 'QWEQQRQWQWRWWEEREE',
    page: { primary: 8000, sub: 8100, perks: [8008, 9111, 9104, 8014, 8139, 8135], shards: [5005, 5008, 5011] } },
  bruiser: { role: 'TOP', items: [3071, 3053, 6333, 3074, 6610, 3026], boots: [3047, 3111], start: [1055, 2003], spells: [4, 12], skills: 'QEWQQRQEQERWEWWRWW',
    page: { primary: 8000, sub: 8400, perks: [8010, 9111, 9105, 8299, 8444, 8451], shards: [5005, 5008, 5011] } },
  jungle: { role: 'JUNGLE', items: [6692, 3071, 6333, 3142, 6694, 3026], boots: [3047, 3111], start: [1101, 2003], spells: [11, 4], skills: 'QWEQQRQEQERWEWWRWW',
    page: { primary: 8000, sub: 8100, perks: [8010, 9111, 9104, 8014, 8143, 8105], shards: [5008, 5008, 5011] } },
  support: { role: 'UTILITY', items: [3190, 3109, 3050, 2065, 3107, 3222], boots: [3111, 3047], start: [3865, 2003, 2003], spells: [4, 14], skills: 'QWEEERERWEWRWWQQQQ',
    page: { primary: 8400, sub: 8300, perks: [8439, 8463, 8473, 8242, 8345, 8347], shards: [5007, 5010, 5011] } }
};

export const CHAMP_ARCH: Record<number, string> = {
  103: 'mage', 99: 'mage', 517: 'mage', 245: 'mage', 876: 'jungle', 84: 'mage', 238: 'bruiser',
  222: 'adc', 145: 'adc', 51: 'adc', 81: 'adc', 21: 'adc', 22: 'adc', 236: 'adc', 360: 'adc', 498: 'adc',
  266: 'bruiser', 122: 'bruiser', 114: 'bruiser', 39: 'bruiser', 92: 'bruiser', 86: 'bruiser', 24: 'bruiser', 157: 'bruiser',
  64: 'jungle', 104: 'jungle', 141: 'jungle', 59: 'jungle',
  412: 'support', 89: 'support', 111: 'support', 432: 'support', 117: 'support', 25: 'support', 497: 'support'
};

const CHAMP_INFO: Record<string, any> = {
  mage: { attack: 2, magic: 9, tags: ['Mage', 'Assassin'] }, adc: { attack: 9, magic: 2, tags: ['Marksman'] },
  bruiser: { attack: 8, magic: 2, tags: ['Fighter'] }, jungle: { attack: 7, magic: 3, tags: ['Fighter', 'Assassin'] },
  support: { attack: 3, magic: 6, tags: ['Support', 'Tank'] }
};

const ITEM_NAMES: Record<number, string> = {
  6655: "Companheiro de Luden", 3157: 'Ampulheta de Zhonya', 3089: 'Capuz da Morte de Rabadon', 4645: 'Chama Sombria', 3135: 'Cajado do Vazio', 3165: 'Morellonomicon',
  6672: 'Mata-Cráquens', 3031: 'Gume do Infinito', 3094: 'Canhão Fumegante', 3036: 'Lembranças do Lorde Dominik', 3072: 'Sedenta por Sangue', 3046: 'Dançarina Fantasma',
  3071: 'Cutelo Negro', 3053: 'Manopla de Sterak', 6333: 'Dança da Morte', 3074: 'Hidra Raivosa', 6610: 'Céu Partido', 3026: 'Anjo Guardião',
  6692: 'Eclipse', 3142: 'Lâmina Fantasma de Youmuu', 6694: 'Rancor de Serylda',
  3190: 'Medalhão dos Solari de Ferro', 3109: 'Juramento do Cavaleiro', 3050: 'Convergência de Zeke', 2065: 'Hino Bélico de Shurelya', 3107: 'Redenção', 3222: 'Bênção de Mikael',
  3020: 'Sapatos do Feiticeiro', 3006: 'Grevas do Berserker', 3047: 'Botas Galvanizadas de Aço', 3111: 'Botas de Mercúrio',
  1056: 'Anel de Doran', 1055: 'Lâmina de Doran', 1054: 'Escudo de Doran', 2003: 'Poção de Vida', 3865: 'Atlas Mundial', 1101: 'Filhote de Pirarranha', 1102: 'Filhote de Pássaro-Brisa', 1103: 'Filhote de Musgalope',
  2055: 'Sentinela de Controlo', 3340: 'Totem Sentinela', 1001: 'Botas'
};

const RUNE_TREES = [
  { id: 8000, name: 'Precisão', slots: [[8005, 8008, 8021, 8010], [9101, 9111, 8009], [9104, 9105, 9103], [8014, 8017, 8299]] },
  { id: 8100, name: 'Dominação', slots: [[8112, 8128, 9923], [8126, 8139, 8143], [8136, 8120, 8138], [8135, 8105, 8106]] },
  { id: 8200, name: 'Feitiçaria', slots: [[8214, 8229, 8230], [8224, 8226, 8275], [8210, 8234, 8233], [8237, 8232, 8236]] },
  { id: 8300, name: 'Inspiração', slots: [[8351, 8360, 8369], [8306, 8304, 8321], [8313, 8352, 8345], [8347, 8410, 8316]] },
  { id: 8400, name: 'Determinação', slots: [[8437, 8439, 8465], [8446, 8463, 8401], [8429, 8444, 8473], [8451, 8453, 8242]] }
];
const RUNE_NAMES: Record<number, string> = {
  8005: 'Pressione o Ataque', 8008: 'Ritmo Fatal', 8021: 'Agilidade nos Pés', 8010: 'Conquistador', 9111: 'Triunfo', 9104: 'Lenda: Espontaneidade', 9105: 'Lenda: Fervor',
  8014: 'Golpe de Misericórdia', 8299: 'Até a Morte', 8112: 'Eletrocutar', 8139: 'Gosto de Sangue', 8143: 'Impacto Repentino', 8138: 'Coleção de Globos Oculares',
  8135: 'Caçador Voraz', 8105: 'Caçador Incansável', 8106: 'Caçador Supremo', 8226: 'Faixa de Fluxo de Mana', 8210: 'Transcendência', 8214: 'Invocar Aery',
  8345: 'Biscoitos', 8347: 'Percepção Cósmica', 8439: 'Pós-choque', 8463: 'Renovação', 8473: 'Osso Revestido', 8242: 'Inabalável', 8444: 'Fôlego', 8451: 'Crescimento Excessivo'
};

export function staticData(champs: [number, string][]) {
  const champion: any = { data: {} };
  for (const [id, name] of champs) {
    const key = name.replace(/[^A-Za-z]/g, '');
    const arch = CHAMP_INFO[CHAMP_ARCH[id] || 'bruiser'];
    const ranged = ['adc', 'mage'].includes(CHAMP_ARCH[id]) || [412, 432, 117, 25].includes(id);
    champion.data[key] = { id: key, key: String(id), name, title: 'o campeão', tags: arch.tags, info: { attack: arch.attack, magic: arch.magic, defense: 5, difficulty: 5 }, stats: { attackrange: ranged ? 550 : 175 } };
  }
  const item: any = { data: {} };
  const completed = new Set(Object.values(ARCH).flatMap((a) => a.items));
  const boots = new Set(Object.values(ARCH).flatMap((a) => a.boots));
  for (const [id, name] of Object.entries(ITEM_NAMES)) {
    const n = Number(id);
    const it: any = { name, gold: { total: 400, purchasable: true }, tags: [], maps: { 11: true }, depth: 1 };
    if (completed.has(n)) Object.assign(it, { gold: { total: 3000 }, depth: 3 });
    if (boots.has(n)) Object.assign(it, { gold: { total: 1100 }, depth: 2, tags: ['Boots'] });
    if (n === 1001) Object.assign(it, { tags: ['Boots'], into: [3006, 3020, 3047, 3111], gold: { total: 300 } });
    if (n === 2003 || n === 2055) it.tags = ['Consumable'];
    if (n === 3340) it.tags = ['Trinket'];
    const TAGS: Record<number, string[]> = { 3157: ['Armor', 'SpellDamage'], 3026: ['Armor', 'Damage'], 6333: ['Armor', 'Damage'], 3135: ['MagicPenetration', 'SpellDamage'], 3036: ['ArmorPenetration', 'Damage'],
      3071: ['ArmorPenetration', 'Health'], 3165: ['SpellDamage'], 3053: ['Health'], 6694: ['ArmorPenetration'], 3190: ['SpellBlock', 'Armor'], 3109: ['Armor', 'Health'], 3222: ['SpellBlock'], 4645: ['SpellDamage', 'MagicPenetration'] };
    if (TAGS[n]) it.tags = [...it.tags, ...TAGS[n]];
    item.data[id] = it;
  }
  const runes = RUNE_TREES.map((t) => ({
    id: t.id, key: t.name, name: t.name, icon: `perk-images/Styles/${t.id}.png`,
    slots: t.slots.map((s) => ({ runes: s.map((r) => ({ id: r, key: String(r), name: RUNE_NAMES[r] || `Runa ${r}`, icon: `perk-images/Styles/${r}.png`, shortDesc: 'Runa' })) }))
  }));
  return { champion, item, runes };
}

export function demoFetch(champs: [number, string][]) {
  const pack = staticData(champs);
  return async (url: string): Promise<any> => {
    if (url.endsWith('/api/versions.json')) return ['demo'];
    if (url.endsWith('/champion.json')) return pack.champion;
    if (url.endsWith('/item.json')) return pack.item;
    if (url.endsWith('/runesReforged.json')) return pack.runes;
    const m = /\/champion\/([A-Za-z]+)\.json$/.exec(url);
    if (m) {
      const c = pack.champion.data[m[1]];
      const ability = (k: string, cd: string) => ({ name: `${c.name} ${k}`, cooldownBurn: cd, costBurn: '50', rangeBurn: '600', description: `Habilidade ${k} de ${c.name}.`, image: { full: `${m[1]}${k}.png` } });
      return { data: { [m[1]]: { ...c, partype: 'Mana', allytips: [`Usa a ${c.name} R para acabar lutas.`], enemytips: [`Joga longe de ${c.name} quando a R estiver disponível.`, 'Pune quando falhar a Q.'],
        passive: { name: 'Passiva', description: 'Passiva do campeão.', image: { full: 'p.png' } },
        spells: [ability('Q', '7/6.5/6/5.5/5'), ability('W', '12/11/10/9/8'), ability('E', '14/13/12/11/10'), ability('R', '120/100/80')], stats: {} } } };
    }
    throw new Error('404 ' + url);
  };
}

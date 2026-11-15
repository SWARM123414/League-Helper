// Testes rápidos: node test/analyzer.test.js
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const A = require('../src/analyzer');
const { parseLockfile, parseCommandLine } = require('../src/lcu');
const { Tracker } = require('../src/tracker');
const { Store } = require('../src/store');
const { DemoLCU, demoLive, CHAMPS } = require('../src/demo');
const { GameData } = require('../src/gamedata');
const { BuildDB, importRunes, importItemSet } = require('../src/builds');
const { demoFetch } = require('../src/demo-static');
const I18N = require('../renderer/i18n');

// lockfile e linha de comandos
assert.deepStrictEqual(parseLockfile('LeagueClient:1234:54321:abcDEF_12:https'), { pid: 1234, port: 54321, password: 'abcDEF_12', protocol: 'https' });
const cmd = '"C:/Riot Games/League of Legends/LeagueClientUx.exe" "--riotclient-auth-token=x" "--app-port=61234" "--remoting-auth-token=Ab-c_9" "--install-directory=C:\\Riot Games\\League of Legends"';
const c = parseCommandLine(cmd);
assert.strictEqual(c.port, 61234);
assert.strictEqual(c.password, 'Ab-c_9');

// ranks
const r = A.parseRanked({ queueMap: { RANKED_SOLO_5x5: { tier: 'GOLD', division: 'II', leaguePoints: 40, wins: 30, losses: 20 } } });
assert.strictEqual(r.solo.tier, 'GOLD');
assert.strictEqual(r.solo.division, 'II');
assert.strictEqual(r.solo.winrate, 60);
assert.strictEqual(A.parseRanked({ queueMap: { RANKED_SOLO_5x5: { tier: 'NONE' } } }).solo, null);
assert.strictEqual(A.parseRanked(null).solo, null);

// premades
const groups = A.detectPremades([{ gameIds: [1, 2, 3] }, { gameIds: [9] }, { gameIds: [2, 3, 7] }, { gameIds: [] }]);
assert.deepStrictEqual(groups, [[0, 2]]);

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-'));
  const store = new Store(dir);
  store.setSettings({ collectBuilds: false });
  const lcu = new DemoLCU();
  const gd = new GameData({ fetchJson: demoFetch(CHAMPS) });
  assert.ok(await gd.load(), 'dados estáticos');
  assert.ok(gd.isCompleted(3157) && !gd.isCompleted(2003) && gd.isBoots(3020) && !gd.isCompleted(1001));
  const builds = new BuildDB({ lcu, gamedata: gd, dir: null });

  // ----- builds -----
  const t0 = Date.now();
  await builds.collect({ maxPlayers: 40 });
  assert.ok(!builds.status.error, builds.status.error);
  assert.strictEqual(builds.status.done, 40);
  assert.strictEqual(builds.countGames(), 800);
  console.log(`  recolha: ${builds.countGames()} jogos em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  let b = builds.getBuild(103, 'MIDDLE');
  assert.strictEqual(b.role, 'MIDDLE');
  assert.deepStrictEqual(b.core.slice(0, 2).map((x) => x.id).sort(), [3157, 6655]);
  assert.strictEqual(b.boots[0].id, 3020);
  assert.strictEqual(b.runes.perks[0], 8112, 'keystone');
  assert.deepStrictEqual(b.runes.perks.slice(4), [8226, 8210]);
  assert.deepStrictEqual(b.runes.shards, [5008, 5008, 5011]);
  assert.deepStrictEqual(b.spells[0].ids, [4, 14]);
  assert.ok(b.games > 50 && b.winrate > 0);
  b = await builds.loadDetails(103, 'MIDDLE');
  assert.deepStrictEqual(b.details.starting.map((x) => x.id), [1056, 2003, 2003]);
  assert.strictEqual(b.details.skillOrder, 'Q > W > E');
  assert.strictEqual(b.details.skillSeq.slice(0, 3).join(''), 'QWE');
  assert.deepStrictEqual(b.core.slice(0, 2).map((x) => x.id), [6655, 3157], 'ordem real de compra');
  // patches: usa o atual e junta os anteriores com menos peso
  assert.strictEqual(builds.currentPatch(), '14.23');
  assert.strictEqual(b.patch, '14.23');
  assert.ok(b.patchesUsed[0].patch === '14.23' && b.patchesUsed[0].weight === 1);
  const aram = builds.getBuild(103, 'ARAM');
  assert.ok(aram && aram.role === 'ARAM' && aram.games > 0, 'build de ARAM');
  assert.ok(builds.rolesFor(103).some((r) => r.role === 'ARAM'));
  // só guarda 3 patches
  const fake = (patch, id) => ({ gameId: id, queueId: 420, championId: 103, win: true, items: [6655], perks: [], spells: [4, 14], shards: [], date: 1, patch, lane: 'MIDDLE', role: 'SOLO' });
  builds.addGame('x', fake('14.20', 1)); builds.addGame('x', fake('14.21', 2));
  assert.deepStrictEqual(builds.patchList(), ['14.23', '14.22', '14.21']);
  // posição sem dados suficientes cai para "todas"
  const b2 = builds.getBuild(103, 'UTILITY');
  assert.ok(b2 && (b2.role === 'ALL' || b2.role === 'UTILITY'));
  // importar runas
  let ri = await importRunes(lcu, b, { gd });
  assert.strictEqual(ri.source, 'highElo');
  assert.ok(lcu.perkPages.some((p) => p.name === 'LoL Scout Ahri' && p.selectedPerkIds.length === 9 && p.primaryStyleId === 8100 && p.current));
  await importRunes(lcu, b, { gd });
  assert.strictEqual(lcu.perkPages.filter((p) => p.name.startsWith('LoL Scout')).length, 1, 'atualiza a própria página');
  await importItemSet(lcu, 1, b);
  await importItemSet(lcu, 1, b);
  assert.strictEqual(lcu.itemSets.itemSets.length, 1);
  assert.strictEqual(lcu.itemSets.itemSets[0].blocks[0].type, 'Início');
  // sem páginas livres: substitui a página atual
  const lcu2 = new DemoLCU(); lcu2.perkPages = [1, 2, 3].map((id) => ({ id, name: 'Minha ' + id, isDeletable: true, isEditable: true, current: id === 2 }));
  ri = await importRunes(lcu2, b, { gd });
  assert.strictEqual(ri.replaced, 'Minha 2');
  assert.ok(lcu2.perkPages.find((p) => p.id === 2).name.startsWith('LoL Scout') && lcu2.perkPages.length === 3);
  // runas inválidas: usa a página recomendada pela Riot
  const bad = { ...b, runes: { ...b.runes, perks: [1, 2, 3, 4, 5, 6] } };
  ri = await importRunes(lcu, bad, { gd, position: 'TOP' });
  assert.strictEqual(ri.source, 'riot');
  assert.strictEqual(lcu.perkPages.find((p) => p.name.startsWith('LoL Scout')).primaryStyleId, 8000);
  // fragmentos inválidos são corrigidos
  const { validatePage } = require('../src/builds');
  assert.deepStrictEqual(validatePage({ ...b.runes, shards: [5011, 5002, 5003] }, gd).shards, [5008, 5008, 5011]);

  const tracker = new Tracker({ lcu, live: demoLive(lcu), store, gamedata: gd, builds, interval: 10 });

  // seleção de campeões
  lcu.t0 = Date.now() - 15000;
  await tracker.tick();
  assert.strictEqual(tracker.state.view, 'champselect');
  assert.strictEqual(tracker.state.champSelect.allies.length, 5);
  await new Promise((res) => setTimeout(res, 50));
  await tracker.tick();
  const meCS = tracker.state.champSelect.allies.find((p) => p.isMe);
  assert.ok(meCS.analysis, 'análise do próprio jogador na seleção');
  assert.strictEqual(tracker.state.champSelect.myBuild.championId, 103, 'build na seleção');
  assert.ok(tracker.state.champSelect.comp.tips.length > 0);

  // jogo
  lcu.t0 = Date.now() - 60000;
  await tracker.tick();
  await new Promise((res) => setTimeout(res, 100));
  await tracker.tick();
  const g = tracker.state.game;
  assert.strictEqual(tracker.state.view, 'game');
  assert.strictEqual(g.loading, false, 'todos carregados');
  assert.strictEqual(g.enemies.length, 5);
  const opp = g.enemies.find((p) => p.laneOpponent);
  assert.strictEqual(opp.championName, 'Yasuo', 'adversário de mid');
  assert.deepStrictEqual(g.premades.enemies, [['GankMachine', 'HookCity']], 'duo inimigo');
  assert.ok(g.enemies.find((p) => p.mostDangerous).name === 'xYasuox', 'smurf é o mais perigoso');
  const yas = g.enemies.find((p) => p.name === 'xYasuox');
  assert.ok(yas.analysis.tags.some((t) => t.key === 'smurf'));
  assert.ok(yas.analysis.tags.some((t) => t.key === 'oneTrick' || t.key === 'main'));
  assert.ok(g.allies.find((p) => p.name === 'Pinguim').analysis.tags.some((t) => t.key === 'tilt'));
  assert.ok(yas.live && yas.live.cs > 0, 'dados ao vivo');
  assert.ok(g.myBuild && g.myBuild.championId === 103, 'build no jogo');
  assert.ok(g.comp && g.comp.enemy.adPct > 50 && g.comp.tips.length, 'composição');
  assert.ok(yas.analysis.champItems.length > 0, 'build pessoal do adversário');
  assert.strictEqual(yas.damageType, 'AD');
  const info = await gd.champion(157);
  assert.strictEqual(info.spells.length, 4);
  assert.ok(info.enemytips.length);
  fs.writeFileSync(path.join(__dirname, 'sample-state.json'), JSON.stringify({ ...tracker.state, settings: store.settings, demo: true }, null, 1));

  // histórico
  const h = await tracker.ownHistory();
  assert.strictEqual(h.games.length, 20);
  const d = await tracker.gameDetails(h.games[0].gameId);
  assert.strictEqual(d.players.length, 10);

  // encontros guardados
  store.recordResult(7123456789, { win: true });
  assert.strictEqual(store.history('e3').vsW, 1);

  // o teu histórico contra campeões (jogo atual + jogos antigos)
  assert.deepStrictEqual(store.vsRecord(157, 103).lane, { w: 1, l: 0 }, 'Yasuo na tua lane');
  assert.deepStrictEqual(store.vsRecord(157, 103).laneMine, { w: 1, l: 0 });
  await tracker.backfillMatchups(5);
  const rec = store.vsRecord(114, 103);
  assert.ok(rec.all.w >= 5, 'jogos antigos contra Fiora');
  assert.strictEqual(store.vsRecord(157, 103, 7123456789).lane.w, 0, 'exclui o jogo atual');

  // diagnóstico
  const diag = await tracker.diagnose();
  const ok = Object.fromEntries(diag.map((c) => [c.name, c.ok]));
  assert.ok(ok.client && ok.summoner && ok.history && ok.ladder && ok.runePages && ok.itemSets && ok.builds, JSON.stringify(diag));
  for (const c of diag) for (const l of Object.keys(I18N.D)) assert.ok(I18N.D[l]['diag.' + c.name], `falta diag.${c.name} em ${l}`);

  // perfil do jogador
  const prof = await tracker.playerProfile('e3');
  assert.strictEqual(prof.name, 'xYasuox');
  assert.strictEqual(prof.games.length, 20);
  assert.ok(prof.champs[0].name === 'Yasuo' && prof.rank.solo.tier === 'DIAMOND');

  // traduções: todas as chaves usadas pelo motor existem nos 4 idiomas
  const used = new Set();
  for (const p of [...g.allies, ...g.enemies]) for (const t of p.analysis.tags) { used.add('tag.' + t.key); used.add('tagT.' + t.key); }
  for (const t of g.comp.tips) used.add(t.key);
  for (const l of Object.keys(I18N.D)) for (const k of used) assert.ok(I18N.D[l][k], `falta ${k} em ${l}`);
  assert.strictEqual(I18N.t('es', 'tag.tilt', { n: 4 }), 'Tilt (4 derrotas)');
  assert.strictEqual(I18N.rankLabel('en', { tier: 'MASTER', division: 'I' }), 'Master');
  // build contra o adversário (jogo: Ahri vs Yasuo, Kayn cura)
  const mb = g.myBuild;
  assert.strictEqual(mb.vs.name, 'Yasuo');
  assert.ok(mb.forMatch.length > 0, 'itens para esta partida');
  assert.ok(mb.forMatch.some((x) => x.id === 3165 && x.why.some((w) => w.key === 'why.antiheal')), 'Morellonomicon contra cura');
  for (const x of mb.forMatch) assert.ok(!mb.core.some((c) => c.id === x.id), 'não repete o core');
  // corpo-a-corpo no topo contra alguém à distância, equipa muito física
  const base = builds.getBuild(266, 'TOP');
  const ctx = tracker.matchupCtx(266, 51, [51, 122, 114, 157, 64]);
  assert.strictEqual(ctx.opp.ranged, true);
  assert.strictEqual(ctx.meRanged, false);
  const vsCait = builds.matchupBuild(base, ctx);
  assert.deepStrictEqual(vsCait.details.starting.map((x) => x.id), [1054, 2003], 'Escudo de Doran');
  assert.strictEqual(vsCait.boots[0].id, 3047, 'botas de aço contra equipa física');
  assert.ok(vsCait.tips.some((t) => t.key === 'mu.runeTip'));
  assert.ok(vsCait.forMatch.every((x) => x.why.some((w) => w.key === 'why.armor' || w.key === 'why.laneArmor' || w.key === 'why.antiheal' || w.key === 'why.pen')));
  const allWhy = [...mb.forMatch, ...vsCait.forMatch].flatMap((x) => x.why.map((w) => w.key)).concat(['why.bootsArmor', 'why.bootsMr', 'why.doranShield', 'mu.runeTip', 'mu.forMatch', 'mu.title']);
  for (const l of Object.keys(I18N.D)) for (const k of allWhy) assert.ok(I18N.D[l][k], `falta ${k} em ${l}`);

  const m = await tracker.importBuild(103, 'MIDDLE');
  assert.ok(lcu.itemSets.itemSets[0].title.includes('vs Yasuo'), 'conjunto de itens contra o adversário');
  assert.ok(lcu.itemSets.itemSets[0].blocks.some((bl) => bl.type.startsWith('Para esta partida')));
  assert.deepStrictEqual(m, { key: 'imp.done', what: ['runes', 'items'], champ: 'Ahri', runeSource: 'highElo', replaced: null });
  // idioma da Data Dragon muda
  await gd.setLang('en_US');
  assert.ok(gd.ready);

  console.log('OK — todos os testes passaram');
}
run().catch((e) => { console.error(e); process.exit(1); });

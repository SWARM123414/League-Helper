# LoL Scout

App para Windows que mostra **contra quem vais jogar** no League of Legends, e tudo sobre cada jogador.

## O que faz

**Idiomas:** Português, English, Español e Français. Muda-se no seletor do topo da janela ou nas Definições. Os nomes dos campeões, habilidades, itens e runas também mudam. Na primeira vez a app escolhe o idioma do Windows.

**Na seleção de campeões**
- Os picks e bans inimigos; clica em "Info do campeão" para veres as habilidades, como jogar contra, a build provável e o teu histórico contra ele
- O teu rank e a tua experiência no campeão que escolheste
- Aceita a partida automaticamente (opcional)

**Quando o jogo carrega (os 10 jogadores)**
- 🎯 **Quem vai contra ti** na lane, em destaque
- ☠ **O inimigo mais perigoso** e 🎯 **o elo mais fraco** (bom alvo para focar)
- ⚠ **Duos e premades** na equipa inimiga e na tua
- Rank (Solo/Duo e Flex), LP, winrate da season, nível
- Forma nos últimos 20 jogos (vitórias/derrotas), KDA, sequência
- Experiência no campeão que estão a jogar: número de jogos, winrate e KDA
- Etiquetas automáticas: **One-trick**, **Main**, **Primeira vez?**, **Possível smurf**, **Tilt**, **Em forma**, **Má fase**, **Morre muito**, **Winrate alta**…
- Os 3 campeões mais jogados de cada um
- Média de rank de cada equipa
- **Já te cruzaste com este jogador?** Mostra quantas vezes e o resultado (contigo / contra ti)
- **Notas** sobre jogadores ("tóxico", "joga muito bem de Lee Sin"…), que aparecem quando o voltares a encontrar
- Ao vivo durante o jogo: KDA, CS, nível, itens e tempo de respawn
- Notificação do Windows quando o jogo começa, com o resumo do que importa
- **Perfil de cada jogador dentro da app**: ranks, últimos jogos (cada um abre com os 10 jogadores), campeões e posição principal
- **O teu histórico contra cada campeão inimigo**: na equipa inimiga, na tua lane, e na lane com o teu campeão atual
- **Build provável do inimigo** (alto elo) e as habilidades com cooldowns, sem sair da app

**Builds (separador Builds e automaticamente na seleção de campeões)**
- Calculadas a partir dos jogos de ranqueada dos **melhores jogadores da tua região** (Challenger, Grão-Mestre, Mestre), recolhidos pelo teu próprio cliente uma vez por dia
- Por campeão e por posição: itens iniciais, itens principais **pela ordem em que são comprados**, botas, itens situacionais, runas completas (incluindo fragmentos), feitiços e **ordem das habilidades** nível a nível
- Percentagem de uso e de vitórias de cada escolha
- **Importar para o LoL com um clique**: cria a página de runas e o conjunto de itens na loja do jogo (ou faz isso sozinho quando confirmas o campeão, se ativares nas Definições)

**Build recomendada contra o teu adversário**
- Durante o jogo, a tua build é ajustada ao adversário da tua lane e à equipa inimiga: armadura ou resistência mágica conforme o dano dele, antecura contra quem se cura, penetração contra tanques, as botas certas e Escudo de Doran se fores corpo-a-corpo contra alguém à distância no topo
- Só escolhe itens que os jogadores de alto elo fazem com o teu campeão, e explica o porquê de cada um
- Na seleção de campeões a app adivinha o teu provável adversário pela posição habitual de cada pick inimigo
- O botão de importar (e a importação automática) mete esta build no cliente, com um bloco "Para esta partida"

**Overlay dentro do jogo**
- Uma janela pequena por cima do jogo com a tua build contra o adversário, os 5 inimigos (rank, etiquetas, quem é o mais perigoso, duos, KDA, cooldown da ultimate, tempo de respawn) e as dicas da partida
- Aparece sozinho durante 20 segundos quando o jogo começa e depois mostra/esconde com **Ctrl+Shift+Z** (dá para mudar)
- Os cliques passam através dele para o jogo e não rouba o foco
- **Quase sem custo de FPS:** escondido não faz nada; visível é uma imagem parada sem animações, atualizada no máximo a cada 3 segundos
- Precisa do jogo em modo **"Sem bordas"** (Borderless) ou janela: em ecrã inteiro exclusivo o Windows não deixa nada aparecer por cima

**Mais informações na partida**
- Barra de dano físico/mágico de cada equipa e **dicas de itens** para essa partida (armadura ou resistência mágica, antecura contra quem cura, penetração contra tanques, sentinelas contra invisíveis, tenacidade contra muito controlo)
- "Info do campeão" em cada jogador: passiva e habilidades com **cooldowns**, dicas de como jogar contra ele, e **os itens que esse jogador costuma fazer** com aquele campeão
- A tua build sempre à mão durante o jogo

**Histórico**
- Winrate, KDA médio, sequência atual e os teus melhores campeões
- Os teus últimos jogos; clica num para veres os 10 jogadores, dano, ouro, visão e itens

## Criar o instalador .exe

Precisas do **Node.js** (versão 18 ou superior): https://nodejs.org (instala a versão "LTS").

1. Extrai o zip para uma pasta, por exemplo `C:\lol-scout`
2. Abre essa pasta, clica na barra de endereço, escreve `cmd` e carrega em Enter
3. Corre:

```
npm install
npm run dist
```

> Se aparecer o erro "running scripts is disabled on this system", estás no PowerShell: usa `npm.cmd install` e `npm.cmd run dist`, ou escreve primeiro `cmd` e carrega em Enter.

4. O instalador fica em `dist\LoL Scout Setup 1.0.0.exe`. Faz duplo clique para instalar. Cria um atalho no Ambiente de Trabalho.

> O Windows pode mostrar "O Windows protegeu o seu PC" porque o instalador não está assinado. Clica em **Mais informações → Executar mesmo assim**.

## Testar sem compilar

```
npm install
npm start       # liga-se ao teu cliente do LoL
npm run demo    # simula uma partida, para veres como fica sem estar a jogar
npm test        # testes da lógica
```

## Como usar

1. Abre o LoL Scout (pode ser antes ou depois do cliente do League)
2. Faz login no League. Fica "Ligado" no canto superior esquerdo
3. Entra na fila. Na seleção de campeões vês os picks inimigos; quando o jogo carrega, vês os 10 jogadores

Se a app ficar sempre em "À procura do cliente", vai a **Definições** e indica a pasta onde o League está instalado (ex.: `D:\Riot Games\League of Legends`).

## Notas

- **Em ranked, a Riot esconde os nomes durante a seleção de campeões.** É uma regra da Riot e a app respeita-a. Os nomes, ranks e duos aparecem todos assim que o jogo começa a carregar (no ecrã de loading), tal como no Porofessor.
- A app só lê a API local do teu cliente (a mesma que o Porofessor, Blitz, U.GG e afins usam). Não mexe nos ficheiros do jogo nem no jogo em si.
- Os teus dados (notas, jogadores encontrados, definições) ficam só no teu PC, em `%APPDATA%\LoL Scout\lol-scout-data.json`.
- Os ícones e os dados dos campeões vêm da Data Dragon e da CommunityDragon da Riot, por isso precisam de internet (ficam em cache depois).
- As builds começam a ser recolhidas quando abres a app com o cliente do LoL ligado. Na primeira vez demora uns minutos até haver dados para a maioria dos campeões. Campeões pouco jogados em alto elo podem ter poucos jogos.
- A app nunca abre links nem o browser: tudo é mostrado dentro dela.
- Para a importação de runas precisas de uma página de runas livre (ou de uma chamada "LoL Scout…", que a app substitui).

## Se algo não funcionar

Vai a **Definições → Diagnóstico**, carrega em **Testar ligação ao LoL** e depois em **Copiar diagnóstico e registo**. Cola o texto na conversa e eu corrijo. O registo também fica em `%APPDATA%\LoL Scout\lol-scout.log`.

## Desempenho

- Com a janela da app minimizada ou escondida, ela não desenha nada.
- **Modo leve** (Definições): a app deixa de usar a placa gráfica, que fica toda para o jogo.
- **Fechar para junto do relógio** e **Arrancar com o Windows**: a app fica escondida e só aparece quando precisas.
- As builds são separadas por **patch**. Quando há poucos jogos no patch atual, junta os patches anteriores com menos peso e avisa quando a amostra é pequena. Também há builds de **ARAM** e **Arena**.

## Estrutura

```
main.js            janela do Electron e ligação entre as partes
preload.js         ponte segura entre a interface e o processo principal
src/lcu.js         encontra o cliente do LoL (lockfile / processo) e faz os pedidos
src/tracker.js     segue a fase (fila, seleção, jogo, fim) e monta os dados
src/analyzer.js    análise: rank, winrate, mains, smurfs, tilt, duos, ameaça
src/builds.js      builds de alto elo: recolha, agregação, timelines, importação para o cliente
src/gamedata.js    campeões, habilidades, itens e runas (Data Dragon) + dicas da partida
src/store.js       guarda notas, encontros e definições
src/demo.js        cliente falso para o modo demo
src/demo-static.js dados mínimos para o demo funcionar sem internet
renderer/overlay.* overlay dentro do jogo
src/log.js         registo de erros
renderer/i18n.js   traduções (PT, EN, ES, FR); para acrescentar um idioma, copia um bloco e traduz
renderer/          interface (HTML, CSS, JS)
test/              testes
```

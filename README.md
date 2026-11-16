# LoL Scout

A Windows app that shows **who you're up against** in League of Legends, and everything about each player. Built with **Tauri 2 (Rust) + TypeScript**.

## What it does

- **Champion select:** enemy picks and bans, champion info (abilities, how to play against them, likely high-elo build), your rank and experience on your pick, optional auto-accept.
- **When the game loads (all 10 players):** your lane opponent, the most dangerous enemy and the weakest link, duos and premades, ranks/LP/winrate, recent form, champion experience, automatic tags (one-trick, main, first time?, possible smurf, tilt…), players you've met before, and your notes on them. Live KDA, CS, level, items and respawn timers during the game.
- **Builds** computed from the ranked games of the best players in your region (Challenger/Grandmaster/Master), collected through your own client: items in buy order, boots, runes, summoner spells and skill order, per champion and role (plus ARAM and Arena). **One-click import** into the client.
- **Build against your opponent:** armor/MR, anti-heal, penetration and boots adjusted to your lane opponent and the enemy team, with the reason for each item.
- **In-game overlay** with your build, the 5 enemies, ultimate cooldowns and tips. Clicks pass through to the game and it never steals focus. Toggle with **Ctrl+Shift+Z** (configurable). Needs the game in Borderless or Windowed mode.
- History, player profiles, notes. Interface in Português, English, Español and Français.
- A custom window frame in the style of the League client (the top bar is the title bar, with gold minimise/maximise/close buttons).

## Why Rust + Tauri (instead of Electron)

This app spends most of its life sitting in the tray waiting for League to open, often while you're playing. So the goal was to use as few resources as possible. The previous version was Electron. Measured on the same PC, both apps hidden in the tray and waiting for the League client:

| | Electron (old) | Tauri (this version) |
|---|---|---|
| Installer | 78 MB | **1.5 MB** |
| Memory (private) | 95 MB | **40 MB** |
| CPU (share of one core) | ~17% | **under 1%** |
| Processes started while idle | one every 2 seconds | none |

The reasons:

- **No bundled browser.** Electron ships its own copy of Chromium (that's most of the 78 MB and a lot of the memory). Tauri uses **WebView2**, which is already part of Windows 10/11, so the app itself is a ~4 MB executable.
- **Finding the League client without PowerShell.** The Electron version started a PowerShell process every 2 seconds to read the client's command line, which cost about 15% of a CPU core all day. The Rust side reads the process list directly (and only every 5 seconds while League is closed).
- **Nothing is drawn when you can't see it.** When the window goes to the tray or is minimised, WebView2 is told to stop rendering and to drop memory. The overlay window only exists during a game.
- **Rust only where it matters.** The native side is small: HTTPS to the League client on `127.0.0.1` (Riot's self-signed certificate is accepted only for local connections), the process lookup, data files, windows, tray, hotkey and start-with-Windows. Everything else (tracker, player analysis, builds, interface) is **TypeScript**, so the logic stays easy to change and is tested without needing League open.
- **Why not C# or a fully native Rust UI?** They would save a little more memory, but meant rewriting the whole interface. Tauri kept the existing HTML/CSS interface and got most of the gain.

## Running and building

You need **Node.js** 18+ and **Rust** (with the "Desktop development with C++" tools from Visual Studio).

```
npm install
npm test          # engine tests (no League client needed)
npm start         # dev build connected to your League client
npm run demo      # dev build with a simulated match
npm run dist      # installer -> src-tauri/target/release/bundle/nsis/
```

The installed app also accepts `--demo` (simulated match) and `--hidden` (start in the tray).

## Notes

- **In ranked, Riot hides names during champion select.** Names, ranks and duos appear as soon as the game starts loading.
- The app only reads your client's local API (the same one Porofessor, Blitz and U.GG use). It doesn't touch game files or the game itself.
- Your data (notes, players met, settings, builds) stays on your PC in `%APPDATA%\com.lolscout.app\`. On first run it's copied over from the old Electron version (`%APPDATA%\LoL Scout\`).
- Icons and champion data come from Riot's Data Dragon and CommunityDragon (cached after the first download).
- If the app stays on "searching for the client", set the League install folder in **Settings**. If something breaks, use **Settings → Diagnostics** to test the connection and copy the log.

## Structure

```
src/core/        engine (TypeScript, no Tauri/Node dependencies)
  lcu.ts           finds the League client and talks to its API
  tracker.ts       follows the phase (queue, champ select, game, end) and builds the state
  analyzer.ts      rank, winrate, mains, smurfs, tilt, duos, threat
  builds.ts        high-elo builds: collection, aggregation, timelines, import into the client
  gamedata.ts      champions, abilities, items, runes (Data Dragon) + match tips
  store.ts         notes, encounters, settings
  i18n.ts          translations (PT, EN, ES, FR)
  demo*.ts         fake client for demo mode
src/app/         connects the engine to Tauri (tray, overlay, hotkey, notifications, the UI's api)
src/ui/          interface, window frame and overlay styles
src/overlay.ts   in-game overlay
src-tauri/       native side (Rust): src/lib.rs, tauri.conf.json, capabilities
test/            engine tests (node test/analyzer.test.ts)
```

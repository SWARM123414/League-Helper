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

## Installing (just using the app)

Run `LoL Scout_2.0.0_x64-setup.exe`. It installs for your Windows user only (no admin needed) and adds a Start menu shortcut.

- **Windows 10 or 11, 64-bit.** The app uses Microsoft Edge **WebView2**, which comes with Windows 11 and with up-to-date Windows 10. If it's missing, the installer downloads it (needs internet).
- Windows may show **"Windows protected your PC"** because the installer isn't signed. Click **More info → Run anyway**.
- Nothing else is needed to *run* the app. Node, Rust and Visual Studio are only needed to *build* it.

## Building from source

### 1. Install the tools (once)

| Tool | Version | Why | Where |
|---|---|---|---|
| **Node.js** | 22.18 or newer (the current LTS is fine) | Builds the interface (Vite + TypeScript) and runs the tests | https://nodejs.org |
| **Rust** (via rustup) | stable, toolchain `x86_64-pc-windows-msvc` (the default on Windows) | Compiles the native side | https://rustup.rs |
| **Visual Studio Build Tools** (or Visual Studio Community) | 2022 or newer, workload **"Desktop development with C++"** | Rust on Windows uses Microsoft's C++ linker (`link.exe`) and the Windows SDK | https://visualstudio.microsoft.com/visual-cpp-build-tools/ |

Notes:

- In the Visual Studio Installer, tick **"Desktop development with C++"**. Its defaults (MSVC build tools + a Windows 10/11 SDK) are what's needed. You don't need the full IDE.
- Install the C++ tools **before or right after** Rust. If rustup asks about them during setup, let it continue and install them afterwards.
- **Make sure Rust is on your PATH.** rustup puts `cargo` in `%USERPROFILE%\.cargo\bin` and normally adds that folder to your PATH. Check in a **new** terminal:

  ```powershell
  cargo --version
  rustc --version
  node --version
  ```

  If `cargo` isn't found, add the folder to your user PATH (once), then **open a new terminal / restart VS Code**:

  ```powershell
  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ";$env:USERPROFILE\.cargo\bin", 'User')
  ```

  Or, just for the terminal you have open: `$env:Path += ";$env:USERPROFILE\.cargo\bin"`

- You need **internet** for the first build (npm packages, Rust crates, and the NSIS installer tool, which Tauri downloads automatically) and about **4–6 GB** of free disk space for Rust's build folder (`src-tauri/target`).

### 2. Build

In the project folder:

```powershell
npm install       # once (and after pulling changes to package.json)
npm run dist      # builds the installer
```

The installer ends up at `src-tauri\target\release\bundle\nsis\LoL Scout_2.0.0_x64-setup.exe`, and the plain executable at `src-tauri\target\release\lol-scout.exe`.

The **first build takes about 3–5 minutes** (it compiles all the Rust dependencies). Later builds take about 1–2 minutes.

### Other commands

```powershell
npm test          # engine tests (Node only, no Rust or League client needed)
npm run typecheck # TypeScript check
npm start         # dev build connected to your League client (live-reloads the interface)
npm run demo      # dev build with a simulated match, to see the app without playing
```

The app (dev or installed) also accepts `--demo` (simulated match) and `--hidden` (start in the tray), e.g. `lol-scout.exe --demo`.

### Troubleshooting the build

| Error | Fix |
|---|---|
| `failed to run 'cargo metadata' ... program not found` | Rust isn't on your PATH: see the PATH step above, then open a new terminal. |
| `linker 'link.exe' not found` / `error: linking with link.exe failed` / missing `kernel32.lib` | The C++ tools or Windows SDK are missing: install **"Desktop development with C++"** in the Visual Studio Installer. |
| `npm : ... running scripts is disabled on this system` (PowerShell) | Use `npm.cmd install` / `npm.cmd run dist`, or run the commands from **cmd** instead of PowerShell. |
| `Port 1420 is already in use` (on `npm start` / `npm run demo`) | An old dev server is still running: close the other terminal or end the `node.exe` running Vite in Task Manager. |
| `Unsupported engine` / Vite or test errors about Node | Update Node.js to 22.18 or newer. |
| The build hangs at "Downloading NSIS" | It needs access to github.com the first time. Check your internet or firewall. |

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

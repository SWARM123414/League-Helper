// LoL Scout — lado nativo (Rust).
//
// O "cérebro" da app (tracker, builds, análise) é TypeScript e corre na janela principal.
// Aqui fica só o que precisa de acesso ao sistema:
//   * pedidos HTTPS ao cliente do LoL em 127.0.0.1 (certificado auto-assinado da Riot)
//   * encontrar o processo LeagueClientUx.exe (sem lançar PowerShell a cada 2 s)
//   * ficheiros de dados na pasta da app
//   * janela principal sem moldura, overlay por cima do jogo, ícone na bandeja
//   * arranque com o Windows e instância única

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;

const DATA_FILE: &str = "lol-scout-data.json";
const OVERLAY_W: f64 = 380.0;
const OVERLAY_H: f64 = 640.0;
// valores por omissão do WebView2 no Tauri; ao passar argumentos próprios temos de os repetir
const BASE_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

struct AppState {
    demo: bool,
    hidden: bool,
    browser_args: String,
    http: reqwest::Client,
    sys: Mutex<Option<System>>,
}

// ---------------------------------------------------------------------------
// Arranque

#[derive(Serialize)]
struct LaunchFlags {
    demo: bool,
    hidden: bool,
}

#[tauri::command]
fn launch_flags(state: State<'_, AppState>) -> LaunchFlags {
    LaunchFlags { demo: state.demo, hidden: state.hidden }
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    tauri: String,
    os: String,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        tauri: tauri::VERSION.to_string(),
        os: System::long_os_version().unwrap_or_else(|_| std::env::consts::OS.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Pedidos ao cliente do LoL (LCU, porta variável) e à Live Client Data API (porta 2999).
// O host é sempre 127.0.0.1: o certificado auto-assinado só é aceite para ligações locais.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalRequest {
    port: u16,
    method: String,
    path: String,
    auth: Option<String>,
    body: Option<serde_json::Value>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
struct LocalResponse {
    status: u16,
    body: serde_json::Value,
}

#[tauri::command]
async fn local_request(req: LocalRequest, state: State<'_, AppState>) -> Result<LocalResponse, String> {
    if !req.path.starts_with('/') {
        return Err("caminho inválido".into());
    }
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
    let url = format!("https://127.0.0.1:{}{}", req.port, req.path);
    let mut rb = state
        .http
        .request(method, url)
        .header("Accept", "application/json")
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(6000).clamp(500, 30_000)));
    if let Some(auth) = &req.auth {
        let (user, pass) = auth.split_once(':').unwrap_or(("riot", auth.as_str()));
        rb = rb.basic_auth(user, Some(pass));
    }
    if let Some(body) = &req.body {
        rb = rb
            .header("Content-Type", "application/json")
            .body(serde_json::to_string(body).map_err(|e| e.to_string())?);
    }
    let res = rb.send().await.map_err(|e| {
        if e.is_connect() {
            "ECONNREFUSED".to_string()
        } else if e.is_timeout() {
            "timeout".to_string()
        } else {
            e.to_string()
        }
    })?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let body = if text.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text))
    };
    Ok(LocalResponse { status, body })
}

// ---------------------------------------------------------------------------
// Encontrar o cliente: linha de comandos do LeagueClientUx.exe (porta + password) e a
// pasta do executável (onde está o lockfile, caso a linha de comandos não seja legível).

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LeagueProcess {
    cmdline: String,
    exe_dir: Option<String>,
}

#[tauri::command]
fn league_process(state: State<'_, AppState>) -> LeagueProcess {
    let mut out = LeagueProcess { cmdline: String::new(), exe_dir: None };
    let mut guard = state.sys.lock().unwrap();
    if guard.is_none() {
        *guard = System::new().ok();
    }
    let Some(sys) = guard.as_mut() else { return out };
    // 1.º passo barato: só a lista de processos (sem ler a memória de nenhum)
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let pids: Vec<Pid> = sys
        .processes_by_exact_name("LeagueClientUx.exe".as_ref())
        .map(|p| p.pid())
        .collect();
    if pids.is_empty() {
        return out;
    }
    // 2.º passo: linha de comandos e executável só do processo do LoL
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        false,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_exe(UpdateKind::Always),
    );
    for pid in pids {
        if let Some(p) = sys.process(pid) {
            if out.exe_dir.is_none() {
                out.exe_dir = p.exe().and_then(|e| e.parent()).map(|d| d.to_string_lossy().into_owned());
            }
            let args: Vec<String> = p.cmd().iter().map(|a| format!("\"{}\"", a.to_string_lossy())).collect();
            if !args.is_empty() {
                out.cmdline = args.join(" ");
                break;
            }
        }
    }
    out
}

/// Lê o primeiro lockfile que existir. Só aceita ficheiros chamados "lockfile".
#[tauri::command]
fn read_lockfile(paths: Vec<String>) -> Option<String> {
    paths.iter().map(PathBuf::from).find_map(|p| {
        if p.file_name().map(|n| n == "lockfile").unwrap_or(false) {
            std::fs::read_to_string(&p).ok()
        } else {
            None
        }
    })
}

// ---------------------------------------------------------------------------
// Ficheiros de dados (definições, notas, builds, cache da Data Dragon, registo)

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn data_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let ok = !name.is_empty()
        && !name.contains("..")
        && !name.starts_with('/')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'));
    if !ok {
        return Err(format!("nome inválido: {name}"));
    }
    Ok(data_dir(app)?.join(name))
}

#[tauri::command]
fn data_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(data_path(&app, &name)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn data_write(app: AppHandle, name: String, text: String) -> Result<(), String> {
    let path = data_path(&app, &name)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // escrita atómica: um ficheiro meio escrito nunca substitui o anterior
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn data_append(app: AppHandle, name: String, text: String) -> Result<(), String> {
    use std::io::Write;
    let path = data_path(&app, &name)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    f.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

/// Se o ficheiro passar de `max_bytes`, passa a "<nome>.old" (para o registo não crescer sem fim).
#[tauri::command]
fn data_rotate(app: AppHandle, name: String, max_bytes: u64) -> Result<(), String> {
    let path = data_path(&app, &name)?;
    if std::fs::metadata(&path).map(|m| m.len() > max_bytes).unwrap_or(false) {
        let mut old = path.clone().into_os_string();
        old.push(".old");
        std::fs::rename(&path, old).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Espera feita do lado nativo. Os temporizadores de uma janela escondida são abrandados
/// pelo WebView2; isto mantém o ciclo do tracker (aceitar partida, etc.) com a janela na bandeja.
#[tauri::command]
async fn sleep_ms(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms.min(600_000))).await;
}

// ---------------------------------------------------------------------------
// Janela principal

// Com a janela escondida (bandeja) ou minimizada, o WebView2 tem de ser avisado,
// senão continua a desenhar animações a 60 fps sem ninguém ver (gasta CPU/GPU).
fn set_webview_rendering(w: &WebviewWindow, on: bool) {
    let wv: &tauri::Webview = w.as_ref();
    let _ = if on { wv.show() } else { wv.hide() };
    set_memory_target(w, !on);
}

/// Na bandeja o WebView2 pode largar caches e memória (a lógica continua a correr).
#[cfg(windows)]
fn set_memory_target(w: &WebviewWindow, low: bool) {
    let _ = w.with_webview(move |pw| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows::core::Interface;
        if let Ok(core) = pw.controller().CoreWebView2() {
            if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
                let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
                let _ = c19.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

#[cfg(not(windows))]
fn set_memory_target(_w: &WebviewWindow, _low: bool) {}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        set_webview_rendering(&w, true);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("main-shown", ());
    }
}

/// Esconde a janela principal na bandeja (a lógica continua a correr).
#[tauri::command]
fn main_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
        set_webview_rendering(&w, false);
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_autostart(app: AppHandle, state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    if state.demo {
        return Ok(());
    }
    let al = app.autolaunch();
    let r = if enabled { al.enable() } else { al.disable() };
    r.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Overlay: janela transparente por cima do jogo que deixa passar os cliques.
// Só existe durante o jogo (é destruída no fim para não gastar memória).

#[cfg(windows)]
fn win_show_no_activate(w: &WebviewWindow, show: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE,
    };
    if let Ok(hwnd) = w.hwnd() {
        unsafe {
            if show {
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE); // não rouba o foco ao jogo
                let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            } else {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
        }
    }
}

#[cfg(not(windows))]
fn win_show_no_activate(w: &WebviewWindow, show: bool) {
    let _ = if show { w.show() } else { w.hide() };
}

#[tauri::command]
async fn overlay_show(app: AppHandle, state: State<'_, AppState>, side: String) -> Result<(), String> {
    let win = match app.get_webview_window("overlay") {
        Some(w) => w,
        None => {
            let monitor = app
                .primary_monitor()
                .map_err(|e| e.to_string())?
                .ok_or("sem monitor")?;
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let (ax, ay) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
            let aw = area.size.width as f64 / scale;
            let x = if side == "left" { ax + 12.0 } else { ax + aw - OVERLAY_W - 12.0 };
            let w = WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("overlay.html".into()))
                .title("LoL Scout overlay")
                .inner_size(OVERLAY_W, OVERLAY_H)
                .position(x, ay + 80.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .focusable(false)
                .visible(false)
                .additional_browser_args(&state.browser_args)
                .build()
                .map_err(|e| e.to_string())?;
            w.set_ignore_cursor_events(true).map_err(|e| e.to_string())?; // os cliques passam para o jogo
            w
        }
    };
    win_show_no_activate(&win, true);
    Ok(())
}

#[tauri::command]
fn overlay_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        win_show_no_activate(&w, false);
    }
}

#[tauri::command]
fn overlay_destroy(app: AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.destroy();
    }
}

// ---------------------------------------------------------------------------
// Ícone na bandeja (os textos vêm da interface, no idioma escolhido)

#[derive(Deserialize)]
struct TrayLabels {
    open: String,
    overlay: String,
    quit: String,
}

fn tray_menu(app: &AppHandle, l: &TrayLabels, overlay_enabled: bool) -> tauri::Result<Menu<tauri::Wry>> {
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", &l.open, true, None::<&str>)?,
            &MenuItem::with_id(app, "overlay", &l.overlay, overlay_enabled, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", &l.quit, true, None::<&str>)?,
        ],
    )
}

#[tauri::command]
fn tray_update(app: AppHandle, labels: TrayLabels, overlay_enabled: bool) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("sem bandeja")?;
    let menu = tray_menu(&app, &labels, overlay_enabled).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())
}

fn request_quit(app: &AppHandle) {
    // a interface grava os dados pendentes e chama quit_app; se não responder, sai na mesma
    let _ = app.emit_to("main", "quit-requested", ());
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        h.exit(0);
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let labels = TrayLabels { open: "Abrir LoL Scout".into(), overlay: "Mostrar/esconder overlay".into(), quit: "Sair".into() };
    let mut b = TrayIconBuilder::with_id("main")
        .tooltip("LoL Scout")
        .menu(&tray_menu(app, &labels, true)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "open" => show_main(app),
            "overlay" => {
                let _ = app.emit_to("main", "tray-overlay", ());
            }
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Dados antigos: na primeira vez, traz as definições, notas e builds da versão Electron.

fn migrate_from_electron(dir: &Path) {
    let Some(appdata) = std::env::var_os("APPDATA") else { return };
    let old = PathBuf::from(appdata).join("LoL Scout");
    if dir.join(DATA_FILE).exists() || !old.join(DATA_FILE).exists() {
        return;
    }
    let _ = std::fs::create_dir_all(dir);
    for f in [DATA_FILE, "lol-scout-builds.json"] {
        let _ = std::fs::copy(old.join(f), dir.join(f));
    }
}

/// Lê uma definição do ficheiro de dados antes de criar a janela ("modo leve").
fn read_setting(dir: &Path, key: &str) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(dir.join(DATA_FILE)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("settings")?.get(key).cloned()
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let demo = args.iter().any(|a| a == "--demo");
    let hidden = args.iter().any(|a| a == "--hidden");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::Builder::new().args(["--hidden"]).build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let dir = data_dir(&handle).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            if !demo {
                migrate_from_electron(&dir);
            }
            let light = read_setting(&dir, "lightMode").and_then(|v| v.as_bool()).unwrap_or(false);
            let on_top = read_setting(&dir, "alwaysOnTop").and_then(|v| v.as_bool()).unwrap_or(false);
            // modo leve: o WebView2 não usa a placa gráfica (fica toda para o jogo)
            let browser_args = if light {
                format!("{BASE_BROWSER_ARGS} --disable-gpu --disable-gpu-compositing")
            } else {
                BASE_BROWSER_ARGS.to_string()
            };

            let http = reqwest::Client::builder()
                .danger_accept_invalid_certs(true) // só para 127.0.0.1 (ver local_request)
                .no_proxy()
                .pool_idle_timeout(Duration::from_secs(30))
                .build()?;

            app.manage(AppState { demo, hidden, browser_args: browser_args.clone(), http, sys: Mutex::new(None) });

            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(if demo { "LoL Scout (demo)" } else { "LoL Scout" })
                .inner_size(1280.0, 820.0)
                .min_inner_size(980.0, 640.0)
                .center()
                .decorations(false) // moldura própria, ao estilo do cliente do LoL
                .shadow(true)
                .background_color(tauri::window::Color(1, 10, 19, 255))
                .always_on_top(on_top)
                .visible(!hidden)
                .additional_browser_args(&browser_args)
                .build()?;
            if hidden {
                set_webview_rendering(&main, false);
            }
            // minimizar = parar de desenhar; restaurar = voltar a desenhar
            let mw = main.clone();
            main.on_window_event(move |ev| {
                if let tauri::WindowEvent::Resized(_) = ev {
                    let minimized = mw.is_minimized().unwrap_or(false);
                    let visible = mw.is_visible().unwrap_or(true);
                    set_webview_rendering(&mw, visible && !minimized);
                }
            });

            build_tray(&handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_flags,
            app_info,
            local_request,
            league_process,
            read_lockfile,
            data_read,
            data_write,
            data_append,
            data_rotate,
            sleep_ms,
            quit_app,
            main_hide,
            set_autostart,
            overlay_show,
            overlay_hide,
            overlay_destroy,
            tray_update,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao arrancar o LoL Scout");
}

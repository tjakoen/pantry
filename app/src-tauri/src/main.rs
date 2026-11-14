// PANTRY desktop shell: a menu-bar app around the hub's own pages.
//
// The window shows the bundled offline page until the hub's /health answers, then navigates to the
// hub. A background thread polls health every few seconds, keeps the tray title on the needs-you
// total, and sends the window back to the offline page when the hub stops answering. Nothing here
// renders PANTRY itself: the pages stay the hub's web pages, in the system webview.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{path::PathBuf, sync::Mutex, thread, time::Duration};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Url, WebviewWindow,
};
use tauri_plugin_deep_link::DeepLinkExt;

const DEFAULT_PORT: u16 = 4400;
const POLL: Duration = Duration::from_secs(4);

#[derive(Clone, Serialize, Default)]
struct HubState {
    up: bool,
    port: u16,
    needs_you: u64,
}

#[derive(Default)]
struct Shared {
    state: Mutex<HubState>,
    /// A project to land on once the hub answers (from a pantry:// link that arrived while offline).
    pending: Mutex<Option<String>>,
}

fn pantry_home() -> PathBuf {
    if let Ok(h) = std::env::var("PANTRY_HOME") {
        return PathBuf::from(h);
    }
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    PathBuf::from(home).join(".pantry")
}

/// The hub port lives in the registry (what `pantry hub` binds); hub.json records the last start.
fn hub_port() -> u16 {
    let read = |name: &str, key: &str| -> Option<u16> {
        let text = std::fs::read_to_string(pantry_home().join(name)).ok()?;
        let v: serde_json::Value = serde_json::from_str(&text).ok()?;
        v.get(key)?.as_u64().map(|p| p as u16)
    };
    read("projects.json", "hubPort").or_else(|| read("hub.json", "port")).unwrap_or(DEFAULT_PORT)
}

fn probe(port: u16) -> HubState {
    let res = ureq::get(&format!("http://127.0.0.1:{port}/health"))
        .timeout(Duration::from_millis(4000))
        .call()
        .ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok());
    match res {
        Some(v) if v.get("ok").and_then(|x| x.as_bool()) == Some(true) => HubState {
            up: true,
            port,
            needs_you: v.get("needsYou").and_then(|x| x.as_u64()).unwrap_or(0),
        },
        _ => HubState { up: false, port, needs_you: 0 },
    }
}

fn hub_url(port: u16, project: Option<&str>) -> Url {
    let path = project.map(|p| format!("open/{}", urlencode(p))).unwrap_or_default();
    Url::parse(&format!("http://localhost:{port}/{path}")).expect("hub url")
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn on_hub(win: &WebviewWindow) -> bool {
    win.url().map(|u| u.scheme() == "http").unwrap_or(false)
}

fn bring_forward(win: &WebviewWindow) {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
}

/// `pantry://project/<name>` → that project on the hub; any other pantry:// link → the hub home.
fn handle_link(app: &AppHandle, link: &str) {
    let project = Url::parse(link).ok().and_then(|u| {
        if u.host_str() == Some("project") {
            u.path_segments()?.next().filter(|s| !s.is_empty()).map(|s| s.to_string())
        } else {
            None
        }
    });
    let shared = app.state::<Shared>();
    let state = shared.state.lock().unwrap().clone();
    if let Some(win) = app.get_webview_window("main") {
        if state.up {
            let _ = win.navigate(hub_url(state.port, project.as_deref()));
        } else {
            *shared.pending.lock().unwrap() = project;
        }
        bring_forward(&win);
    }
}

#[tauri::command]
fn hub_status(app: AppHandle) -> HubState {
    app.state::<Shared>().state.lock().unwrap().clone()
}

/// Run `pantry hub ensure` through a login shell, because an app launched from the Dock or at login
/// does not inherit the PATH a terminal has, and that is where bun and pantry live.
#[tauri::command]
async fn start_hub() -> Result<String, String> {
    let cmd = std::env::var("PANTRY_ENSURE").unwrap_or_else(|_| "pantry hub ensure".into());
    let out = if cfg!(windows) {
        std::process::Command::new("cmd").args(["/C", &cmd]).output()
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        std::process::Command::new(shell).args(["-lc", &cmd]).output()
    }
    .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    if out.status.success() { Ok(text) } else { Err(text) }
}

fn poll(app: AppHandle) {
    let offline = Url::parse("tauri://localhost/index.html").ok();
    loop {
        let next = probe(hub_port());
        let shared = app.state::<Shared>();
        *shared.state.lock().unwrap() = next.clone();
        if let Some(tray) = app.tray_by_id("pantry") {
            let title = if !next.up { "–".to_string() } else if next.needs_you > 0 { next.needs_you.to_string() } else { String::new() };
            let _ = tray.set_title(Some(title));
            let tip = if next.up { format!("PANTRY: {} need you", next.needs_you) } else { "PANTRY: hub offline".into() };
            let _ = tray.set_tooltip(Some(tip));
        }
        if let Some(win) = app.get_webview_window("main") {
            // A link that arrived while the hub looked down is honoured as soon as it answers, even
            // if the window is already showing a hub page: the link is what the person asked for.
            let pending = if next.up { shared.pending.lock().unwrap().take() } else { None };
            if pending.is_some() || (next.up && !on_hub(&win)) {
                let _ = win.navigate(hub_url(next.port, pending.as_deref()));
                if pending.is_some() { bring_forward(&win); }
            } else if !next.up && on_hub(&win) {
                // Bundled pages are served from tauri://localhost on macOS/Linux and
                // http://tauri.localhost on Windows; on_hub only checks the scheme, so match it.
                let target = if cfg!(windows) { Url::parse("http://tauri.localhost/index.html").ok() } else { offline.clone() };
                if let Some(u) = target { let _ = win.navigate(u); }
            }
        }
        thread::sleep(POLL);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (or a pantry:// link on Windows/Linux) lands here instead.
            match argv.iter().find(|a| a.starts_with("pantry://")) {
                Some(link) => handle_link(app, link),
                None => if let Some(w) = app.get_webview_window("main") { bring_forward(&w) },
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![hub_status, start_hub])
        .setup(|app| {
            // `pantry open` checks for this marker where the OS cannot say who handles pantry://.
            let home = pantry_home();
            let _ = std::fs::create_dir_all(&home);
            let _ = std::fs::write(home.join("app-installed"), env!("CARGO_PKG_VERSION"));

            #[cfg(any(windows, target_os = "linux"))]
            let _ = app.deep_link().register_all();
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if let Some(u) = event.urls().first() { handle_link(&handle, u.as_str()); }
            });
            // A pantry:// link that LAUNCHED the app (the session-start hook, when PANTRY was not
            // running) is delivered before the listener above exists. Without this read it is lost
            // and the window lands on the all-projects page instead of the session's project.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if let Some(u) = urls.first() { handle_link(app.handle(), u.as_str()); }
            }

            let open = MenuItem::with_id(app, "open", "Open PANTRY", true, None::<&str>)?;
            let start = MenuItem::with_id(app, "start", "Start hub", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &start, &quit])?;
            TrayIconBuilder::with_id("pantry")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .title("–")
                .menu(&menu)
                .on_menu_event(|app, e| match e.id().as_ref() {
                    "open" => if let Some(w) = app.get_webview_window("main") { bring_forward(&w) },
                    "start" => { tauri::async_runtime::spawn(async { let _ = start_hub().await; }); }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            let handle = app.handle().clone();
            thread::spawn(move || poll(handle));
            Ok(())
        })
        .on_window_event(|win, event| {
            // Closing the window keeps the app in the menu bar; Quit lives in the tray menu.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = win.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running PANTRY");
}

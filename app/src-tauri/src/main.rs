// PANTRY desktop shell: a menu-bar app around the hub's own pages.
//
// It lives in the menu bar (the system tray on Windows) and starts with its window hidden. A session
// brings it up in the background, so the project is loaded and the status is current without a
// window taking the screen; the window comes forward only when the owner asks for it, from the tray
// menu, a pantry:// link without bg=1, or a second launch. While the window is hidden the app keeps
// no Dock icon on macOS.
//
// The window shows the bundled offline page until the hub's /health answers, then navigates to the
// hub. A background thread polls health every few seconds, keeps the tray title on the needs-you
// total, and sends the window back to the offline page when the hub stops answering. Nothing here
// renders PANTRY itself: the pages stay the hub's web pages, in the system webview.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{path::PathBuf, sync::Mutex, thread, time::Duration};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Manager, Url, WebviewWindow,
};
use tauri_plugin_deep_link::DeepLinkExt;

mod toast;
use toast::Mark;

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
    pending: Mutex<Option<(String, Option<String>)>>,
    /// The menu's first line, kept so the poll can rewrite it with the current status.
    status: Mutex<Option<MenuItem<tauri::Wry>>>,
    /// The update line: hidden text until a newer release exists, then the release's address.
    update: Mutex<Option<(MenuItem<tauri::Wry>, Option<String>)>>,
    /// What the toast last showed, so the icons are redrawn only when the count changes.
    mark: Mutex<Option<Mark>>,
    /// The tray summary the dropdown was last built from, so it is rebuilt only when that changes.
    tray_sig: Mutex<String>,
    /// Where each item line of the dropdown opens: (project, page) by the line's position.
    links: Mutex<Vec<(Option<String>, String)>>,
}

/// The newest published release of PANTRY, as (version, page), when it is newer than this build.
/// No release pipeline signs builds yet, so this points the owner at the release page rather than
/// installing anything itself.
fn newer_release() -> Option<(String, String)> {
    let v: serde_json::Value = ureq::get("https://api.github.com/repos/tjakoen/pantry/releases/latest")
        .set("User-Agent", "pantry-app")
        .timeout(Duration::from_secs(10))
        .call().ok()?.into_json().ok()?;
    let tag = v.get("tag_name")?.as_str()?.trim_start_matches('v').to_string();
    let page = v.get("html_url")?.as_str()?.to_string();
    let parse = |s: &str| s.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    (parse(&tag) > parse(env!("CARGO_PKG_VERSION"))).then_some((tag, page))
}

fn watch_releases(app: AppHandle) {
    loop {
        if let Some((tag, page)) = newer_release() {
            if let Some((item, url)) = app.state::<Shared>().update.lock().unwrap().as_mut() {
                let _ = item.set_text(format!("Update available: PANTRY {tag}…"));
                let _ = item.set_enabled(true);
                *url = Some(page);
            }
            if let Some(tray) = app.tray_by_id("pantry") {
                let _ = tray.set_tooltip(Some(format!("PANTRY {tag} is available")));
            }
        }
        thread::sleep(Duration::from_secs(6 * 60 * 60));
    }
}

fn open_external(url: &str) {
    let cmd = if cfg!(target_os = "macos") { vec!["open", url] } else if cfg!(windows) { vec!["cmd", "/c", "start", "", url] } else { vec!["xdg-open", url] };
    let _ = std::process::Command::new(cmd[0]).args(&cmd[1..]).spawn();
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

/// The hub's /tray.json: the count, the top waiting items, paused plans and other machines. None
/// from a hub that predates it, which keeps the old one-line menu.
fn tray_summary(port: u16) -> Option<serde_json::Value> {
    ureq::get(&format!("http://127.0.0.1:{port}/tray.json"))
        .timeout(Duration::from_millis(4000))
        .call()
        .ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok())
        .filter(|v| v.get("ok").and_then(|x| x.as_bool()) == Some(true))
}

/// Cut a menu line to a length a menu bar dropdown can show without growing wider than the screen.
fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n { s.to_string() } else { format!("{}…", s.chars().take(n - 1).collect::<String>()) }
}

/// The dropdown as the shortest form of the hub's front page: what waits on the owner, each line
/// opening its item; paused plans with their resume time; one line for the other machines; then the
/// app's own controls. Built afresh whenever the tray summary changes.
fn build_menu(app: &AppHandle, tray: &serde_json::Value) -> tauri::Result<Menu<tauri::Wry>> {
    let shared = app.state::<Shared>();
    let menu = Menu::new(app)?;
    if let Some(status) = shared.status.lock().unwrap().as_ref() { menu.append(status)?; }
    let mut links: Vec<(Option<String>, String)> = Vec::new();
    let line = |v: &serde_json::Value| -> (String, Option<String>, String) {
        let label = v.get("label").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let project = v.get("project").and_then(|x| x.as_str()).map(|x| x.to_string());
        let path = v.get("path").and_then(|x| x.as_str()).unwrap_or("/").to_string();
        (label, project, path)
    };
    let items = tray.get("items").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    for v in &items {
        let (label, project, path) = line(v);
        let id = format!("go:{}", links.len());
        links.push((project, path));
        menu.append(&MenuItem::with_id(app, id, clip(&label, 64), true, None::<&str>)?)?;
    }
    let more = tray.get("more").and_then(|x| x.as_u64()).unwrap_or(0);
    if more > 0 { menu.append(&MenuItem::with_id(app, "open", format!("{more} more on the hub…"), true, None::<&str>)?)?; }
    let paused = tray.get("paused").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    if !paused.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, "paused-head", "Paused on a usage limit", false, None::<&str>)?)?;
        for v in &paused {
            let (label, project, path) = line(v);
            let id = format!("go:{}", links.len());
            links.push((project, path));
            menu.append(&MenuItem::with_id(app, id, clip(&label, 64), true, None::<&str>)?)?;
        }
    }
    if let Some(elsewhere) = tray.get("elsewhere").and_then(|x| x.as_str()) {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, "elsewhere", clip(elsewhere, 64), false, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "open", "Open PANTRY", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if let Some((update, _)) = shared.update.lock().unwrap().as_ref() { menu.append(update)?; }
    menu.append(&MenuItem::with_id(app, "quit", "Quit PANTRY", true, None::<&str>)?)?;
    *shared.links.lock().unwrap() = links;
    Ok(menu)
}

/// Open one dropdown line: a project page through the same path a pantry:// link takes.
fn open_line(app: &AppHandle, index: usize) {
    let target = app.state::<Shared>().links.lock().unwrap().get(index).cloned();
    match target {
        Some((Some(project), path)) => {
            let mut link = Url::parse("pantry://project/").expect("pantry url");
            link.set_path(&format!("/{}", urlencode(&project)));
            link.query_pairs_mut().append_pair("to", &path);
            handle_link(app, link.as_str());
        }
        _ => if let Some(w) = app.get_webview_window("main") { bring_forward(&w) },
    }
}

fn hub_url(port: u16, project: Option<&str>) -> Url {
    hub_url_to(port, project, None)
}

/// The hub's /open route, with `to` naming one page of the project (a plan, say).
fn hub_url_to(port: u16, project: Option<&str>, to: Option<&str>) -> Url {
    let path = project.map(|p| format!("open/{}", urlencode(p))).unwrap_or_default();
    let mut url = Url::parse(&format!("http://localhost:{port}/{path}")).expect("hub url");
    if let (Some(_), Some(to)) = (project, to) {
        url.query_pairs_mut().append_pair("to", to);
    }
    url
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
    focus_now(win);
    // A link that LAUNCHES the app is handled while macOS is still finishing the launch, and a focus
    // request made then is dropped: the window opened behind whatever app had focus. Asking again a
    // moment later, once the launch is done, is what brings it forward.
    let later = win.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(900));
        let w = later.clone();
        let _ = later.run_on_main_thread(move || focus_now(&w));
    });
}

/// The Dock icon follows the window: there while it shows, gone while PANTRY sits in the menu bar.
fn set_dock(app: &AppHandle, visible: bool) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(if visible { tauri::ActivationPolicy::Regular } else { tauri::ActivationPolicy::Accessory });
    #[cfg(not(target_os = "macos"))]
    let _ = (app, visible);
}

fn focus_now(win: &WebviewWindow) {
    set_dock(win.app_handle(), true);
    #[cfg(target_os = "macos")]
    let _ = win.app_handle().show();
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
}

/// `pantry://project/<name>` → that project on the hub, and `?to=<path>` → one page of it; any other
/// pantry:// link → the hub home.
fn handle_link(app: &AppHandle, link: &str) {
    let to = Url::parse(link).ok().and_then(|u| u.query_pairs().find(|(k, _)| k == "to").map(|(_, v)| v.into_owned()));
    // bg=1 loads the page and leaves the window where it is: the session-start hook uses it, so a
    // new session never pops a window in front of the owner.
    let background = Url::parse(link).ok().map(|u| u.query_pairs().any(|(k, v)| k == "bg" && v == "1")).unwrap_or(false);
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
            let _ = win.navigate(hub_url_to(state.port, project.as_deref(), to.as_deref()));
        } else {
            *shared.pending.lock().unwrap() = project.map(|p| (p, to));
        }
        if !background { bring_forward(&win); }
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

/// The menu-bar toast at 44 pixels, which macOS shows at 22 points on a Retina bar.
fn tray_icon(mark: Mark) -> tauri::image::Image<'static> {
    tauri::image::Image::new_owned(toast::render(mark, 44), 44, 44)
}

fn poll(app: AppHandle) {
    let offline = Url::parse("tauri://localhost/index.html").ok();
    loop {
        let mut next = probe(hub_port());
        let summary = if next.up { tray_summary(next.port) } else { None };
        // The tray's count covers every machine and unread answers, so it is the one the icon shows.
        if let Some(n) = summary.as_ref().and_then(|t| t.get("needsYou")).and_then(|x| x.as_u64()) { next.needs_you = n; }
        let shared = app.state::<Shared>();
        *shared.state.lock().unwrap() = next.clone();
        if let Some(tray) = app.tray_by_id("pantry") {
            let mark = if !next.up { Mark::Offline } else { Mark::Count(next.needs_you as u32) };
            if *shared.mark.lock().unwrap() != Some(mark) {
                *shared.mark.lock().unwrap() = Some(mark);
                let _ = tray.set_icon(Some(tray_icon(mark)));
                let _ = tray.set_icon_as_template(true);
            }
            let tip = if next.up { format!("PANTRY: {} need you", next.needs_you) } else { "PANTRY: hub offline".into() };
            let _ = tray.set_tooltip(Some(tip));
        }
        if let Some(item) = shared.status.lock().unwrap().as_ref() {
            let line = if !next.up {
                "Hub offline".to_string()
            } else if next.needs_you == 0 {
                format!("Nothing waiting on you · hub on :{}", next.port)
            } else {
                format!("{} waiting on you · hub on :{}", next.needs_you, next.port)
            };
            let _ = item.set_text(line);
        }
        let sig = summary.as_ref().map(|t| t.to_string()).unwrap_or_default();
        if *shared.tray_sig.lock().unwrap() != sig {
            *shared.tray_sig.lock().unwrap() = sig;
            if let (Some(t), Some(tray)) = (summary.as_ref(), app.tray_by_id("pantry")) {
                if let Ok(menu) = build_menu(&app, t) { let _ = tray.set_menu(Some(menu)); }
            }
        }
        if let Some(win) = app.get_webview_window("main") {
            // A link that arrived while the hub looked down is honoured as soon as it answers, even
            // if the window is already showing a hub page: the link is what the person asked for.
            let pending = if next.up { shared.pending.lock().unwrap().take() } else { None };
            if pending.is_some() || (next.up && !on_hub(&win)) {
                let _ = win.navigate(match &pending {
                    Some((p, to)) => hub_url_to(next.port, Some(p), to.as_deref()),
                    None => hub_url(next.port, None),
                });
                // A pending link only comes forward if the window was already showing; a background
                // link that waited for the hub stays in the background.
                if pending.is_some() && win.is_visible().unwrap_or(false) { bring_forward(&win); }
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

            // Start in the menu bar: no window and no Dock icon until the owner opens one.
            set_dock(app.handle(), false);
            let status = MenuItem::with_id(app, "status", "Looking for the hub…", false, None::<&str>)?;
            *app.state::<Shared>().status.lock().unwrap() = Some(status.clone());
            let update = MenuItem::with_id(app, "update", format!("PANTRY {} is up to date", env!("CARGO_PKG_VERSION")), false, None::<&str>)?;
            *app.state::<Shared>().update.lock().unwrap() = Some((update.clone(), None));
            let open = MenuItem::with_id(app, "open", "Open PANTRY", true, None::<&str>)?;
            let start = MenuItem::with_id(app, "start", "Start hub", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit PANTRY", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&status, &sep, &open, &start, &sep2, &update, &quit])?;
            TrayIconBuilder::with_id("pantry")
                .icon(tray_icon(Mark::Offline))
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(|app, e| match e.id().as_ref() {
                    "open" => if let Some(w) = app.get_webview_window("main") { bring_forward(&w) },
                    "start" => { tauri::async_runtime::spawn(async { let _ = start_hub().await; }); }
                    "update" => {
                        if let Some((_, Some(url))) = app.state::<Shared>().update.lock().unwrap().as_ref() { open_external(url); }
                    }
                    "quit" => app.exit(0),
                    id if id.starts_with("go:") => {
                        if let Ok(i) = id[3..].parse::<usize>() { open_line(app, i); }
                    }
                    _ => {}
                })
                .build(app)?;

            // The app menu: Cmd+Q puts PANTRY back in the menu bar rather than quitting, because the
            // menu bar is where it lives. Quitting for real is the last item here and in the tray.
            let to_bar = MenuItem::with_id(app, "to_bar", "Close to Menu Bar", true, Some("CmdOrCtrl+Q"))?;
            let really_quit = MenuItem::with_id(app, "quit", "Quit PANTRY", true, None::<&str>)?;
            let app_menu = Submenu::with_items(app, "PANTRY", true, &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &to_bar,
                &really_quit,
            ])?;
            let edit = Submenu::with_items(app, "Edit", true, &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ])?;
            let window = Submenu::with_items(app, "Window", true, &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::close_window(app, None)?,
            ])?;
            app.set_menu(Menu::with_items(app, &[&app_menu, &edit, &window])?)?;
            app.on_menu_event(|app, e| match e.id().as_ref() {
                "to_bar" => to_menu_bar(app),
                "quit" => app.exit(0),
                _ => {}
            });

            let handle = app.handle().clone();
            thread::spawn(move || poll(handle));
            let handle = app.handle().clone();
            thread::spawn(move || watch_releases(handle));
            Ok(())
        })
        .on_window_event(|win, event| match event {
            // Closing the window keeps the app in the menu bar; Quit lives in the tray menu.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                to_menu_bar(win.app_handle());
            }
            // Minimising would leave a Dock icon behind with nothing to show for it, so it hides
            // the window to the menu bar too.
            tauri::WindowEvent::Resized(_) if win.is_minimized().unwrap_or(false) => to_menu_bar(win.app_handle()),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running PANTRY");
}

/// Put the window away and drop the Dock icon: PANTRY lives in the menu bar.
fn to_menu_bar(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    set_dock(app, false);
}

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
	Emitter,
    Listener,
    Manager,
};

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // --- Plugins ---

    builder = builder.plugin(tauri_plugin_shell::init());
    builder = builder.plugin(tauri_plugin_process::init());
    builder = builder.plugin(tauri_plugin_deep_link::init());

    // Single instance (desktop only)
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Focus existing window when user launches a second instance
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
            // Handle deep link from second instance
            if let Some(url) = args.get(1) {
                if url.starts_with("muster://") {
                    // Forward deep link to frontend via event
                    let _ = app.emit("deep-link", url.clone());
                }
            }
        }));

        // Autostart (desktop only)
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }

    // --- Setup ---

    builder = builder.setup(|app| {
        // System tray (desktop only)
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let show = MenuItemBuilder::with_id("show", "Show Muster").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show)
                .separator()
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Muster")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                })
                .build(app)?;
        }

        // Handle deep links
        let handle = app.handle().clone();
        app.listen("deep-link://new-url", move |event| {
            let _ = handle.emit("deep-link", event.payload());
        });

        Ok(())
    });

    // --- Window close behavior: hide to tray instead of quit ---

    builder = builder.on_window_event(|window, event| {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Hide window instead of closing (minimize to tray)
            let _ = window.hide();
            api.prevent_close();
        }
    });

    // --- Invoke handlers ---

    builder
        .invoke_handler(tauri::generate_handler![get_app_version])
        .run(tauri::generate_context!())
        .expect("error while running Muster");
}

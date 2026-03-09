// 👇 Agregá Manager a la lista de imports
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
async fn abrir_ventana_pago(app: AppHandle, url: String) -> Result<(), String> {
    let app_clone_nav = app.clone();

    let window = WebviewWindowBuilder::new(
        &app,
        "pago_lemon",
        WebviewUrl::External(url.parse().unwrap())
    )
    .title("PassManager Pro - Pago Seguro")
    .inner_size(500.0, 750.0)
    .center()
    .resizable(false)
    .decorations(true)
    // 👇 EL INTERCEPTOR DE URLS
    .on_navigation(move |nav_url| {
        let url_str = nav_url.as_str();

        // Atrapamos tu URL de éxito O la página de recibo de Lemon Squeezy
        if url_str.contains("exito") || url_str.contains("success") || url_str.contains("/orders/") {

            // 1. Avisamos al JS que pagó
            let _ = app_clone_nav.emit("pago_exitoso", ());

            // 2. Cerramos la ventana automáticamente
            if let Some(w) = app_clone_nav.get_webview_window("pago_lemon") {
                let _ = w.close();
            }
            return false; // Cancelamos la carga de la web
        }
        true
    })
    .build()
    .map_err(|e| e.to_string())?;

    let app_clone_close = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = app_clone_close.emit("pago_cerrado", ());
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    // 👇 Registramos el nuevo comando junto al 'greet' que ya tenías
    .invoke_handler(tauri::generate_handler![abrir_ventana_pago])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

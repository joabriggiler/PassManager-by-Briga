// tauri-bridge.js - Versión final estable para Tauri v2
const { getCurrentWindow } = window.__TAURI__.window;
const { open } = window.__TAURI__.opener;
const { check } = window.__TAURI__.updater;
const { getVersion } = window.__TAURI__.app;
const appWindow = getCurrentWindow();

let pendingUpdate = null;

window.pm = {
    getVersion: async () => await getVersion(),
    openExternal: async (url) => await open(url),
    window: {
        minimize: () => appWindow.minimize(),
        maximize: () => appWindow.toggleMaximize(),
        close: () => appWindow.close(),
    },
    clipboard: {
        writeText: (t) => navigator.clipboard.writeText(String(t ?? "")),
    },
    updater: {
        // Se ejecuta al iniciar la app para buscar versiones nuevas
        onReady: async (cb) => {
            try {
                const update = await check();
                if (update?.available) {
                    pendingUpdate = update; // Guardamos el objeto para instalarlo luego
                    console.log(`🎁 Actualización disponible: ${update.version}`);
                    cb({
                        version: update.version,
                        notes: update.body,
                        date: update.date
                    });
                }
            } catch (e) {
                console.error("[Tauri Updater] Error al verificar:", e);
            }
        },
        // Se ejecuta cuando el usuario hace clic en "Actualizar ahora"
        install: async () => {
            if (pendingUpdate) {
                console.log("Instalando actualización...");
                await pendingUpdate.downloadAndInstall();
            } else {
                console.warn("No hay actualizaciones pendientes para instalar.");
            }
        },
    },
};
console.log("🚀 Bridge v2 con Updater cargado con éxito.");

// tauri-bridge.js - Versión a prueba de balas para Producción
const tauriWindow = window.__TAURI__?.window || {};
const tauriOpener = window.__TAURI__?.opener || {};
const tauriUpdater = window.__TAURI__?.updater || {};
const tauriApp = window.__TAURI__?.app || {};

const appWindow = tauriWindow.getCurrentWindow ? tauriWindow.getCurrentWindow() : null;
let pendingUpdate = null;

window.pm = {
    getVersion: async () => tauriApp.getVersion ? await tauriApp.getVersion() : "1.2.7",
    openExternal: async (url) => { if(tauriOpener.open) await tauriOpener.open(url); },
    window: {
        minimize: () => appWindow?.minimize(),
        maximize: () => appWindow?.toggleMaximize(),
        close: () => appWindow?.close(),
    },
    updater: {
        onReady: async (cb) => {
            try {
                if (tauriUpdater.check) {
                    const update = await tauriUpdater.check();
                    if (update?.available) {
                        pendingUpdate = update;
                        cb({ version: update.version, notes: update.body, date: update.date });
                    }
                }
            } catch (e) {
                console.error("[Tauri Updater Error]", e);
            }
        },
        install: async () => {
            if (pendingUpdate) await pendingUpdate.downloadAndInstall();
        },
    },
};
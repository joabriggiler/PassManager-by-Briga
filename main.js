const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");

// Hot reload SOLO en desarrollo (si lo activás con ELECTRON_RELOAD=1)
if (!app.isPackaged && process.env.ELECTRON_RELOAD === "1") {
    require("electron-reloader")(module);
}

// Auto-updater (solo se usa en builds instaladas)
const { autoUpdater } = require("electron-updater");
const IS_PORTABLE =
  !!process.env.PORTABLE_EXECUTABLE_DIR ||
  !!process.env.PORTABLE_EXECUTABLE_FILE;

if (app.isPackaged && !IS_PORTABLE) {
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.on("checking-for-update", () => console.log("[Updater] Checking for update..."));
    autoUpdater.on("update-available", () => console.log("[Updater] Update available"));
    autoUpdater.on("update-not-available", () => console.log("[Updater] No updates"));
    autoUpdater.on("download-progress", (p) =>
        console.log(`[Updater] Downloading: ${Math.round(p.percent)}%`)
    );

    autoUpdater.on("update-downloaded", () => {
        console.log("[Updater] Update downloaded. Waiting user confirm...");
        pendingUpdateReady = true;
        if (win && win.webContents) win.webContents.send("update-ready");
    });

    autoUpdater.on("error", (err) => {
        console.error("[Updater] Error:", err);
    });
}

let win; // referencia global a la ventana principal
let pendingUpdateReady = false;

function createWindow() {
    win = new BrowserWindow({
        width: 850,
        height: 700,
        minWidth: 350,
        minHeight: 500,
        resizable: true,
        frame: false,
        icon: path.join(__dirname, 'favicon.ico'),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            devTools: true,
        }
    });

    if (process.platform === "win32" || process.platform === "darwin") win.setContentProtection(true);

    win.loadFile(path.join(__dirname, 'index.html'));

    win.webContents.openDevTools();

    win.webContents.on("did-finish-load", () => {
        if (pendingUpdateReady) {
            win.webContents.send("update-ready");
            pendingUpdateReady = false;
        }
    });

    // (Opcional) elimina el menú para evitar "Reload" desde menú
    Menu.setApplicationMenu(null);

    // Bloquear recarga por teclado (Ctrl+Shift+R / Ctrl+R / F5) y DevTools
    win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;

        const isMac = process.platform === 'darwin';
        const ctrlOrCmd = isMac ? input.meta : input.control;
        const key = (input.key || '').toLowerCase();

        // Reload shortcuts
        if ((ctrlOrCmd && key === 'r') || key === 'f5') {
            event.preventDefault();
            return;
        }

        // Hard reload (Ctrl+Shift+R)
        if (ctrlOrCmd && input.shift && key === 'r') {
            event.preventDefault();
            return;
        }

        // (Recomendado) Bloquear DevTools shortcuts
        if (key === 'f12' || (ctrlOrCmd && input.shift && ['i', 'j', 'c'].includes(key))) {
            event.preventDefault();
            return;
        }
    });

    // SOLUCIÓN AL BUG DE INPUTS: Forzar foco al restaurar o maximizar
    win.on('restore', () => win.webContents.focus());
    win.on('maximize', () => win.webContents.focus());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
}

app.on("browser-window-created", (_e, w) => {
    if (process.platform === "win32" || process.platform === "darwin") {
        w.setContentProtection(true);
    }
});

app.whenReady().then(() => {
    createWindow();

    // Auto-update SOLO en build instalado
    if (app.isPackaged && !IS_PORTABLE) {
        autoUpdater.checkForUpdates().catch(err =>
            console.error("[Updater] checkForUpdates failed:", err)
        );
    }
});

// Lógica mejorada usando la instancia 'win' directamente
ipcMain.on('minimize-app', () => {
    if (win) win.minimize();
});

ipcMain.on('maximize-app', () => {
    if (!win) return;
    if (win.isMaximized()) {
        win.unmaximize();
    } else {
        win.maximize();
    }
    // Forzamos que el contenido web recupere el foco tras el cambio de tamaño
    win.webContents.focus();
});

ipcMain.on('close-app', () => {
    app.quit();
});

ipcMain.on("install-update", () => {
    if (!app.isPackaged) return;
    console.log("[Updater] User confirmed. Installing update...");
    autoUpdater.quitAndInstall(true, true);
});

ipcMain.handle("open-external", async (_event, url) => {
    try {
        const u = new URL(String(url));

        // seguridad mínima: solo https
        if (u.protocol !== "https:") {
            return { ok: false, message: "URL inválida (solo https)." };
        }

        await shell.openExternal(u.toString());
        return { ok: true };
    } catch (e) {
        return { ok: false, message: "URL inválida." };
    }
});

ipcMain.handle("open-payment", async (_event, url) => {
    // Verificamos que sea una URL válida
    try {
        const u = new URL(String(url));
        if (u.protocol !== "https:") throw new Error();
    } catch (e) {
        return { ok: false, message: "URL de pago inválida." };
    }

    // Creamos la ventana hija
    const paymentWin = new BrowserWindow({
        width: 500,
        height: 700,
        parent: win,       // IMPORTANTE: Hace que esta ventana dependa de la principal
        modal: true,       // Opcional: Bloquea la app principal hasta que se cierre el pago
        icon: path.join(__dirname, 'favicon.ico'),
        autoHideMenuBar: true,
        // Usamos frame: true para tener el botón "X" nativo, ya que LemonSqueezy
        // no tendrá tus botones personalizados de index.html
        frame: true,       
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    // Eliminamos el menú por defecto de Electron
    paymentWin.setMenu(null);

    // Cargamos la URL de Lemon Squeezy
    await paymentWin.loadURL(url);

    // (Opcional) Detectar cuando navega a la URL de éxito para cerrar la ventana automáticamente
    paymentWin.webContents.on('did-navigate', (event, newUrl) => {
        if (newUrl.includes('accion=pago_finalizado')) {
             // Puedes cerrar la ventana automáticamente tras unos segundos si quieres
             // setTimeout(() => paymentWin.close(), 3000);
        }
    });

    return { ok: true };
});

ipcMain.handle("get-app-version", () => app.getVersion());
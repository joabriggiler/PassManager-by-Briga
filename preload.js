const { contextBridge, ipcRenderer, clipboard } = require("electron");

// helper para suscribirse y poder desuscribirse
function on(channel, cb) {
    if (typeof cb !== "function") return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("pm", {
    getVersion: () => ipcRenderer.invoke("get-app-version"),
    openExternal: (url) => ipcRenderer.invoke("open-external", url),

    openPayment: (url) => ipcRenderer.invoke("open-payment", url),
    closePaymentWindow: () => ipcRenderer.send("close-payment-modal"),
    onPaymentLoaded: (callback) => ipcRenderer.on('payment-loaded', callback),

    window: {
        minimize: () => ipcRenderer.send("minimize-app"),
        maximize: () => ipcRenderer.send("maximize-app"),
        close: () => ipcRenderer.send("close-app"),
    },
    clipboard: {
        writeText: (t) => clipboard.writeText(String(t ?? "")),
    },

    // ✅ updater bridge
    updater: {
        onReady: (cb) => on("update-ready", cb),
        install: () => ipcRenderer.send("install-update"),
    },
});
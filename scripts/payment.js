(function () {
    async function crearCheckoutPro() {
        // tu backend no necesita body; apiAuth manda POST por defecto
        const data = await apiAuth("create_checkout", { method: "POST", body: {} });

        return data;
    }

    async function pagarPro() {
        const data = await crearCheckoutPro();
        if (data?.status !== "success" || !data?.url) return data;

        // Abrir checkout vía preload/main (Electron seguro)
        if (!window.pm || typeof window.pm.openExternal !== "function") {
        return {
            status: "error",
            message: "Falta window.pm.openExternal. Agregá el bridge en preload.js y el handler en main.js.",
        };
        }

        const r = await window.pm.openPayment(data.url);
        if (r && r.ok === false) {
        return { status: "error", message: r.message || "No se pudo abrir el checkout." };
        }

        return { status: "success" };
    }

    async function checkProStatus() {
        // esperado: {status:"success", is_pro:true/false}
        return await apiAuth("check_pro_status", { method: "POST", body: {} });
    }

    // opcional: conectar botón por id
    function wirePayButton(buttonId = "btnPro") {
        const btn = document.getElementById(buttonId);
        if (!btn) return false;

        btn.addEventListener("click", async () => {
        const r = await pagarPro();
        if (r?.status !== "success") {
            alert(r?.message || "No se pudo iniciar el pago.");
        }
        });

        return true;
    }

    // Exponer
    window.payments = { crearCheckoutPro, pagarPro, checkProStatus, wirePayButton };
})();
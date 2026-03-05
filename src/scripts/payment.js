(function () {
    async function crearCheckoutPro() {
        // tu backend no necesita body; apiAuth manda POST por defecto
        const data = await apiAuth("create_checkout", { method: "POST", body: {} });

        return data;
    }

    async function pagarPro() {
        const data = await crearCheckoutPro();
        
        // Si la API falla al crear el link, devolvemos el error tal cual
        if (data?.status !== "success" || !data?.url) return data;

        // 2. Abrimos el modal de Electron y ESPERAMOS a que se cierre
        // Esta promesa devolverá { ok: true } si llegó a la URL de éxito
        // o { ok: false } si el usuario cerró la ventana manualmente.
        const r = await window.pm.openPayment(data.url);

        // 3. Devolvemos ese objeto r directamente a procederPago()
        return r; 
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
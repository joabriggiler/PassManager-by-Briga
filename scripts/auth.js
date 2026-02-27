function prepararVistaAuth() {
    const emailEl = document.getElementById("auth_email");
    const btnDone = document.getElementById("auth_done");

    const email = (localStorage.getItem("user_email") || "").trim();
    if (emailEl) emailEl.textContent = email || "(sin email)";

    if (btnDone) {
        btnDone.addEventListener("click", async () => {
            const r = await reintentarLoginPendiente();
        });
    }
}
function prepararVistaAuth() {
    const btnDone = document.getElementById("submit_button");
    const hiddenInput = document.getElementById("auth_code");
    const boxes = document.querySelectorAll(".otp-box");

    // Sincroniza las 6 cajitas con el input oculto que usa el backend
    const syncCode = () => {
        let code = "";
        boxes.forEach(box => code += box.value);
        if (hiddenInput) hiddenInput.value = code;
    };

    boxes.forEach((box, idx) => {
        // PERMITIR FOCUS: Quitamos el mousedown preventDefault.
        // Usamos select() para que al clickear se marque el número y el usuario no pueda 
        // posicionar el cursor "atrás" o "adelante" del dígito.
        box.addEventListener("click", () => box.select());

        // Soporte para pegar el código completo (e.g. 123456)
        box.addEventListener("paste", (e) => {
            mostrarError("", boxes);
            
            e.preventDefault();
            const data = e.clipboardData.getData("text").trim().replace(/[^0-9]/g, "").slice(0, 6);
            if (data) {
                data.split("").forEach((char, i) => { if (boxes[i]) boxes[i].value = char; });
                syncCode();
                boxes[Math.min(data.length, 5)].focus();
            }
        });

        box.addEventListener("input", (e) => {
            mostrarError("", boxes); //
            
            // Forzamos que solo entren números
            e.target.value = e.target.value.replace(/[^0-9]/g, ""); 
            
            if (e.target.value === "") {
                // --- LÓGICA DE RETROCESO (SHIFT BACK) ---
                // Si el input actual queda vacío, movemos todos los valores siguientes a la izquierda
                for (let i = idx; i < boxes.length - 1; i++) {
                    boxes[i].value = boxes[i + 1].value;
                }
                // Limpiamos la última caja del grupo
                boxes[boxes.length - 1].value = "";
                
            } else if (e.target.value.length === 1 && idx < boxes.length - 1) {
                // Salto automático al siguiente si se escribió un número
                boxes[idx + 1].focus();
            }
            
            syncCode(); // Sincroniza con el input oculto
        });

        box.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && box.value.length === 0 && idx > 0) {
                boxes[idx - 1].focus();
            }
        });
    });

    if (btnDone) {
        btnDone.onclick = async (e) => {
            e.preventDefault();
            mostrarError(""); //
            alternarBotonFormulario('Verificar código', boxes[0]); //
            
            const res = await reintentarLoginPendiente(); //
            if (res.status !== "success") {
                mostrarError(res.message || "Código incorrecto", boxes, true); //
                alternarBotonFormulario('Verificar código', boxes[0]); //
                boxes.forEach(b => b.value = ""); // Limpiar todo tras error
                if (hiddenInput) hiddenInput.value = "";
                boxes[0].focus();
            }
        };
    }
}
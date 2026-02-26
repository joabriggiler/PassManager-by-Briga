const KDF_DEFAULT_ITERS = 310000; // podés ajustar
// Alias para mantener tu código nuevo tal cual
async function encriptarBlob(obj) {
  // si te llega string JSON, lo convertimos a objeto
  if (typeof obj === "string") obj = JSON.parse(obj);
  return await vault.encryptObject(obj);
}

async function desencriptarBlob(blobStr) {
  return await vault.decryptObject(blobStr); // devuelve OBJETO ya parseado
}

function bytesToB64(bytes) {
    let bin = "";
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
}
function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function generarSaltB64() {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return bytesToB64(salt);
}

const vault = (() => {
    let encKey = null;

    return {
        isUnlocked: () => !!encKey,
        unlock: (k) => { encKey = k; },
        lock: () => { encKey = null; },

        async deriveFromPassword(masterPassword, saltB64, iterations) {
        const salt = b64ToBytes(saltB64);
        const iters = iterations ?? KDF_DEFAULT_ITERS;

        const passKey = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(masterPassword),
            "PBKDF2",
            false,
            ["deriveBits"]
        );

        // 64 bytes: 32 para AES key + 32 para auth key
        const bits = await crypto.subtle.deriveBits(
            { name: "PBKDF2", hash: "SHA-256", salt, iterations: iters },
            passKey,
            512
        );

        const raw = new Uint8Array(bits);
        const encKeyBytes = raw.slice(0, 32);
        const authKeyBytes = raw.slice(32);

        const k = await crypto.subtle.importKey(
            "raw",
            encKeyBytes,
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"]
        );

        const authDigest = await crypto.subtle.digest("SHA-256", authKeyBytes);
        const authVerifierB64 = bytesToB64(new Uint8Array(authDigest));

        // best-effort zeroize
        raw.fill(0); encKeyBytes.fill(0); authKeyBytes.fill(0);

        return { encKey: k, authVerifierB64, iterations: iters };
        },

        async encryptObject(obj) {
        if (!encKey) throw new Error("Vault bloqueada.");
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const pt = new TextEncoder().encode(JSON.stringify(obj));
        const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encKey, pt);
        return JSON.stringify({
            v: 1,
            iv: bytesToB64(iv),
            ct: bytesToB64(new Uint8Array(ctBuf)),
        });
        },

        async decryptObject(blobStr) {
        if (!encKey) throw new Error("Vault bloqueada.");
        const blob = JSON.parse(blobStr);
        if (!blob || blob.v !== 1) throw new Error("Blob inválido.");
        const iv = b64ToBytes(blob.iv);
        const ct = b64ToBytes(blob.ct);
        const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, encKey, ct);
        return JSON.parse(new TextDecoder().decode(ptBuf));
        },
    };
})();


const API_BASE = 'https://passmanager-api.onrender.com/api.php';

// Guardá el access token en memoria (mejor que localStorage)
// Persistimos el access token (para que no se pierda entre vistas / recargas)
const ACCESS_TOKEN_KEY = 'pm_access_token';

function setAccessToken(t) {
    if (t) sessionStorage.setItem(ACCESS_TOKEN_KEY, t);
    else sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}
function getAccessToken() {
    return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}


const REFRESH_TOKEN_KEY = "pm_refresh_token";

function setRefreshToken(_) {}
function getRefreshToken() { return null; }

// 1) Refresh: backend devuelve { status:'success', access_token:'...' } y setea/lee cookie HttpOnly del refresh
async function refreshAccessToken() {
    const res = await fetch(`${API_BASE}?accion=refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({})
    });

    const data = await res.json();
    if (data.status === 'success' && data.access_token) {
        setAccessToken(data.access_token);
        return true;
    }

    setAccessToken(null);
    return false;
}

// 2) Fetch autenticado + reintento con refresh si hay 401
async function apiAuth(accion, { method = 'POST', body = null, query = null } = {}) {
    const url = new URL(API_BASE);
    url.searchParams.set('accion', accion);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    const doFetch = async () => {
        const headers = {};
        if (body) headers['Content-Type'] = 'application/json';

        const token = getAccessToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
            headers['X-Auth-Token'] = token; // 👈 clave para hosts que “pierden” Authorization
        }

        const res = await fetch(url.toString(), {
            method,
            headers,
            credentials: 'include',
            body: body ? JSON.stringify(body) : undefined
        });

        return { res, data: await res.json().catch(() => ({})) };
    };

    let { res, data } = await doFetch();

    if (res.status === 401) {
        const ok = await refreshAccessToken();
        if (!ok) return { status: 'error', code: 401, message: 'Sesión expirada. Iniciá sesión nuevamente.' };
        ({ res, data } = await doFetch());
    }

    return data;
}

// Control de ventana (Barra superior)
document.getElementById('minimize_app').addEventListener('click', () => window.pm.window.minimize());
document.getElementById('maximize_app').addEventListener('click', () => window.pm.window.maximize());
document.getElementById('close_app').addEventListener('click', () => window.pm.window.close());

// MOTOR DE NAVEGACIÓN
async function navegarA(pagina) {
    const main      = document.getElementById('main-content');
    const container = document.getElementById('page-container'); // Inyectamos aquí
    const loader    = document.getElementById('load_page');
    const timeoutMsg = document.getElementById('load-timeout-msg');

    loader?.classList.remove('disabled');
    container.style.opacity = "0";
    if (timeoutMsg) timeoutMsg.style.display = "none";

    const cargaLentaTimer = setTimeout(() => {
        if (timeoutMsg && loader && !loader.classList.contains('disabled')) {
        timeoutMsg.style.display = "block";
        }
    }, 5000);

    try {
        await new Promise(r => setTimeout(r, 250));

        let paginaAServir = pagina;

        if (pagina === 'dashboard') {
            // Si no hay token o la vault no está desbloqueada, no tiene sentido entrar al dashboard
            if (!getAccessToken() || !vault.isUnlocked()) {
                paginaAServir = 'login';
            } else {
                const r = await apiAuth("obtener_cuentas", { method: "GET" });

                // Sesión expirada / no autorizado → login directo
                if (r?.code === 401 || r?.status !== "success") {
                paginaAServir = 'login';
                } else if ((r.cuentas || []).length === 0) {
                paginaAServir = 'dashboard-empty';
                }
            }
        }

        const response = await fetch(`./${paginaAServir}.html`);
        if (!response.ok) throw new Error("No se pudo cargar la vista");
        
        const html = await response.text();

        Array.from(main.classList).forEach(cls => {
            if (cls.startsWith('vista-')) main.classList.remove(cls);
        });
        main.classList.add(`vista-${paginaAServir}`);

        container.innerHTML = html; 
        
        // Inicialización de vistas
        if (paginaAServir === 'dashboard') {
            prepararVistaDashboard();
        } else {
            if (paginaAServir === 'login') prepararVistaLogin();
            if (paginaAServir === 'register') prepararVistaRegister();
            if (paginaAServir === 'new-service') prepararVistaNewService();
            if (paginaAServir === 'edit-service') {
                const idGuardado = localStorage.getItem("edit_cuenta_id");
                await prepararVistaEditService(idGuardado);
            }
        }

        container.style.opacity = "1";
        loader?.classList.add('disabled');
    } catch (err) {
        loader?.classList.add('disabled');
        container.style.opacity = "1";
        const destinoRedir = getAccessToken() ? 'dashboard' : 'login';
        container.innerHTML = `
            <p class="anotacion">
            Error al cargar la página. 
            <a href="#" onclick="navegarA('${destinoRedir}')">Reintentar</a>
            </p>`;
    } finally {
        clearTimeout(cargaLentaTimer);
        if (timeoutMsg) timeoutMsg.style.display = "none";
    }
}

// 1. Registro de usuario en PassManager
async function registrarUsuario(email, masterPassword) {
    email = (email || "").trim().toLowerCase();

    const kdf_salt_b64 = generarSaltB64();
    const { authVerifierB64, iterations } = await vault.deriveFromPassword(masterPassword, kdf_salt_b64, KDF_DEFAULT_ITERS);

    const url = `${API_BASE}?accion=registro`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify({
        email,
        kdf_salt_b64,
        kdf_iter: iterations,
        auth_verifier: authVerifierB64,
        }),
    });

    // best-effort: soltar referencia
    masterPassword = null;

    return await response.json();
}

//2. Inicio de sesión de usuario en PassManager
let usuarioIdActual = null;

async function loginUsuario(email, masterPassword) {
    email = (email || "").trim().toLowerCase();

    // 1) pedir salt + iters
    const pre = await fetch(`${API_BASE}?accion=prelogin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify({ email }),
    });
    const preData = await pre.json();
    if (preData.status !== "success") return preData;

    // 2) derivar keys localmente
    const { encKey, authVerifierB64 } = await vault.deriveFromPassword(
        masterPassword,
        preData.kdf_salt_b64,
        preData.kdf_iter
    );

    // 3) login enviando SOLO auth_verifier
    const response = await fetch(`${API_BASE}?accion=login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify({ email, auth_verifier: authVerifierB64 }),
    });

    const data = await response.json();

    if (data.status === "success") {
        setAccessToken(data.access_token);
        vault.unlock(encKey); // 🔥 llave en RAM
    } else {
        vault.lock();
    }

    masterPassword = null;
    return data;
}
async function cerrarSesion(e) {
    if (e) e.preventDefault();

    const confirmar = await mostrarConfirmacionCustom("¿Estás seguro de que deseas cerrar sesión?");
    if (!confirmar) return;

    await apiAuth('logout', { method: 'POST' });
    setAccessToken(null);
    setRefreshToken(null);
    
    localStorage.clear();
    vault.lock();

    navegarA('login');
}
function mostrarOcultarPassword(svgElement){
    const input = svgElement.closest(".input").querySelector("input");
    const input2 = document.getElementById("password-repeat");
    const pathVisible = '<circle cx="12" cy="12" r="3.5"></circle><path d="M20.188 10.9343C20.5762 11.4056 20.7703 11.6412 20.7703 12C20.7703 12.3588 20.5762 12.5944 20.188 13.0657C18.7679 14.7899 15.6357 18 12 18C8.36427 18 5.23206 14.7899 3.81197 13.0657C3.42381 12.5944 3.22973 12.3588 3.22973 12C3.22973 11.6412 3.42381 11.4056 3.81197 10.9343C5.23206 9.21014 8.36427 6 12 6C15.6357 6 18.7679 9.21014 20.188 10.9343Z"></path>';
    const pathHidden = '<path fill-rule="evenodd" stroke="none" clip-rule="evenodd" d="M15.9202 12.7988C15.9725 12.5407 16 12.2736 16 12C16 9.79086 14.2091 8 12 8C11.7264 8 11.4593 8.02746 11.2012 8.07977L12.1239 9.00251C13.6822 9.06583 14.9342 10.3178 14.9975 11.8761L15.9202 12.7988ZM9.39311 10.5143C9.14295 10.9523 9 11.4595 9 12C9 13.6569 10.3431 15 12 15C12.5405 15 13.0477 14.857 13.4857 14.6069L14.212 15.3332C13.5784 15.7545 12.8179 16 12 16C9.79086 16 8 14.2091 8 12C8 11.1821 8.24547 10.4216 8.66676 9.78799L9.39311 10.5143Z" fill="#ffffff"></path><path stroke="none" fill-rule="evenodd" clip-rule="evenodd" d="M16.1537 17.2751L15.4193 16.5406C14.3553 17.1196 13.1987 17.5 12 17.5C10.3282 17.5 8.73816 16.7599 7.36714 15.7735C6.00006 14.79 4.89306 13.5918 4.19792 12.7478C3.77356 12.2326 3.72974 12.1435 3.72974 12C3.72974 11.8565 3.77356 11.7674 4.19792 11.2522C4.86721 10.4396 5.9183 9.29863 7.21572 8.33704L6.50139 7.62271C5.16991 8.63072 4.10383 9.79349 3.42604 10.6164L3.36723 10.6876C3.03671 11.087 2.72974 11.4579 2.72974 12C2.72974 12.5421 3.0367 12.913 3.36723 13.3124L3.42604 13.3836C4.15099 14.2638 5.32014 15.5327 6.78312 16.5853C8.24216 17.635 10.0361 18.5 12 18.5C13.5101 18.5 14.9196 17.9886 16.1537 17.2751ZM9.18993 6.06861C10.0698 5.71828 11.0135 5.5 12 5.5C13.9639 5.5 15.7579 6.365 17.2169 7.41472C18.6799 8.46727 19.849 9.73623 20.574 10.6164L20.6328 10.6876C20.9633 11.087 21.2703 11.4579 21.2703 12C21.2703 12.5421 20.9633 12.913 20.6328 13.3124L20.574 13.3836C20.0935 13.9669 19.418 14.721 18.5911 15.4697L17.883 14.7617C18.6787 14.0456 19.3338 13.3164 19.8021 12.7478C20.2265 12.2326 20.2703 12.1435 20.2703 12C20.2703 11.8565 20.2265 11.7674 19.8021 11.2522C19.107 10.4082 18 9.21001 16.6329 8.22646C15.2619 7.24007 13.6718 6.5 12 6.5C11.3056 6.5 10.6253 6.62768 9.96897 6.84765L9.18993 6.06861Z" fill="#ffffff"></path><path d="M5 2L21 18" stroke="#ffffff"></path>';

    input.type = input.type === 'password' ? 'text' : 'password';
    svgElement.innerHTML = input.type === 'password' ? pathVisible : pathHidden;

    if(input2) input2.type = input2.type === 'password' ? 'text' : 'password';

    clearTimeout(input._hideT);
    if (input.type === "text") input._hideT = setTimeout(() => { if (input.type === "text") { input.type = "password"; svgElement.innerHTML = pathVisible; if (input2) input2.type = "password"; } }, 4000);
}

//3. Añadir cuenta de servicio a PassManager
async function guardarCuentaServicio(servicio, emailServicio, passServicio, urlServicio) {
    if (!vault.isUnlocked()) {
        return { status: "error", message: "Vault bloqueada. Iniciá sesión nuevamente." };
    }

    const blob = await vault.encryptObject({
        servicio,
        email_servicio: emailServicio,
        pass_servicio: passServicio,
        url_servicio: urlServicio,
    });

    return await apiAuth("guardar_servicio", {
        method: "POST",
        body: { blob },
    });
}

// Función para mostrar errores en el HTML
function mostrarError(mensaje, inputElement = null, esAdvertencia = false) {
    document.querySelectorAll(".message_error_input").forEach(el => el.remove());

    if (inputElement) inputElement.classList.remove("different-password"); 

    if (!mensaje || !inputElement) return;

    if (esAdvertencia) inputElement.classList.add("different-password");

    const pError = document.createElement("p");
    pError.className = "message_error_input";
    
    if (esAdvertencia) pError.classList.add("warning-yellow");

    pError.innerText = mensaje;

    const contenedorInput = inputElement.closest(".input");
    if (contenedorInput) contenedorInput.after(pError);
}

//Alternar boton de formulario
function alternarBotonFormulario(texto = 'Entrar', input = null) {
    const log_button = document.getElementById("submit_button");
    if(log_button.disabled){
        log_button.disabled = false;
        log_button.innerHTML = texto; // Usa el texto que necesites
        if(input) input.disabled = false;
    } else {
        log_button.disabled = true;
        log_button.innerHTML = '<svg style="width: 20px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><radialGradient id="a11" cx=".66" fx=".66" cy=".3125" fy=".3125" gradientTransform="scale(1.5)"><stop offset="0" stop-color="#FFFFFF"></stop><stop offset=".3" stop-color="#FFFFFF" stop-opacity=".9"></stop><stop offset=".6" stop-color="#FFFFFF" stop-opacity=".6"></stop><stop offset=".8" stop-color="#FFFFFF" stop-opacity=".3"></stop><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"></stop></radialGradient><circle transform-origin="center" fill="none" stroke="url(#a11)" stroke-width="23" stroke-linecap="round" stroke-dasharray="200 1000" stroke-dashoffset="0" cx="100" cy="100" r="70"><animateTransform type="rotate" attributeName="transform" calcMode="spline" dur="2" values="360;0" keyTimes="0;1" keySplines="0 0 1 1" repeatCount="indefinite"></animateTransform></circle><circle transform-origin="center" fill="none" opacity=".2" stroke="#FFFFFF" stroke-width="23" stroke-linecap="round" cx="100" cy="100" r="70"></circle></svg>';
        if(input) input.blur();
        if(input) input.disabled = true;
    }
}

// Inicio de la App
async function inicializarApp() {
    const loader = document.getElementById('load_page');
    const timeoutMsg = document.getElementById('load-timeout-msg');

    // asegurar estado inicial
    loader?.classList.remove('disabled');
    if (timeoutMsg) timeoutMsg.style.display = "none";

    const t = setTimeout(() => {
        if (timeoutMsg && loader && !loader.classList.contains('disabled')) {
        timeoutMsg.style.display = "block";
        }
    }, 5000);

    const ok = await refreshAccessToken();

    clearTimeout(t);
    if (timeoutMsg) timeoutMsg.style.display = "none";

    if (ok) navegarA('dashboard');
    else navegarA('login');
}


const urlParams = new URLSearchParams(window.location.search);
const isModal = urlParams.get('mode') === 'modal';

if (isModal) {
    // 1. Ocultar botones innecesarios y el loader
    document.getElementById('maximize_app').style.display = 'none';
    document.getElementById('app_version').style.display = 'none';
    const loader = document.getElementById('load_page');
    if (loader) {
        loader.classList.remove('disabled'); 
        loader.style.display = 'flex'; // Aseguramos que se vea
    }

    // 2. Cambiar el comportamiento del botón CERRAR
    const oldCloseBtn = document.getElementById('close_app');
    const newCloseBtn = oldCloseBtn.cloneNode(true);
    oldCloseBtn.parentNode.replaceChild(newCloseBtn, oldCloseBtn);
    
    newCloseBtn.addEventListener('click', () => {
        window.close(); 
    });

    // 3. NUEVO: Escuchamos cuando Main nos diga "Lemon ya cargó"
    if (window.pm && window.pm.onPaymentLoaded) {
        window.pm.onPaymentLoaded(() => {
            // Ocultamos tu loader HTML
            if (loader) loader.classList.add('disabled');
        });
    }

} else {
    // Ejecutar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializarApp);
    } else {
        inicializarApp();
    }
}

async function procederPago(button) {
    const opacador = document.querySelector(".opacador");
    opacador.classList.add("modal-enabled");
    button.blur();

    const box = {
        svg: `<g transform="translate(0.000000,800.000000) scale(0.100000,-0.100000)" fill="white" stroke="none"> <path d="M3760 7379 c-136 -21 -200 -32 -275 -51 -131 -32 -142 -35 -153 -42 -6 -3 -53 -22 -105 -40 -167 -60 -388 -187 -547 -314 -98 -78 -240 -216 -820 -792 -313 -311 -649 -645 -747 -742 -251 -249 -322 -329 -378 -423 -11 -19 -36 -56 -55 -82 -19 -26 -51 -81 -72 -121 -21 -41 -44 -86 -52 -100 -25 -49 -35 -76 -75 -207 -21 -71 -44 -161 -51 -200 -6 -38 -16 -94 -21 -124 -12 -69 -12 -355 0 -418 5 -26 14 -79 21 -118 17 -99 86 -330 119 -395 73 -146 98 -192 154 -275 124 -184 170 -234 739 -789 90 -87 301 -294 469 -460 390 -384 492 -481 559 -533 30 -23 65 -51 77 -62 12 -12 26 -21 30 -22 4 0 35 -20 68 -44 115 -84 382 -220 530 -270 312 -105 473 -130 815 -129 288 0 396 15 635 86 55 17 109 32 120 35 11 3 44 16 73 29 29 13 54 24 57 24 2 0 38 16 79 35 42 19 79 35 83 35 3 0 14 6 22 14 9 7 50 31 91 52 41 21 81 44 88 51 8 8 28 21 45 30 18 9 66 43 107 77 41 33 84 68 94 76 86 68 293 271 1069 1047 530 530 549 551 673 738 100 151 217 419 255 584 54 234 51 601 -6 816 -28 105 -86 257 -136 356 -27 53 -49 99 -49 102 0 11 -127 194 -181 262 -31 39 -208 223 -393 410 -186 187 -377 381 -425 431 -144 148 -142 147 -274 147 -79 0 -127 -5 -161 -17 -74 -25 -183 -82 -256 -134 -64 -44 -320 -288 -320 -304 0 -5 235 -244 523 -532 287 -289 538 -544 557 -567 40 -48 80 -105 80 -114 0 -3 11 -22 24 -43 29 -43 40 -76 85 -248 14 -54 14 -280 0 -341 -25 -107 -32 -130 -56 -183 -36 -79 -96 -179 -135 -225 -26 -32 -717 -723 -1083 -1085 -44 -43 -88 -87 -97 -97 -117 -123 -320 -307 -387 -352 -20 -13 -45 -32 -56 -42 -48 -43 -242 -128 -395 -173 -219 -65 -469 -72 -675 -20 -182 46 -234 65 -352 126 -204 105 -187 90 -943 833 -777 764 -804 792 -891 927 -36 56 -76 153 -90 217 -33 154 -41 211 -36 286 8 126 66 323 117 395 10 14 28 43 40 64 12 22 38 59 58 84 64 76 1456 1462 1627 1619 129 118 214 179 318 228 51 23 101 45 113 49 11 3 72 59 135 124 356 365 655 654 752 726 21 16 35 32 30 37 -13 13 -227 57 -356 74 -126 16 -336 18 -427 4z"/> <path d="M5775 7370 c-173 -27 -287 -53 -390 -90 -49 -17 -110 -39 -135 -47 -65 -23 -188 -89 -338 -182 -46 -28 -86 -51 -88 -51 -3 0 -23 -17 -45 -37 -22 -20 -54 -44 -71 -52 -17 -8 -206 -191 -420 -406 -1033 -1038 -1354 -1364 -1392 -1414 -219 -285 -362 -608 -401 -900 -19 -149 -19 -394 1 -530 30 -206 148 -505 278 -705 107 -165 203 -271 567 -631 123 -121 248 -246 279 -277 35 -37 71 -63 99 -73 63 -22 223 -38 311 -31 79 7 239 44 311 73 100 39 217 118 324 217 l50 45 -341 338 c-187 186 -381 377 -430 424 -79 76 -216 219 -307 320 -71 80 -155 256 -186 392 -16 67 -14 290 3 367 32 148 102 293 195 405 59 70 1549 1564 1627 1631 163 140 376 246 569 285 74 14 336 15 390 1 22 -6 63 -16 90 -23 28 -7 77 -24 110 -39 33 -15 76 -35 95 -43 103 -47 245 -163 461 -377 646 -638 1419 -1415 1449 -1455 87 -117 139 -225 175 -370 30 -119 35 -208 17 -315 -34 -204 -91 -335 -206 -475 -43 -52 -338 -349 -739 -745 -131 -129 -248 -247 -259 -262 -10 -16 -23 -28 -27 -28 -8 0 -92 -79 -321 -304 -80 -78 -161 -153 -180 -166 -19 -13 -49 -36 -67 -51 -29 -25 -175 -100 -266 -136 -27 -11 -141 -119 -390 -368 -194 -193 -370 -365 -392 -381 -55 -40 -142 -109 -190 -150 -22 -19 -49 -40 -59 -48 -29 -20 -13 -33 59 -45 36 -6 95 -16 133 -23 94 -17 523 -17 632 0 119 19 213 38 300 63 41 11 89 24 105 28 58 16 73 22 250 101 92 41 100 45 163 82 34 21 65 38 68 38 8 0 206 136 235 162 15 13 38 32 52 43 63 50 137 118 236 215 59 58 138 135 176 172 39 36 125 122 191 190 67 67 229 227 360 355 614 595 661 645 806 866 194 294 298 631 298 964 0 117 -3 156 -31 348 -26 178 -162 510 -275 671 -142 204 -127 188 -1303 1349 -590 582 -596 588 -736 687 -55 39 -117 84 -138 100 -48 37 -271 150 -339 172 -29 10 -89 30 -133 46 -251 89 -600 121 -870 80z"/> </g>`,
        titulo: "Continuá con el pago",
        descripcion: "El pago se procesa a través de Lemon Squeezy.<br>PassManager no almacena datos de tu tarjeta.",
        boton: false
    }
    mostrarConfirmacionCustom(undefined, undefined, box); 

    // Esta variable nos dirá si el usuario llegó a pagar con éxito
    let pasoALaVerificacion = false;

    try {
        // 1. Esperamos a que el modal se cierre
        const resultado = await window.payments.pagarPro();

        // 2. ¿El usuario cerró la ventana o Lemon devolvió error?
        if (resultado && resultado.ok) {
            pasoALaVerificacion = true;
            await iniciarVerificacionPro(opacador);
        }

    } catch (error) {
        console.error("Error crítico en el flujo de pago:", error);

        const boxError = {
            svg: `<g transform="translate(0.000000,800.000000) scale(0.100000,-0.100000)" fill="white" stroke="none"> <path d="M3760 7379 c-136 -21 -200 -32 -275 -51 -131 -32 -142 -35 -153 -42 -6 -3 -53 -22 -105 -40 -167 -60 -388 -187 -547 -314 -98 -78 -240 -216 -820 -792 -313 -311 -649 -645 -747 -742 -251 -249 -322 -329 -378 -423 -11 -19 -36 -56 -55 -82 -19 -26 -51 -81 -72 -121 -21 -41 -44 -86 -52 -100 -25 -49 -35 -76 -75 -207 -21 -71 -44 -161 -51 -200 -6 -38 -16 -94 -21 -124 -12 -69 -12 -355 0 -418 5 -26 14 -79 21 -118 17 -99 86 -330 119 -395 73 -146 98 -192 154 -275 124 -184 170 -234 739 -789 90 -87 301 -294 469 -460 390 -384 492 -481 559 -533 30 -23 65 -51 77 -62 12 -12 26 -21 30 -22 4 0 35 -20 68 -44 115 -84 382 -220 530 -270 312 -105 473 -130 815 -129 288 0 396 15 635 86 55 17 109 32 120 35 11 3 44 16 73 29 29 13 54 24 57 24 2 0 38 16 79 35 42 19 79 35 83 35 3 0 14 6 22 14 9 7 50 31 91 52 41 21 81 44 88 51 8 8 28 21 45 30 18 9 66 43 107 77 41 33 84 68 94 76 86 68 293 271 1069 1047 530 530 549 551 673 738 100 151 217 419 255 584 54 234 51 601 -6 816 -28 105 -86 257 -136 356 -27 53 -49 99 -49 102 0 11 -127 194 -181 262 -31 39 -208 223 -393 410 -186 187 -377 381 -425 431 -144 148 -142 147 -274 147 -79 0 -127 -5 -161 -17 -74 -25 -183 -82 -256 -134 -64 -44 -320 -288 -320 -304 0 -5 235 -244 523 -532 287 -289 538 -544 557 -567 40 -48 80 -105 80 -114 0 -3 11 -22 24 -43 29 -43 40 -76 85 -248 14 -54 14 -280 0 -341 -25 -107 -32 -130 -56 -183 -36 -79 -96 -179 -135 -225 -26 -32 -717 -723 -1083 -1085 -44 -43 -88 -87 -97 -97 -117 -123 -320 -307 -387 -352 -20 -13 -45 -32 -56 -42 -48 -43 -242 -128 -395 -173 -219 -65 -469 -72 -675 -20 -182 46 -234 65 -352 126 -204 105 -187 90 -943 833 -777 764 -804 792 -891 927 -36 56 -76 153 -90 217 -33 154 -41 211 -36 286 8 126 66 323 117 395 10 14 28 43 40 64 12 22 38 59 58 84 64 76 1456 1462 1627 1619 129 118 214 179 318 228 51 23 101 45 113 49 11 3 72 59 135 124 356 365 655 654 752 726 21 16 35 32 30 37 -13 13 -227 57 -356 74 -126 16 -336 18 -427 4z"/> <path d="M5775 7370 c-173 -27 -287 -53 -390 -90 -49 -17 -110 -39 -135 -47 -65 -23 -188 -89 -338 -182 -46 -28 -86 -51 -88 -51 -3 0 -23 -17 -45 -37 -22 -20 -54 -44 -71 -52 -17 -8 -206 -191 -420 -406 -1033 -1038 -1354 -1364 -1392 -1414 -219 -285 -362 -608 -401 -900 -19 -149 -19 -394 1 -530 30 -206 148 -505 278 -705 107 -165 203 -271 567 -631 123 -121 248 -246 279 -277 35 -37 71 -63 99 -73 63 -22 223 -38 311 -31 79 7 239 44 311 73 100 39 217 118 324 217 l50 45 -341 338 c-187 186 -381 377 -430 424 -79 76 -216 219 -307 320 -71 80 -155 256 -186 392 -16 67 -14 290 3 367 32 148 102 293 195 405 59 70 1549 1564 1627 1631 163 140 376 246 569 285 74 14 336 15 390 1 22 -6 63 -16 90 -23 28 -7 77 -24 110 -39 33 -15 76 -35 95 -43 103 -47 245 -163 461 -377 646 -638 1419 -1415 1449 -1455 87 -117 139 -225 175 -370 30 -119 35 -208 17 -315 -34 -204 -91 -335 -206 -475 -43 -52 -338 -349 -739 -745 -131 -129 -248 -247 -259 -262 -10 -16 -23 -28 -27 -28 -8 0 -92 -79 -321 -304 -80 -78 -161 -153 -180 -166 -19 -13 -49 -36 -67 -51 -29 -25 -175 -100 -266 -136 -27 -11 -141 -119 -390 -368 -194 -193 -370 -365 -392 -381 -55 -40 -142 -109 -190 -150 -22 -19 -49 -40 -59 -48 -29 -20 -13 -33 59 -45 36 -6 95 -16 133 -23 94 -17 523 -17 632 0 119 19 213 38 300 63 41 11 89 24 105 28 58 16 73 22 250 101 92 41 100 45 163 82 34 21 65 38 68 38 8 0 206 136 235 162 15 13 38 32 52 43 63 50 137 118 236 215 59 58 138 135 176 172 39 36 125 122 191 190 67 67 229 227 360 355 614 595 661 645 806 866 194 294 298 631 298 964 0 117 -3 156 -31 348 -26 178 -162 510 -275 671 -142 204 -127 188 -1303 1349 -590 582 -596 588 -736 687 -55 39 -117 84 -138 100 -48 37 -271 150 -339 172 -29 10 -89 30 -133 46 -251 89 -600 121 -870 80z"/> </g>`,
            titulo: "Hubo un problema con el pago",
            descripcion: "Lo sentimos, no pudimos confirmar tu pago.<br>Inténtalo de nuevo más tarde.",
            boton: "Aceptar"
        }
        mostrarConfirmacionCustom(undefined, undefined, boxError); 
    } finally {
        // SI ALGO FALLÓ (el bridge, el modal se cerró antes, o hubo un error de red)
        if (!pasoALaVerificacion) {
            document.querySelector('.opacador')?.classList.remove('enabled','enabled-box', 'modal-enabled');
        }
    }
    
    return false;
}

// Separamos la lógica de verificación para que el código sea legible
async function iniciarVerificacionPro(opacador) {
    let intentos = 0;
    const maxIntentos = 10; // 10 intentos * 2 seg = 20 segundos

    // Usamos una Promesa para que 'procederPago' pueda hacer el 'await' correctamente
    return new Promise((resolve) => {
        const verificar = async () => {
            intentos++;
            const res = await window.payments.checkProStatus();
            
            if (res.status === "success" && res.is_pro) {
                opacador.classList.remove("modal-enabled");
                const box = {
                    svg: `<linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%"> <stop offset="0%" style="stop-color:#BF953F; stop-opacity:1"></stop> <stop offset="25%" style="stop-color:#FCF6BA; stop-opacity:1"></stop> <stop offset="50%" style="stop-color:#B38728; stop-opacity:1"></stop> <stop offset="75%" style="stop-color:#FBF5B7; stop-opacity:1"></stop> <stop offset="100%" style="stop-color:#AA771C; stop-opacity:1"></stop> </linearGradient> <filter id="shadow" x="0" y="0" width="200%" height="200%"> <feDropShadow dx="1" dy="1" stdDeviation="0.5" flood-opacity="0.3"></feDropShadow> </filter> <g transform="translate(0.000000,800.000000) scale(0.100000,-0.100000)" fill="url(#goldGradient)" filter="url(#shadow)"> <path d="M3760 7379 c-136 -21 -200 -32 -275 -51 -131 -32 -142 -35 -153 -42 -6 -3 -53 -22 -105 -40 -167 -60 -388 -187 -547 -314 -98 -78 -240 -216 -820 -792 -313 -311 -649 -645 -747 -742 -251 -249 -322 -329 -378 -423 -11 -19 -36 -56 -55 -82 -19 -26 -51 -81 -72 -121 -21 -41 -44 -86 -52 -100 -25 -49 -35 -76 -75 -207 -21 -71 -44 -161 -51 -200 -6 -38 -16 -94 -21 -124 -12 -69 -12 -355 0 -418 5 -26 14 -79 21 -118 17 -99 86 -330 119 -395 73 -146 98 -192 154 -275 124 -184 170 -234 739 -789 90 -87 301 -294 469 -460 390 -384 492 -481 559 -533 30 -23 65 -51 77 -62 12 -12 26 -21 30 -22 4 0 35 -20 68 -44 115 -84 382 -220 530 -270 312 -105 473 -130 815 -129 288 0 396 15 635 86 55 17 109 32 120 35 11 3 44 16 73 29 29 13 54 24 57 24 2 0 38 16 79 35 42 19 79 35 83 35 3 0 14 6 22 14 9 7 50 31 91 52 41 21 81 44 88 51 8 8 28 21 45 30 18 9 66 43 107 77 41 33 84 68 94 76 86 68 293 271 1069 1047 530 530 549 551 673 738 100 151 217 419 255 584 54 234 51 601 -6 816 -28 105 -86 257 -136 356 -27 53 -49 99 -49 102 0 11 -127 194 -181 262 -31 39 -208 223 -393 410 -186 187 -377 381 -425 431 -144 148 -142 147 -274 147 -79 0 -127 -5 -161 -17 -74 -25 -183 -82 -256 -134 -64 -44 -320 -288 -320 -304 0 -5 235 -244 523 -532 287 -289 538 -544 557 -567 40 -48 80 -105 80 -114 0 -3 11 -22 24 -43 29 -43 40 -76 85 -248 14 -54 14 -280 0 -341 -25 -107 -32 -130 -56 -183 -36 -79 -96 -179 -135 -225 -26 -32 -717 -723 -1083 -1085 -44 -43 -88 -87 -97 -97 -117 -123 -320 -307 -387 -352 -20 -13 -45 -32 -56 -42 -48 -43 -242 -128 -395 -173 -219 -65 -469 -72 -675 -20 -182 46 -234 65 -352 126 -204 105 -187 90 -943 833 -777 764 -804 792 -891 927 -36 56 -76 153 -90 217 -33 154 -41 211 -36 286 8 126 66 323 117 395 10 14 28 43 40 64 12 22 38 59 58 84 64 76 1456 1462 1627 1619 129 118 214 179 318 228 51 23 101 45 113 49 11 3 72 59 135 124 356 365 655 654 752 726 21 16 35 32 30 37 -13 13 -227 57 -356 74 -126 16 -336 18 -427 4z"></path> <path d="M5775 7370 c-173 -27 -287 -53 -390 -90 -49 -17 -110 -39 -135 -47 -65 -23 -188 -89 -338 -182 -46 -28 -86 -51 -88 -51 -3 0 -23 -17 -45 -37 -22 -20 -54 -44 -71 -52 -17 -8 -206 -191 -420 -406 -1033 -1038 -1354 -1364 -1392 -1414 -219 -285 -362 -608 -401 -900 -19 -149 -19 -394 1 -530 30 -206 148 -505 278 -705 107 -165 203 -271 567 -631 123 -121 248 -246 279 -277 35 -37 71 -63 99 -73 63 -22 223 -38 311 -31 79 7 239 44 311 73 100 39 217 118 324 217 l50 45 -341 338 c-187 186 -381 377 -430 424 -79 76 -216 219 -307 320 -71 80 -155 256 -186 392 -16 67 -14 290 3 367 32 148 102 293 195 405 59 70 1549 1564 1627 1631 163 140 376 246 569 285 74 14 336 15 390 1 22 -6 63 -16 90 -23 28 -7 77 -24 110 -39 33 -15 76 -35 95 -43 103 -47 245 -163 461 -377 646 -638 1419 -1415 1449 -1455 87 -117 139 -225 175 -370 30 -119 35 -208 17 -315 -34 -204 -91 -335 -206 -475 -43 -52 -338 -349 -739 -745 -131 -129 -248 -247 -259 -262 -10 -16 -23 -28 -27 -28 -8 0 -92 -79 -321 -304 -80 -78 -161 -153 -180 -166 -19 -13 -49 -36 -67 -51 -29 -25 -175 -100 -266 -136 -27 -11 -141 -119 -390 -368 -194 -193 -370 -365 -392 -381 -55 -40 -142 -109 -190 -150 -22 -19 -49 -40 -59 -48 -29 -20 -13 -33 59 -45 36 -6 95 -16 133 -23 94 -17 523 -17 632 0 119 19 213 38 300 63 41 11 89 24 105 28 58 16 73 22 250 101 92 41 100 45 163 82 34 21 65 38 68 38 8 0 206 136 235 162 15 13 38 32 52 43 63 50 137 118 236 215 59 58 138 135 176 172 39 36 125 122 191 190 67 67 229 227 360 355 614 595 661 645 806 866 194 294 298 631 298 964 0 117 -3 156 -31 348 -26 178 -162 510 -275 671 -142 204 -127 188 -1303 1349 -590 582 -596 588 -736 687 -55 39 -117 84 -138 100 -48 37 -271 150 -339 172 -29 10 -89 30 -133 46 -251 89 -600 121 -870 80z"></path> </g>`,
                    titulo: "Bienvenido a PassManager Pro",
                    descripcion: "¡Muchas gracias por adquirir PassManager Pro!<br>Tu cuenta ha sido actualizada exitosamente.",
                    boton: "Entendido",
                    confetti: true
                };
                mostrarConfirmacionCustom(undefined, undefined, box); 
                resolve(true); // Terminó con éxito
                return;
            }

            if (intentos < maxIntentos) {
                setTimeout(verificar, 2000); 
            } else {
                opacador.classList.remove("modal-enabled");
                mostrarConfirmacionCustom("El pago se procesó, pero la activación tarda. Reinicia la app en unos minutos.", false); 
                resolve(false); // Terminó por timeout
            }
        };
        verificar();
    });
}

function mostrarConfirmacionCustom(mensaje, cancelOption = true, box = false) {
    const opacador = document.querySelector('.opacador');
    const txtMensaje = opacador.querySelector('.alert-body p');
    const footerAlert = opacador.querySelector('.footer-alert');
    
    if(!box){
        // Manejo de alert
        txtMensaje.innerText = mensaje;
        opacador.classList.add("enabled");
        footerAlert.classList.remove("disabled");
    } else {
        // Manejo de box
        footerAlert.classList.add("disabled");
        opacador.classList.add("enabled-box");
        
        // Personalización de box
        const alertBox = document.querySelector(".alert-box");
        alertBox.querySelector(".titulo").innerHTML = box.titulo;
        alertBox.querySelector(".anotacion").innerHTML = box.descripcion;
        alertBox.querySelector(".button").innerText = box.boton;
        alertBox.querySelector(".svg").innerHTML = box.svg;

        const btn = alertBox.querySelector(".button");
        btn.hidden = false;
        btn.disabled = false;
        btn.innerText = "";

        if (!box?.boton) {
            btn.hidden = true;
        } else {
            btn.innerText = box.boton;
        }

        if (box?.confetti) fireConfetti();
    }

    return new Promise((resolve) => {
        const btnAceptar = document.getElementById('alert_aceptar');
        const btnCancelar = document.getElementById('alert_cancelar');
        const btnCerrar = document.getElementById('close_alert');
        const btnContinuar = document.getElementById('close_box');

        if(!cancelOption) btnCancelar.style.display = "none";

        function finalizar(valor) {
            opacador.classList.remove("enabled");
            opacador.classList.remove("enabled-box");
            // Limpiamos los eventos para que no se acumulen
            btnAceptar.onclick = null;
            btnCancelar.onclick = null;
            btnCerrar.onclick = null;
            btnContinuar.onclick = null;
            resolve(valor);
        }

        btnAceptar.onclick = () => finalizar(true);
        btnCancelar.onclick = () => finalizar(false);
        btnCerrar.onclick = () => finalizar(false);
        btnContinuar.onclick = () => finalizar(true);
    });
}

//Modificado de cuentas alojadas en PassManager
async function obtenerDatosCuenta(id){
    if (!id) return;

    return await apiAuth('obtener_una', {
        method: 'POST',
        body: { id: id }
    });
}

async function editarCuentaServicio(id) {
    localStorage.setItem("edit_cuenta_id", id); // Guardamos el ID
    navegarA("edit-service");
}

// Guardar cambios
async function guardarCambiosServicio(idCuenta, cuentaPlana) {
    // Reemplazá encriptarBlob por TU función real de encriptado
    const blob = await encriptarBlob(cuentaPlana);

    return await apiAuth("editar_servicio", {
        method: "POST",
        body: {
        id: idCuenta,
        blob: blob
        }
    });
}

async function cuentaDesdeRow(row) {
    try {
        const data = await desencriptarBlob(row.blob); // data es OBJETO
        return { id: row.id, ...data };
    } catch (e) {
        console.error("Error al desencriptar/parsear blob:", e);
        return null;
    }
}

// Preparar pestaña
async function prepararVistaEditService(id_service) {
    if (!id_service) {
        navegarA("dashboard");
        return;
    }

    if (!vault.isUnlocked()) {
        mostrarError("Vault bloqueada. Iniciá sesión nuevamente.");
        return;
    }

    // Imprimir los datos
    const respuesta = await obtenerDatosCuenta(id_service);
    localStorage.removeItem("edit_cuenta_id");

    if (respuesta.status === "success") {
        const cuenta = await cuentaDesdeRow(respuesta.cuenta);

        if (!cuenta) {
            mostrarError("No se pudo leer la cuenta (blob inválido o corrupto).");
            return;
        }

        document.getElementById("servicio_nombre").innerText = cuenta.servicio ?? "";
        document.getElementById("email").value = cuenta.email_servicio ?? "";
        document.getElementById("password").value = cuenta.pass_servicio ?? "";

        const logo = document.getElementById("logo_preview");
        if (logo) {
            if (cuenta.url_servicio) {
            logo.src = `https://www.google.com/s2/favicons?domain=${cuenta.url_servicio}&sz=64`;
            logo.style.display = "block";
            } else {
            logo.style.display = "none";
            }
        }

        localStorage.removeItem("edit_cuenta_id");
    }

    const password_pass_input = document.getElementById("pass_password");
    if (!password_pass_input) {
        mostrarError("Falta el input de contraseña de usuario (pass_password).");
        return;
    }

    // --- LIMPIEZA DE ERRORES ---
    password_pass_input.addEventListener("input", () => {
        if(password_pass_input.classList.contains("different-password")) password_pass_input.classList.remove("different-password");
        
        const errorLabel = password_pass_input.closest(".input")?.nextElementSibling;
        if (errorLabel && errorLabel.classList.contains("message_error_input")) {
            errorLabel.remove();
        }
    });

    //Boton de Guardado de cambios
    const form = document.getElementById("edit_service_form");
    if (!form) return;

    if (form.dataset.bound === "1") return; // ya tiene listeners
    form.dataset.bound = "1";
    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        mostrarError("");
        alternarBotonFormulario();

        const emailNuevo = document.getElementById("email").value;
        const passNueva = document.getElementById("password").value;

        const email_user = localStorage.getItem("user_email");
        const password_user = password_pass_input.value;

        try {
            const resultadoLogin = await loginUsuario(email_user, password_user);
            if (resultadoLogin.status !== "success") {
            mostrarError(resultadoLogin.message, password_pass_input, true);
            alternarBotonFormulario("Guardar cambios");
            return;
            }

            // 1) Traigo la cuenta actual (row)
            const resp = await obtenerDatosCuenta(id_service);
            if (resp.status !== "success") {
            mostrarError(resp.message || "No se pudo cargar la cuenta.");
            alternarBotonFormulario("Guardar cambios");
            return;
            }

            // 2) La vuelvo “plana”
            const cuenta = await cuentaDesdeRow(resp.cuenta);

            // 3) Modifico lo editable
            cuenta.email_servicio = emailNuevo;
            cuenta.pass_servicio = passNueva;

            // 4) Guardo enviando blob
            const r = await guardarCambiosServicio(id_service, cuenta);
            if (r.status === "success") {
            navegarA("dashboard");
            } else {
            mostrarError(r.message);
            alternarBotonFormulario("Guardar cambios");
            }
        } catch (e) {
            mostrarError("Error de conexión");
            alternarBotonFormulario("Guardar cambios");
        }
    });
}

//Mostrar posible actualizacion
if (window.pm?.updater?.onReady) {
    window.pm.updater.onReady(async () => {
        const ok = await mostrarConfirmacionCustom(
        "Hay una actualización lista para instalar.\n¿Querés actualizar ahora? (La app se reiniciará)"
        );
        if (ok) window.pm.updater.install();
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    const el = document.getElementById("app_version");
    const getV = window.pm?.getVersion || window.pm?.window?.getVersion;
    if (!el || !getV) return;

    try {
        const v = await getV();
        el.textContent = `v${v}`;
    } catch {
        el.textContent = ""; // o "v?" si querés ver que falló
    }
});

// Title artificial de PassManager
(() => {
    const tip = document.createElement("div");
    tip.className = "tooltip";
    document.body.appendChild(tip);

    let current = null;
    let showTimer = null;
    let suppressEl = null; // si clickeo el elemento, no vuelve a mostrar hasta salir y re-entrar
    const SHOW_DELAY = 200;
    const OFFSET = 19;
    const MARGIN = 25;

    function clamp(n, min, max) {
        return Math.max(min, Math.min(n, max));
    }

    function placeOver(el) {
        const r = el.getBoundingClientRect();
        tip.style.left = "0px";
        tip.style.top = "0px";

        // aseguramos que el tooltip tenga contenido antes de medir
        const tr = tip.getBoundingClientRect();

        let x = r.left + (r.width / 2) - (tr.width / 2);
        let y = r.top - tr.height - OFFSET;

        // si no entra arriba, lo ponemos abajo
        if (y < MARGIN) y = r.bottom + OFFSET;

        // clamp a viewport
        x = clamp(x, MARGIN, window.innerWidth - tr.width - MARGIN);
        y = clamp(y, MARGIN, window.innerHeight - tr.height - MARGIN);

        tip.style.left = x + "px";
        tip.style.top  = y + "px";
    }

    function show(el) {
        const text = el.getAttribute("data-tooltip") || "";
        if (!text) return;

        clearTimeout(showTimer);
        current = el;

        showTimer = setTimeout(() => {
            if (!current) return;
            tip.textContent = text;
            tip.classList.add("is-visible");
            requestAnimationFrame(() => current && placeOver(current));
        }, SHOW_DELAY);
    }

    function hide() {
        clearTimeout(showTimer);
        showTimer = null;
        current = null;
        tip.classList.remove("is-visible");
    }

    document.addEventListener("pointerover", (e) => {
        const el = e.target.closest("[data-tooltip]");
        if (!el || el === current) return;
        if (el === suppressEl) return;
        hide();
        show(el);
    });

    document.addEventListener("pointerout", (e) => {
        const el = e.target.closest("[data-tooltip]");
        if (!el) return;

        // Si salí completamente del elemento bloqueado, lo desbloqueo
        if (el === suppressEl && !(e.relatedTarget && el.contains(e.relatedTarget))) {
            suppressEl = null;
        }

        // tu lógica normal de hide
        if (!current) return;
        if (e.relatedTarget && current.contains(e.relatedTarget)) return;
        hide();
    });

    document.addEventListener("pointerdown", (e) => {
        const el = e.target.closest("[data-tooltip]");
        if (!el) return;

        if (el.hasAttribute("data-tooltip-noclick")) return; // 👈 NUEVO

        if (el === current) {
            hide();
            suppressEl = el;
        }
    }, true);

    // opcional: teclado (tab)
    document.addEventListener("focusin", (e) => {
        const el = e.target.closest("[data-tooltip]");
        if (el === suppressEl) return;
        if (el) show(el);
    });
    document.addEventListener("focusout", () => current && hide());

    // si se scrollea o cambia el tamaño, lo ocultamos (más simple y robusto)
    window.addEventListener("scroll", () => current && hide(), { passive: true });
    window.addEventListener("resize", () => current && hide(), { passive: true });
})();


// Disparar confetti
const fireConfetti = (() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fire = (r, o) => confetti({ ...o, origin: { y: 0.85 }, particleCount: Math.floor(200 * r) });

    return () => {
        if (reduce || typeof confetti !== "function") return;

        fire(0.25, { spread: 26, startVelocity: 55 });
        fire(0.20, { spread: 60 });
        fire(0.35, { spread: 100, decay: 0.91, scalar: 0.9 });
        fire(0.10, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
        fire(0.10, { spread: 120, startVelocity: 45 });

        confetti({ particleCount: 90, spread: 70, origin: { x: 0.15, y: 0.85 } });
        confetti({ particleCount: 90, spread: 70, origin: { x: 0.85, y: 0.85 } });

        const end = Date.now() + 900;
        (function frame() {
        confetti({
            particleCount: 3,
            startVelocity: 0,
            ticks: 140,
            origin: { x: Math.random(), y: 0.75 },
            gravity: 1.7,
            scalar: 0.85
        });
        if (Date.now() < end) requestAnimationFrame(frame);
        })();
    };
})();
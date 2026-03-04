# PassManager

PassManager es una aplicación de escritorio (Electron) para **guardar y administrar credenciales** (servicio, email y contraseña) con foco en **privacidad** y **seguridad por diseño**.

> **Idea clave:** los datos se cifran **antes de salir del dispositivo**. El backend solo almacena **blobs cifrados** y aplica estrictos controles de autenticación, autorización y aislamiento de red.

---

## ✨ Funcionalidades

- Guardar cuentas (servicio, email, contraseña, URL)
- Listado con búsqueda
- Copiar contraseña al portapapeles
- Editar / eliminar servicios
- Sesión con renovación automática (tokens JWT)

---

## 🕵️ Privacidad

- **Sin telemetría / analytics:** la app **no integra SDKs de tracking** (Sentry/PostHog/Segment/Mixpanel/Amplitude/etc.).
- **Sin anuncios.**
- **Datos cifrados end-to-end:** el servidor no puede leer tus credenciales sin tu contraseña maestra.

> Nota: esto no reemplaza una auditoría externa. Si encontrás un problema de seguridad, ver “Reporte de seguridad”.

---

## 🌐 Conectividad (qué servidores toca la app)

PassManager realiza conexiones de red únicamente para:

1. **API de PassManager** (login/sync): `https://api-137-131-235-195.sslip.io`
2. **Autocompletado opcional de servicios (Clearbit):** `https://autocomplete.clearbit.com`
3. **Auto-actualizaciones (solo instalador):** consulta releases/publicación en **GitHub** vía `electron-updater`

---

## 📦 Descargar e instalar (Usuarios)

En **Releases** vas a encontrar dos builds:

- ✅ **Instalador (recomendado):** `PassManager-Setup-x.y.z.exe`  
  - Se instala como cualquier app de Windows  
  - **Incluye auto-actualizaciones**
- ⚪ **Portable:** `PassManager-x.y.z.exe`  
  - No requiere instalación  
  - Puede no ser ideal para actualizaciones

> **No necesitás instalar Node.js** para usar PassManager. Solo es necesario para desarrollo.

### SmartScreen de Windows
Al no estar firmada con un certificado comercial, Windows puede mostrar una advertencia (“Editor desconocido”).  
Si descargaste el instalador desde **Releases** de este repositorio, podés continuar con **“Más información” → “Ejecutar de todas formas”**.

---

## 🔐 Seguridad (Arquitectura y Criptografía)

Este proyecto implementa defensa en profundidad (Defense in Depth) abarcando desde el cliente hasta la base de datos:

### 1. Seguridad en el Cliente (Desktop App)
- **Cifrado en cliente (Vault):** La app cifra/descifra localmente usando algoritmos robustos y sube al servidor únicamente un `blob` de datos ininteligible.
- **Derivación de Claves (KDF):** La clave de la bóveda se deriva localmente usando parámetros criptográficos fuertes (Argon2).
- **Zero-Knowledge Proof parcial:** La contraseña en texto plano jamás viaja por la red ni toca el servidor.
- **Aislamiento del renderer (Electron):** Configuración orientada a reducir la superficie de ataque, con políticas CSP (Content Security Policy) estrictas.
- **Empaquetado seguro:** ASAR habilitado y compresión máxima para distribución.

### 2. Seguridad en el Servidor (API en Oracle Cloud)
- **Cifrado de capa de aplicación:** Uso de `AES-256-GCM` para operaciones internas de la API que requieran manejo de secretos.
- **Gestión de Sesiones (JWT):** Autenticación mediante tokens de acceso de corta duración (Access Tokens) y cookies seguras, HttpOnly y SameSite para los Refresh Tokens.
- **Gestión de Secretos:** Las variables de entorno y certificados residen fuera del código fuente, con permisos restringidos de lectura en Linux.
- **Prevención de Inyecciones (SQLi):** Uso estricto de Prepared Statements nativos (`PDO::ATTR_EMULATE_PREPARES = false`) para neutralizar cualquier vector de inyección SQL.

### 3. Seguridad en la Base de Datos (Supabase / PostgreSQL)
- **Aislamiento a nivel de red (Network Restrictions):** La base de datos rechaza cualquier intento de conexión desde internet. El acceso está restringido de forma exclusiva a la IP estática del servidor en Oracle Cloud.
- **Tráfico Cifrado Forzado (SSL Verification):** La comunicación entre la API y Supabase requiere y verifica un certificado SSL raíz (`sslmode=verify-full`), mitigando ataques Man-in-the-Middle (MitM).
- **Principio de Mínimo Privilegio:** La API se conecta utilizando un rol restringido de PostgreSQL, sin privilegios administrativos ni acceso a esquemas no autorizados.
- **Row Level Security (RLS):** Todas las tablas cuentan con políticas de seguridad a nivel de fila estrictas, garantizando que el motor de la base de datos audite y bloquee accesos no autorizados por diseño.

### Limitaciones (amenazas fuera de alcance)
- Si tu equipo está comprometido (malware/keylogger), ninguna app de passwords puede garantizar protección total.
- Si olvidás la contraseña maestra, **no hay recuperación** del vault (por diseño).

---

## 🧱 Stack

- **Desktop:** Electron + HTML/CSS/JS
- **Backend:** API REST en PHP 
- **DB:** PostgreSQL (Supabase)
- **Infraestructura:** Oracle Cloud (Ubuntu Server) + Connection Pooling (IPv4)

---

## 🧑‍💻 Desarrollo

Requisitos: Node.js (solo para dev)

```bash
npm install
npm run start
```

Build local:

```bash
npm run pack     # build en carpeta (sin instalador)
npm run dist     # genera instalador y portable
```
Scripts y targets (NSIS + portable)

---

## 🛡️ Reporte de seguridad

Si encontrás una vulnerabilidad, por favor abrí un issue solo si no expone datos sensibles.
Para reportes privados, contactame por el medio que figure en mi perfil de GitHub.


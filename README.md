# PassManager

PassManager es una aplicación de escritorio (Electron) para **guardar y administrar credenciales** (servicio, email y contraseña) con foco en **privacidad** y **seguridad por diseño**.

> **Idea clave:** los datos se cifran **antes de salir del dispositivo**. El backend solo almacena **blobs cifrados** y aplica controles de autenticación/autorización.

---

## ✨ Funcionalidades

- Guardar cuentas (servicio, email, contraseña, URL)
- Listado con búsqueda
- Copiar contraseña al portapapeles
- Editar / eliminar servicios
- Sesión con renovación automática (tokens)

---

## 🔐 Seguridad (alto nivel)

Este repositorio implementa medidas para reducir riesgos comunes, sin exponer detalles innecesarios:

- **Cifrado en cliente (Vault):** la app cifra/descifra localmente y sube al servidor únicamente un `blob` cifrado.
- **Claves derivadas desde contraseña:** la llave de la bóveda se deriva localmente usando un KDF con parámetros fuertes.
- **Autenticación sin enviar la contraseña:** el login no transmite la contraseña del usuario al servidor.
- **Sesiones con tokens:** el backend emite tokens de acceso de corta duración y un mecanismo de renovación.
- **Aislamiento del renderer (Electron):** configuración orientada a reducir superficie de ataque (aislamiento de contexto, sin Node en renderer, sandbox).
- **Autorización por usuario en API:** las rutas que operan sobre cuentas validan identidad y propiedad del recurso.

> Nota: este README describe el enfoque general. Los detalles finos de implementación se mantienen en el código.

---

## 🧱 Stack

- **Frontend/Desktop:** Electron + HTML/CSS/JS
- **Backend:** PHP (API HTTP)
- **DB:** Postgres (Supabase)
- **Hosting backend:** Render

---

## 🚀 Desarrollo

### Requisitos
- Node.js + npm

### Instalar dependencias
```bash
npm install

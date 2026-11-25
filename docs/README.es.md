# Antigravity Suite

[简体中文](../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Español**

> **Suite de mejoras y control remoto 100 % sin parches para Google Antigravity en escritorio (macOS). Nunca altera el paquete oficial ni la firma de Apple, convive con las actualizaciones oficiales y se activa o desactiva al instante.**

<p align="center">
  <img src="../assets/mac-preview.png" alt="Vista previa de Antigravity Suite en macOS" width="100%">
</p>

## Funciones principales

1. **🇨🇳 Cambio instantáneo entre chino (simplificado / tradicional de Taiwán) e inglés (traducción local sin tokens)**
   - Alterna entre la interfaz en chino simplificado, chino tradicional de Taiwán (`繁體中文（台灣）`) e inglés original desde **`⚙️` → `🌐 Language & Appearance`** sin reiniciar (con traducción en caché local para bloques de pensamiento y títulos; puedes escribir tus propios prompts en español).
2. **🔔 Alertas de estado y no leídos en el Dock de macOS (Insignia + Cápsula)**
   - **Estado visible sin cambiar de ventana**: Agrupa y deduplica los avisos sin leer de todas tus ventanas sobre el icono del Dock mediante **contadores azul/rojo en la esquina** y una **cápsula translúcida (`Working` / `Unread` / `Approve` / `High Risk`)**, o cambia a **Badge Only** en **`⚙️` → `🌐 Language & Appearance`**.
   - **Seguimiento fluido y limpieza automática**: Sigue la ampliación al pasar el ratón por el Dock; al volver a la ventana borra los avisos azules normales y conserva las alertas rojas hasta atenderlas. En el primer uso pulsa **Grant Access** para dar permiso de Accesibilidad en macOS (requiere Xcode Command Line Tools) y **Test Alert** para previsualizar.

   <p align="center">
     <img src="../assets/dock-preview.jpg" alt="Vista previa de insignia y cápsula de estado en el Dock de macOS" width="84%">
   </p>

3. **📱 Control remoto ultrarrápido para móvil y escritorio (mucho más rápido que el oficial)**
   - **Conexión local directa y mejor ruta automática**: Escanea el código QR en **`📱 Remote`** y añádelo a tu pantalla de inicio como app PWA (los navegadores de PC adaptan el ancho). Elige automáticamente la vía más rápida entre **LAN** (mismo Wi-Fi), **Tailscale** con HTTPS automático, red local y un **túnel rápido de Cloudflare sin login por defecto (admite dominio propio)**, todo configurable en **`⚙️` → `📱 Remote`**.
   - **Espacio de trabajo completo**: Historial agrupado por proyecto, creación y vista previa de archivos/diffs dentro del límite `$HOME`, subida de imágenes y archivos, gestión de cola de mensajes (enviar ahora / editar / cancelar), tarjetas de aprobación, barra sincronizada de prompts (**`⚡Send / ✎Insert`**), **notificaciones Web Push e insignia PWA en segundo plano** y envío seguro con `Cmd/Ctrl + Enter` (protegido contra IME de Safari).

   <p align="center">
     <img src="../assets/mobile-preview.jpg" alt="Vista previa del control remoto PWA móvil" width="82%">
   </p>

4. **⚡ Prompts rápidos y optimización en el compositor (`⚙️` → `⚡ Chat & Efficiency`)**
   - **14 acciones recomendadas integradas** + **10 plantillas populares en un clic**; distingue entre **`Insert`** (coloca texto para añadir detalles o logs) y **`⚡Send`** (`↵`, envío directo) con protección de borrador e inversión con **`⌘/Ctrl + clic`**, además de **`✨ Optimize` / `↩ Undo`** y sugerencias con **`Tab / →`**.
5. **🧰 Utilidades rápidas de escritorio**
   - **`⌘1`–`⌘9`** (mantén `⌘` para ver números), **`⌘⇧[` / `⌘⇧]`** y **`⌃Tab`** para cambiar de chat al instante, barra flotante de navegación y edición directa **`Edit` + `⌘S`** en vistas previas.
   - **`>_ CLI`** para abrir `agy` en los terminales más habituales de macOS (con ajustes de proxy opcionales para CLI y actualizaciones en **`⚙️` → `🧰 Terminal & Network`**). Compatible con Antigravity **`2.32.x–2.34.0`** y los principales gestores de Node.
6. **📊 Monitor de contexto, autocompactación a 240K y cápsulas de cuota**
   - Anillo superior, mapa de calor de 52 semanas, comparativa de costes API y cuotas de 5 horas y semanal para **Gemini 4 / Claude** (`G4` / `C`), configurables en **`⚙️` → `📊 Plan & Subscription`**.
   - Detecta pérdidas de caché cerca de 328K y ejecuta `/compact` automáticamente al llegar a **240K** en reposo (activo por defecto en **`⚙️` → `⚡ Chat & Efficiency`**) para evitar bloqueos largos cerca de 512K.
7. **🛡️ Bloqueo con marco rojo ante comandos peligrosos**
   - Detiene comandos destructivos (`rm -rf`, `git reset --hard`, `git clean -f`, `git push`, `sudo`, `kill -9`, `DROP/DELETE`, `op item`) con un marco rojo para pedir confirmación manual aunque la aceptación automática esté activada.
8. **🔄 Detección automática y actualización en un clic**
   - Comprueba GitHub en segundo plano; si hay versión nueva, **`⚙️`** muestra un punto rojo para pulsar **Update Now** y actualizar al instante sin reiniciar (instalaciones con `git clone`).

---

## 🚀 Instalación sin parches (macOS)

Requisitos: **macOS**, **Google Antigravity** (`2.32.x–2.34.0`) y **Node.js `22.4.0+`**.

```bash
git clone https://github.com/iamvicliu/antigravity-suite.git ~/.local/share/antigravity-suite
cd ~/.local/share/antigravity-suite
./scripts/setup-macos-cdp.sh
```

> Opciones: `--no-auto` omite el inicio automático (puedes crear un lanzador en `~/Applications` con `ag-context-meter install-launcher`) y `--no-remote` desactiva el servidor remoto.
> **Windows / Linux**: Inicia Antigravity con `--remote-debugging-port=9222` y ejecuta `node cli.js live` desde el repositorio clonado.

Añade `~/.local/bin` a tu `PATH` y verifica la instalación:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
ag-context-meter status
```

> **Primer inicio (`v2.33.0+`)**: Las versiones recientes desactivan el puerto de depuración por defecto. Si no aparecen `📱 Remote` y `⚙️`, **pulsa `⌘Q` para cerrar por completo y vuelve a abrir Antigravity una vez** (o ejecuta `ag-context-meter restart`).

---

## 🛠️ Comandos diarios y desinstalación

| Comando | Uso |
| :--- | :--- |
| `ag-context-meter status` | Comprueba módulos activos, arranque automático y firma oficial intacta |
| `ag-context-meter remote` | Muestra código QR, URLs de acceso, estado del túnel y dispositivos |
| `ag-context-meter live` | Carga al instante en la ventana abierta (`--no-remote` desactiva el remoto) |
| `ag-context-meter restart` | Reinicia Antigravity (`v2.33.0+`) con la suite cargada |
| `ag-context-meter update` | Descarga la última versión y la aplica sin reiniciar |
| `ag-context-meter stop` | Desactiva temporalmente la suite durante la sesión actual |
| `ag-context-meter auto-off` / `auto-on` | Desactiva o vuelve a activar la carga automática al abrir la app |
| `ag-context-meter install-launcher` | Crea una app lanzadora opcional en `~/Applications` |

**Desinstalación completa**: ejecuta `ag-context-meter auto-off` y elimina:
- `~/Library/LaunchAgents/com.$(id -un).ag-live-helper.plist`
- `~/Applications/Antigravity 增强启动器.app`
- `~/.local/bin/ag-context-meter`
- `~/.local/share/antigravity-suite` (y `~/.local/share/antigravity-context-viewer` si existe)
- *Opcional*: borra cachés y ajustes locales con `rm -rf ~/Library/Application\ Support/AntigravityContextMeter ~/.config/antigravity-context-meter`

---

## 🔒 Principios de seguridad

- **Aplicación oficial intacta**: Los comandos antiguos de modificación están bloqueados; todo se ejecuta en memoria sin alterar binarios ni firmas de Apple.
- **Control de canales y código aleatorio de 48 caracteres**: Los canales apagados rechazan conexiones, cada solicitud verifica una clave aleatoria renovable en **`⚙️` → `📱 Remote`**, las pestañas se aíslan entre sí y los tokens de túnel propio permanecen solo en tu equipo.
- **Límites de ruta**: La edición directa y el explorador están estrictamente confinados dentro de `$HOME` y los espacios de trabajo registrados, bloqueando carpetas del sistema y credenciales (`.ssh`, `.gnupg`, `1Password`, `Antigravity.app`).

---

## 🧪 Pruebas y agradecimientos

```bash
npm run test:suite
```

Gracias a los colaboradores principales [@hubo1989](https://github.com/hubo1989) y [@Shens](https://github.com/Shens) por sus mejoras en emparejamiento QR, control remoto y rendimiento en escritorio. Para solución de problemas y créditos completos, consulta el **[README en chino simplificado](../README.md)** o el **[README en inglés](README.en.md)**. Licencia [MIT License](../LICENSE).

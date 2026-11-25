# Antigravity Suite

[简体中文](../README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md)

> **100% zero-patch enhancement & remote control suite for Google Antigravity desktop (macOS) — never alters the official app bundle or Apple code signatures, safe across official updates, and instant to toggle.**

<p align="center">
  <img src="../assets/mac-preview.png" alt="Antigravity Suite macOS desktop preview" width="100%">
</p>

## Core Highlights

1. **🇨🇳 Instant Chinese (Simplified / Traditional Taiwan) & English UI Toggle (Zero-Token Local Translation)**
   - Switch between Simplified Chinese, Traditional Chinese (Taiwan / `繁體中文（台灣）`), and original English right inside **`⚙️` → `🌐 Language & Appearance`**, without restarting (with zero-token cached translation for Thinking blocks & titles).
   - *Note*: Built-in UI supports Simplified Chinese, Traditional Chinese (Taiwan), and English, while custom quick prompts can be written in any language.
2. **🔔 macOS Dock Unread & Status Alerts (Badge + Frosted Capsule)**
   - **Check progress without switching windows**: Mirrors sidebar unread counts across windows (deduplicated) onto the Dock icon with **blue/red corner counters** and a **frosted status capsule (`Working` / `Unread` / `Approve` / `High Risk` or `3 new · 2 pending`)**, or switch to **Badge Only** under **`⚙️` → `🌐 Language & Appearance`**.
   - **Smooth follow & auto-clear**: Optically centered and follows Dock hover magnification seamlessly; returning to the window clears normal blue unread counts while keeping red approval badges until handled. Click **Grant Access** once for macOS Accessibility permission (requires Xcode Command Line Tools) and **Test Alert** to preview.

   <p align="center">
     <img src="../assets/dock-preview.jpg" alt="macOS Dock unread badge and frosted status capsule preview" width="84%">
   </p>

3. **📱 Ultra-Fast Mobile & Desktop Remote Control (Much Faster Than Official)**
   - **Direct local speed & flexible channels**: Scan the QR code under **`📱 Remote`** and add to iOS/Android Home Screen for a full-screen PWA app (desktop browsers get an adaptive wide layout). Automatically picks the fastest route across **LAN** (same Wi-Fi), **Tailscale** (auto HTTPS without browser warnings), local network auto-discovery, and a **default no-login Cloudflare Quick Tunnel (custom domains supported)** — toggle any channel in **`⚙️` → `📱 Remote`**.
   - **Full mobile/desktop workspace**: Browse project-grouped history, create projects within `$HOME`, inspect diffs/artifacts, upload images/files, manage queued messages (send now / edit / cancel), review approval cards, sync the quick-prompts bar (**`⚡Send / ✎Insert`**), receive background **Web Push alerts & PWA unread icon badges**, and send safely via `Cmd/Ctrl + Enter` (with Safari IME protection).

   <p align="center">
     <img src="../assets/mobile-preview.jpg" alt="Mobile PWA remote control preview" width="82%">
   </p>

4. **⚡ Composer Shortcuts & Prompt Optimization (`⚙️` → `⚡ Chat & Efficiency`)**
   - **14 built-in recommended prompts** + **10 one-click popular templates**, plus custom prompts supporting **`Insert`** (stage in composer to add logs) vs **`⚡Send`** (submit immediately with `↵`), protected by draft guard and **`⌘/Ctrl + click`** inversion.
   - One-click **`✨ Optimize` / `↩ Undo`** using fast lightweight models and context-aware **`Tab / →`** next-step suggestions.
5. **🧰 Quick Desktop Utilities**
   - **`⌘1`–`⌘9`** (hold `⌘` for badges), **`⌘⇧[` / `⌘⇧]`**, and **`⌃Tab`** to switch chats instantly; floating message navigator bar; inline **`Edit` + `⌘S`** editing inside preview panes.
   - **`>_ CLI`** one-click Antigravity CLI (`agy`) launcher supporting popular macOS terminals (plus optional proxy settings for CLI & update checks under **`⚙️` → `🧰 Terminal & Network`**). Compatible with Antigravity **`2.32.x–2.34.0`** and common Node version managers.
6. **📊 Context Window, 240K Auto-Compact & Dual Quota Capsules**
   - Top-bar ring meter, token breakdown, 52-week heatmap, API cost comparison, and **Gemini 4 / Claude** 5-hour + weekly quota capsules (`G4` / `C`). Configure plan tiers and billing currency in **`⚙️` → `📊 Plan & Subscription`**.
   - Real-time prompt cache warning catches 328K drops, while default-enabled **240K Auto-Compact** triggers `/compact` automatically when idle to avoid multi-minute stalls near 512K (toggle in **`⚙️` → `⚡ Chat & Efficiency`**).
7. **🛡️ Dangerous Command Red-Frame Interception**
   - Highlights destructive commands (`rm -rf`, `git reset --hard`, `git clean -f`, `git push`, `sudo`, `kill -9`, `DROP/DELETE`, `op item`) with red warning frames and requires manual approval even when Safe Auto-Accept is on.
8. **🔄 Auto Update Check & One-Click Hot Upgrade**
   - Checks GitHub automatically; when an update is ready, **`⚙️`** shows a red dot so you can click **Update Now** to apply immediately without restarting Antigravity (`git clone` installs only).

---

## 🚀 Zero-Patch Installation (macOS)

Requires **macOS**, **Google Antigravity** (`2.32.x–2.34.0`), and **Node.js `22.4.0+`**.

```bash
git clone https://github.com/iamvicliu/antigravity-suite.git ~/.local/share/antigravity-suite
cd ~/.local/share/antigravity-suite
./scripts/setup-macos-cdp.sh
```

> Optional flags: `--no-auto` skips installing the auto-launcher (`ag-context-meter install-launcher` creates an app launcher in `~/Applications`); `--no-remote` disables remote control.
> **Windows / Linux**: Launch Antigravity with `--remote-debugging-port=9222`, then run `node cli.js live` from the cloned repo (`node cli.js status` to check).

Add `~/.local/bin` to your shell `PATH` if needed and verify:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
ag-context-meter status
```

> **First-time note (`v2.33.0+`)**: Recent Antigravity versions disable the debugging port by default. If `📱 Remote` and `⚙️` do not appear right away, **press `⌘Q` to quit and reopen Antigravity once** (or run `ag-context-meter restart`).

---

## 🛠️ Daily Commands & Uninstall

| Command | Purpose |
| :--- | :--- |
| `ag-context-meter status` | Verify active modules, auto-launch status, and untouched official app signature |
| `ag-context-meter remote` | Print QR code, pairing URLs, tunnel status & connected devices |
| `ag-context-meter live` | Hot-load into the running Antigravity window (`--no-remote` to turn off remote) |
| `ag-context-meter restart` | Safely relaunch Antigravity (`v2.33.0+`) with enhancements attached |
| `ag-context-meter update` | Pull latest updates and apply immediately without restarting |
| `ag-context-meter stop` | Temporarily unload enhancements for the current session |
| `ag-context-meter auto-off` / `auto-on` | Disable or re-enable automatic loading when Antigravity opens |
| `ag-context-meter install-launcher` | Create an optional standalone launcher app in `~/Applications` |

**Complete uninstall**: run `ag-context-meter auto-off`, then remove:
- `~/Library/LaunchAgents/com.$(id -un).ag-live-helper.plist`
- `~/Applications/Antigravity 增强启动器.app`
- `~/.local/bin/ag-context-meter`
- `~/.local/share/antigravity-suite` (and legacy `~/.local/share/antigravity-context-viewer` if present)
- *Optional*: clear local caches & settings with `rm -rf ~/Library/Application\ Support/AntigravityContextMeter ~/.config/antigravity-context-meter`

---

## 🔒 Security Principles

- **Untouched official app**: Legacy bundle-patching commands are gated off; enhancements mount strictly in memory without altering official binaries or Apple signatures.
- **Channel controls & 48-char random passcode**: Disabled channels refuse connections, every remote request checks a 48-char passcode (rotatable anytime in **`⚙️` → `📱 Remote`**), browser tabs isolate state independently, and custom tunnel tokens stay strictly local.
- **Path boundaries**: Remote browsing and inline file editing are strictly confined to `$HOME` and registered workspaces, blocking system folders and credential stores (`.ssh`, `.gnupg`, `1Password`, `Antigravity.app`).

---

## 🧪 Testing & Credits

```bash
npm run test:suite
```

Thanks to core contributors **[@hubo1989](https://github.com/hubo1989)** (QR pairing, 4-channel remote gating, Cloudflare tunnel integration, settings unification & `v2.32+` compatibility) and **[@Shens](https://github.com/Shens)** (remote UX & performance, multi-project lossless history, queued messages, interactive approvals, macOS daemon & Node manager compatibility).

For detailed troubleshooting and upstream acknowledgements, see **[简体中文 README](../README.md)**. Released under the [MIT License](../LICENSE).

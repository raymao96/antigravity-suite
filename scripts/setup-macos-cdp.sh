#!/usr/bin/env bash
set -euo pipefail

# Antigravity 免改包增强套件 — macOS CLI 与随客户端自启守护一键配置脚本
# 零硬编码用户名，全部路径基于 $HOME 与当前仓库目录动态生成。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_SRC="$REPO_DIR/bin/ag-context-meter"
LOCAL_BIN_DIR="$HOME/.local/bin"
BIN_DEST="$LOCAL_BIN_DIR/ag-context-meter"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
CURRENT_USER="$(id -un | tr -cd 'a-zA-Z0-9._-')"
LABEL="${AG_LIVE_LABEL:-com.${CURRENT_USER}.ag-live-helper}"
PLIST_PATH="$LAUNCH_AGENTS_DIR/${LABEL}.plist"
LOG_PATH="$HOME/Library/Logs/antigravity-hans.log"
PORT_FILE="$HOME/Library/Application Support/Antigravity/DevToolsActivePort"
SOCKET_FILE="$HOME/Library/Application Support/Antigravity/SingletonSocket"

ENABLE_AUTO=1
DISABLE_REMOTE=0
for arg in "$@"; do
  case "$arg" in
    --no-auto)
      ENABLE_AUTO=0
      ;;
    --no-remote)
      DISABLE_REMOTE=1
      ;;
    -h|--help)
      cat <<'EOF'
用法: ./scripts/setup-macos-cdp.sh [選項]

選項:
  --no-auto    僅建立 ~/.local/bin/ag-context-meter 符號連結，略過 LaunchAgent 自動啟動設定
  --no-remote  僅啟用桌面版介面增強，停用 18765 手機遠端監聽連接埠
  -h, --help   顯示說明資訊
EOF
      exit 0
      ;;
    *)
      echo "未知選項: $arg" >&2
      exit 1
      ;;
  esac
done

# 1. 检查 Node.js 运行时版本（需 >= 22.4，内置 WebSocket / fetch）
DEFAULT_NODE_PATHS="${AG_DEFAULT_NODE_PATHS-/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin}"
if [ -n "$DEFAULT_NODE_PATHS" ]; then
  export PATH="${DEFAULT_NODE_PATHS}:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  for cand in \
    "$HOME/.volta/bin" \
    "$HOME/.asdf/shims" \
    "$HOME/.local/share/mise/shims" \
    "$HOME/.fnm/current/bin" \
    "$HOME/Library/Application Support/fnm/aliases/default/bin"
  do
    if [ -x "$cand/node" ]; then
      export PATH="$cand:$PATH"
      break
    fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  NVM_NODES_DIR="${NVM_DIR:-$HOME/.nvm}/versions/node"
  if [ -d "$NVM_NODES_DIR" ]; then
    while IFS= read -r nvm_ver; do
      [ -n "$nvm_ver" ] || continue
      if [ -x "$NVM_NODES_DIR/$nvm_ver/bin/node" ]; then
        export PATH="$NVM_NODES_DIR/$nvm_ver/bin:$PATH"
        break
      fi
    done < <(ls -1 "$NVM_NODES_DIR" 2>/dev/null | sort -V -r)
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未偵測到 node，請先安裝 Node.js 22.4+（例如：brew install node@22）" >&2
  exit 1
fi
node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 4)) {
  console.error(`❌ 目前 Node.js 版本 (${process.versions.node}) 過低，需要 >= 22.4.0`);
  process.exit(1);
}
'
NODE_BIN_DIR="$(node -e 'const fs = require("fs"), path = require("path"); console.log(path.dirname(fs.realpathSync(process.execPath)));' 2>/dev/null || dirname "$(command -v node)")"

# 2. 配置 ~/.local/bin/ag-context-meter 软链
chmod +x "$BIN_SRC"
mkdir -p "$LOCAL_BIN_DIR"
ln -sf "$BIN_SRC" "$BIN_DEST"
echo "✅ 已建立 CLI 指令連結: $BIN_DEST -> $BIN_SRC"

# 若目标不在标准目录 ~/.local/share/antigravity-suite，自动创建软链以便直接定位
STANDARD_SHARE_DIR="$HOME/.local/share/antigravity-suite"
if [ ! -e "$STANDARD_SHARE_DIR" ]; then
  mkdir -p "$(dirname "$STANDARD_SHARE_DIR")"
  ln -s "$REPO_DIR" "$STANDARD_SHARE_DIR"
  echo "✅ 已建立執行目錄符號連結: $STANDARD_SHARE_DIR -> $REPO_DIR"
fi

# 3. 仅在开启自启时写入 LaunchAgent（传 --no-auto 时零写入系统后台自启目录）
if [ "$ENABLE_AUTO" -eq 1 ]; then
  LAUNCHD_PATH="$(NODE_BIN_DIR="$NODE_BIN_DIR" node -e '
const escXml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const items = [process.env.NODE_BIN_DIR, "/opt/homebrew/opt/node@22/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
console.log(escXml(Array.from(new Set(items.filter(Boolean))).join(":")));
')"
  REMOTE_ENV_ENTRY=""
  AUTO_ARGS=()
  if [ "$DISABLE_REMOTE" -eq 1 ]; then
    REMOTE_ENV_ENTRY="    <key>AG_DISABLE_MOBILE_REMOTE</key>
    <string>1</string>
"
    AUTO_ARGS+=(--no-remote)
  fi
  ENV_BLOCK="  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${LAUNCHD_PATH}</string>
${REMOTE_ENV_ENTRY}  </dict>
"
  mkdir -p "$LAUNCH_AGENTS_DIR" "$HOME/Library/Logs"
  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN_DEST}</string>
    <string>_auto-trigger</string>
  </array>
${ENV_BLOCK}  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>5</integer>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>WatchPaths</key>
  <array>
    <string>${PORT_FILE}</string>
    <string>${SOCKET_FILE}</string>
  </array>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
</dict>
</plist>
EOF
  echo "✅ 已寫入 LaunchAgent 設定檔: $PLIST_PATH"
  "$BIN_DEST" auto-on ${AUTO_ARGS[@]:+"${AUTO_ARGS[@]}"}
else
  echo "⚪ 已略過 LaunchAgent 自動啟動設定 (--no-auto)，可隨時手動執行：ag-context-meter live${DISABLE_REMOTE:+ --no-remote}"
fi

echo ""
echo "📋 安裝狀態："
if [ -r "$PORT_FILE" ]; then
  echo "  - 已偵測到 Antigravity DevToolsActivePort（CDP 就緒）"
elif command -v lsof >/dev/null 2>&1 && lsof -nP -a -c Antigravity -iTCP -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  - 已從監聽中的連接埠偵測到 Antigravity"
else
  echo "  - 目前未偵測到執行中的 Antigravity CDP 連接埠：請確認 Antigravity 已開啟遠端偵錯連接埠，或重新啟動 Antigravity。"
fi

echo "  - 安全說明：本指令碼 100% 零修改 Antigravity.app / app.asar；若無需背景自動啟動可加 --no-auto，若僅需桌面增強（關閉 18765 手機遠端連接埠）可加 --no-remote 或設定 AG_DISABLE_MOBILE_REMOTE=1"

case ":$PATH:" in
  *":$LOCAL_BIN_DIR:"*)
    echo "  - 可以直接在終端機執行：ag-context-meter status / live / stop / auto-on / auto-off"
    ;;
  *)
    echo "  - 提示：請將 $LOCAL_BIN_DIR 加入 ~/.zshrc PATH："
    echo "      echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
    echo "  - 也可直接使用：$BIN_DEST status"
    ;;
esac

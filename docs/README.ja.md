# Antigravity Suite

[简体中文](../README.md) · [English](README.en.md) · **日本語** · [한국어](README.ko.md) · [Español](README.es.md)

> **Google Antigravity デスクトップ版（macOS）向けのゼロ改変拡張＆リモート操作スイート。公式アプリ本体や Apple 署名を一切変更せず、アップデートに影響せず、いつでも即時に切り替えられます。**

<p align="center">
  <img src="../assets/mac-preview.png" alt="Antigravity Suite macOS デスクトップ画面プレビュー" width="100%">
</p>

## 主な機能

1. **🇨🇳 簡体字・繁体字（台湾）・英語 UI の即時切替（ゼロトークン思考翻訳）**
   - **`⚙️` → `🌐 Language & Appearance`** から再起動なしで簡体字中国語・繁体字中国語（台湾用語）・英語原版を即時に切り替えられます（思考ブロックとタイトルのローカル翻訳・トークン消費ゼロ、カスタム定型文は日本語でも作成可）。
2. **🔔 macOS Dock 未読＆ステータス通知（未読バッジ + フロストカプセル）**
   - **別作業中もアイコンを見るだけで把握**：複数ウィンドウの未読数を重複除去し、Dock アイコンへ**右上の青・赤数字バッジ**と**下部カプセル（生成中 / 新返信 / 承認待ち / 高リスク）**を表示。**`⚙️` → `🌐 Language & Appearance`** で「バッジのみ」にも切替できます。
   - **ホバー拡大追従＆賢い消去**：Dock の拡大アニメーションに滑らかに追従し、ウィンドウへ戻ると通常の青未読は自動消去、赤い承認待ちは対応完了まで残ります。初回のみ **Grant Access** から macOS「アクセシビリティ」権限を許可（Xcode Command Line Tools が必要）し、**Test Alert** ですぐ確認できます。

   <p align="center">
     <img src="../assets/dock-preview.jpg" alt="macOS Dock 未読バッジ＆フロスト状態カプセル表示プレビュー" width="84%">
   </p>

3. **📱 超高速モバイル／PC リモート操作（公式より圧倒的に高速）**
   - **ローカル直結＆自動最適ルート**：**`📱 Remote`** の QR コードを読み取りホーム画面に追加すればフルスクリーン PWA として即起動（PC ブラウザは横長画面に自動対応）。同一 Wi-Fi の **LAN** 直結、**Tailscale** 自動 HTTPS、ローカル探索、**ログイン不要の Cloudflare 一時トンネル（独自ドメイン対応）** から最速ルートを自動選択します（**`⚙️` → `📱 Remote`** で個別オン／オフ可）。
   - **充実のワークスペース**：プロジェクト別履歴、`$HOME` 安全範囲でのプロジェクト作成・差分プレビュー、画像／ファイル添付、待機中メッセージ管理（即時送信・編集・取消）、承認カード確認、定型プロンプトバー（**`⚡Send / ✎Insert`**）、バックグラウンド **Web Push 通知＆アイコン未読バッジ**、誤送信を防ぐ `Cmd/Ctrl + Enter` 送信に対応しています。

   <p align="center">
     <img src="../assets/mobile-preview.jpg" alt="モバイル PWA リモート操作プレビュー" width="82%">
   </p>

4. **⚡ 入力欄ショートカット＆プロンプト最適化（`⚙️` → `⚡ Chat & Efficiency`）**
   - **14種のおすすめコマンド**＋**10種の人気テンプレート**を搭載。ログ追記向けの **`Insert`** とワンクリック即送信の **`⚡Send`**（`↵`）を使い分けられ、下書き保護や **`⌘/Ctrl + クリック`** 反転に対応。**`✨ Optimize` / `↩ Undo`** 整形や **`Tab / →`** 次の一手提案も利用できます。
5. **🧰 デスクトップ便利ツール**
   - **`⌘1`〜`⌘9`**（`⌘` 長押しで番号表示）・**`⌘⇧[` / `⌘⇧]`**・**`⌃Tab`** で会話即切替、右側フローティングナビ、プレビュー画面での **`Edit` + `⌘S`** 直接編集に対応。
   - **`>_ CLI`** で主要 macOS ターミナルから `agy` をワンクリック起動（CLI や更新確認用のローカルプロキシ設定も **`⚙️` → `🧰 Terminal & Network`** で管理可能）。Antigravity **`2.32.x–2.34.0`** および各種 Node バージョン管理ツールに対応。
6. **📊 コンテキスト監視・240K 自動圧縮・デュアル枠カプセル**
   - 右上のリングメーターで残量・52週ヒートマップ・API 換算コストを可視化し、**Gemini 4 / Claude** の 5時間＆週間枠（`G4` / `C`）を追跡（契約内容や通貨は **`⚙️` → `📊 Plan & Subscription`** で設定）。
   - 328K 付近のキャッシュ失効を検知し、512K まで待って数分フリーズする前に **240K 自動圧縮**（既定オン）がアイドル時自動で `/compact` を送信します（**`⚙️` → `⚡ Chat & Efficiency`** で切替可能）。
7. **🛡️ 危険コマンドの赤枠ブロック**
   - `rm -rf`、`git reset --hard`、`git clean -f`、`git push`、`sudo`、`kill -9`、`DROP/DELETE`、`op item` 実行時は安全自動承認がオンでも赤枠で停止し手動確認を求めます。
8. **🔄 更新の自動検知＆ワンクリック即時適用**
   - GitHub の更新を自動確認し、新版があると **`⚙️`** に赤点を表示。**Update Now** を押すだけで再起動なしに適用できます（`git clone` 導入環境向け）。

---

## 🚀 導入手順（macOS）

動作要件：**macOS**、**Google Antigravity**（`2.32.x–2.34.0`）、**Node.js `22.4.0+`**

```bash
git clone https://github.com/iamvicliu/antigravity-suite.git ~/.local/share/antigravity-suite
cd ~/.local/share/antigravity-suite
./scripts/setup-macos-cdp.sh
```

> オプション：`--no-auto`（自動起動を無効化、`ag-context-meter install-launcher` で `~/Applications` に起動アプリ作成可）、`--no-remote`（リモート機能を無効化）。
> **Windows / Linux**：Antigravity を `--remote-debugging-port=9222` 付きで起動し、クローン先で `node cli.js live` を実行してください。

`~/.local/bin` を `PATH` に追加して確認します：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
ag-context-meter status
```

> **初回注意（`v2.33.0+`）**：新しい Antigravity は既定でデバッグポートが無効です。`📱 Remote` や `⚙️` が表示されない場合は、**`⌘Q` で完全終了してから一度再起動**（または `ag-context-meter restart`）してください。

---

## 🛠️ 日常コマンドとアンインストール

| コマンド | 役割 |
| :--- | :--- |
| `ag-context-meter status` | 機能の有効状態・自動起動・公式署名の無改変状態を確認 |
| `ag-context-meter remote` | QR コード・接続 URL・トンネル状態・接続中端末を表示 |
| `ag-context-meter live` | 起動中の Antigravity へ即時適用（`--no-remote` でリモート停止） |
| `ag-context-meter restart` | `v2.33.0+` 向けに Antigravity を安全に再起動して適用 |
| `ag-context-meter update` | 最新版を取得し、再起動なしで現在のウィンドウへ即時反映 |
| `ag-context-meter stop` | 今回のセッションのみ機能を一時解除 |
| `ag-context-meter auto-off` / `auto-on` | 起動時の自動読み込みを無効化または再有効化 |
| `ag-context-meter install-launcher` | `~/Applications` に任意の起動アプリを作成 |

**完全アンインストール**：`ag-context-meter auto-off` を実行後、以下を削除してください：
- `~/Library/LaunchAgents/com.$(id -un).ag-live-helper.plist`
- `~/Applications/Antigravity 增强启动器.app`
- `~/.local/bin/ag-context-meter`
- `~/.local/share/antigravity-suite`（旧 `antigravity-context-viewer` ディレクトリがある場合も削除）
- *任意*：キャッシュと個人設定の消去は `rm -rf ~/Library/Application\ Support/AntigravityContextMeter ~/.config/antigravity-context-meter`

---

## 🔒 セキュリティ原則

- **公式アプリの無改変**：パッケージ改変コマンドは無効化されており、アプリ本体や Apple 署名を変更せずメモリ上のみで動作します。
- **チャンネル制限と48文字ランダムパスコード**：未許可チャンネルの接続は自動拒否され、すべての通信で再発行可能な48文字ランダムパスコードを検証。独自トンネルトークンもローカルのみに保存されます。
- **パス安全境界**：ファイル編集と閲覧は `$HOME` および登録済みワークスペース内に厳格制限され、システム領域や認証情報ディレクトリ（`.ssh`、`.gnupg`、`1Password`、`Antigravity.app`）へのアクセスを遮断します。

---

## 🧪 テストとクレジット

```bash
npm run test:suite
```

QR ペアリング、リモート操作、パフォーマンス改善に貢献いただいた [@hubo1989](https://github.com/hubo1989) 氏・[@Shens](https://github.com/Shens) 氏に深く感謝します。詳しい案内と上流プロジェクト一覧は **[简体中文 README](../README.md)** および **[English README](README.en.md)** をご覧ください。[MIT License](../LICENSE) 下で公開されています。

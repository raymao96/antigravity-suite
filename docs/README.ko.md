# Antigravity Suite

[简体中文](../README.md) · [English](README.en.md) · [日本語](README.ja.md) · **한국어** · [Español](README.es.md)

> **Google Antigravity 데스크톱(macOS)을 위한 100% 무변조 확장 및 원격 제어 스위트입니다. 공식 앱이나 Apple 서명을 전혀 수정하지 않으며, 공식 업데이트와 충돌 없이 언제든 켜고 끌 수 있습니다.**

<p align="center">
  <img src="../assets/mac-preview.png" alt="Antigravity Suite macOS 데스크톱 미리보기" width="100%">
</p>

## 핵심 기능

1. **🇨🇳 중국어(간체·대만 번체)/영어 즉시 전환 (제로 토큰 사고 번역)**
   - **`⚙️` → `🌐 Language & Appearance`** 에서 재시작 없이 중국어 간체, 대만식 번체(繁體中文（台灣）), 영어 원판을 즉시 전환할 수 있습니다(사고 과정 및 제목 로컬 번역 포함, 토큰 소모 없음, 사용자 정의 단축 프롬프트는 한국어로 자유롭게 작성 가능).
2. **🔔 macOS Dock 읽지 않음 및 상태 알림 (배지 + 반투명 캡슐)**
   - **다른 창에서 작업해도 한눈에 확인**: 여러 창의 읽지 않음 카운트를 중복 없이 모아 Dock 아이콘에 **우측 상단 파란·빨간 숫자 배지**와 **하단 상태 캡슐(생성 중 / 새 답장 / 승인 대기 / 고위험)**을 표시합니다. **`⚙️` → `🌐 Language & Appearance`** 에서「숫자 배지만 보기」로 전환할 수 있습니다.
   - **호버 확대 추적 & 자동 정리**: Dock 아이콘 확대 애니메이션에 매끄럽게 따라가며, 창으로 돌아오면 일반 파란 읽지 않음은 자동 해제되고 빨간 승인 대기는 처리 완료 전까지 유지됩니다. 최초 사용 시 **Grant Access** 로 macOS 손쉬운 사용 권한을 허용(Xcode Command Line Tools 필요)하고 **Test Alert** 로 바로 확인하세요.

   <p align="center">
     <img src="../assets/dock-preview.jpg" alt="macOS Dock 읽지 않음 배지 및 반투명 상태 캡슐 미리보기" width="84%">
   </p>

3. **📱 초고속 모바일·PC 원격 제어 (공식 대비 압도적 속도)**
   - **로컬 직결 & 자동 최적 경로**: **`📱 Remote`** QR 코드를 스캔해 홈 화면에 추가하면 전체 화면 PWA 앱처럼 바로 실행됩니다(PC 브라우저는 와이드 화면 자동 지원). 동일 Wi-Fi **LAN** 직결, **Tailscale** 자동 HTTPS, 로컬 탐색, **기본 로그인 없는 Cloudflare 임시 터널(고정 도메인 지원)** 중 가장 빠른 경로를 선택하며 **`⚙️` → `📱 Remote`** 에서 채널별로 제어할 수 있습니다.
   - **완전한 원격 워크스페이스**: 프로젝트별 기록 탐색, `$HOME` 안전 범위 내 프로젝트 생성 및 diff 미리보기, 파일·이미지 업로드, 대기열 메시지 관리(즉시 전송/편집/취소), 대화형 승인 카드, 단축 명령 바(**`⚡Send / ✎Insert`**), 백그라운드 **Web Push 알림 & 아이콘 읽지 않음 배지**, 오입력 방지 `Cmd/Ctrl + Enter` 전송을 지원합니다.

   <p align="center">
     <img src="../assets/mobile-preview.jpg" alt="모바일 PWA 원격 제어 미리보기" width="82%">
   </p>

4. **⚡ 입력창 단축 명령 & 프롬프트 최적화 (`⚙️` → `⚡ Chat & Efficiency`)**
   - **14종 추천 단축 명령** + **인기 템플릿 10종**을 제공하며, 로그를 이어 붙이는 **`Insert`** 와 클릭 즉시 전송하는 **`⚡Send`**(`↵`)를 초안 보호 및 **`⌘/Ctrl + 클릭`** 반전과 함께 지원합니다. **`✨ Optimize` / `↩ Undo`** 다듬기와 **`Tab / →`** 다음 단계 추천도 지원합니다.
5. **🧰 데스크톱 편의 도구**
   - **`⌘1`~`⌘9`**(`⌘` 길게 눌러 번호 표시), **`⌘⇧[` / `⌘⇧]`**, **`⌃Tab`** 대화 즉시 전환, 플로팅 내비게이션, 미리보기 창 **`Edit` + `⌘S`** 직접 편집 지원.
   - **`>_ CLI`** 버튼으로 주요 macOS 터미널에서 `agy` 를 원클릭 실행(CLI 및 업데이트 확인용 로컬 프록시 설정도 **`⚙️` → `🧰 Terminal & Network`** 에서 관리). Antigravity **`2.32.x–2.34.0`** 및 주요 Node 버전 매니저와 호환됩니다.
6. **📊 컨텍스트 모니터, 240K 자동 압축 & 듀얼 할당량 캡슐**
   - 상단 링 미터로 컨텍스트 점유율, 52주 히트맵, API 참고 비용을 확인하고 **Gemini 4 / Claude** 5시간 및 주간 한도(`G4` / `C`)를 추적합니다(요금제·통화는 **`⚙️` → `📊 Plan & Subscription`** 에서 설정).
   - 328K 캐시 이탈 위험을 감지하며, 512K까지 기다려 수 분씩 멈추지 않도록 기본 활성화된 **240K 자동 압축**이 유휴 시 `/compact` 를 자동 실행합니다(**`⚙️` → `⚡ Chat & Efficiency`** 에서 전환).
7. **🛡️ 위험 명령 빨간 테두리 차단**
   - `rm -rf`, `git reset --hard`, `git clean -f`, `git push`, `sudo`, `kill -9`, `DROP/DELETE`, `op item` 등 고위험 명령 전에는 자동 승인이 켜져 있어도 빨간 테두리로 멈추고 수동 확인을 받습니다.
8. **🔄 업데이트 자동 감지 & 원클릭 즉시 적용**
   - GitHub 새 버전을 자동 확인해 **`⚙️`** 에 빨간 점을 띄우며, **Update Now** 를 누르면 재시작 없이 즉시 반영됩니다(`git clone` 설치 기준).

---

## 🚀 무변조 설치 방법 (macOS)

필요 환경: **macOS**, **Google Antigravity**(`2.32.x–2.34.0`), **Node.js `22.4.0+`**

```bash
git clone https://github.com/iamvicliu/antigravity-suite.git ~/.local/share/antigravity-suite
cd ~/.local/share/antigravity-suite
./scripts/setup-macos-cdp.sh
```

> 선택 옵션: `--no-auto`(자동 실행 제외, `ag-context-meter install-launcher` 로 `~/Applications` 에 실행 앱 생성 가능), `--no-remote`(원격 서버 끄기).
> **Windows / Linux**: `--remote-debugging-port=9222` 옵션으로 Antigravity 실행 후 클론 폴더에서 `node cli.js live` 를 실행하세요.

`~/.local/bin` 을 `PATH` 에 추가하고 상태를 확인합니다:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
ag-context-meter status
```

> **첫 설치 안내 (`v2.33.0+`)**: 최신 Antigravity 는 기본적으로 디버깅 포트가 꺼져 있습니다. `📱 Remote` 와 `⚙️` 가 보이지 않으면 **`⌘Q` 로 완전히 종료 후 한 번 다시 실행**(또는 `ag-context-meter restart`)하세요.

---

## 🛠️ 일상 명령어 및 완전 제거

| 명령어 | 설명 |
| :--- | :--- |
| `ag-context-meter status` | 활성 기능, 자동 실행 상태 및 공식 앱 무결성 확인 |
| `ag-context-meter remote` | QR 코드, 페어링 주소, 터널 상태 및 연결 기기 출력 |
| `ag-context-meter live` | 실행 중인 Antigravity 창에 즉시 적용 (`--no-remote` 로 원격 끄기) |
| `ag-context-meter restart` | `v2.33.0+` 환경에서 Antigravity 안전 재시작 및 적용 |
| `ag-context-meter update` | 최신 버전을 받아 재시작 없이 현재 창에 즉시 반영 |
| `ag-context-meter stop` | 이번 세션 동안만 확장 기능을 일시 해제 |
| `ag-context-meter auto-off` / `auto-on` | 실행 시 자동 적용 비활성화 또는 재활성화 |
| `ag-context-meter install-launcher` | `~/Applications` 에 선택형 독립 실행기 앱 생성 |

**완전 제거 방법**: `ag-context-meter auto-off` 실행 후 아래 항목 삭제:
- `~/Library/LaunchAgents/com.$(id -un).ag-live-helper.plist`
- `~/Applications/Antigravity 增强启动器.app`
- `~/.local/bin/ag-context-meter`
- `~/.local/share/antigravity-suite` (기존 `antigravity-context-viewer` 폴더가 있다면 함께 삭제)
- *선택*: 캐시와 설정까지 삭제하려면 `rm -rf ~/Library/Application\ Support/AntigravityContextMeter ~/.config/antigravity-context-meter`

---

## 🔒 보안 원칙

- **공식 앱 무변조**: 패키지 변조 명령은 비활성화되어 있으며 앱 바이너리나 Apple 서명 변경 없이 메모리 상에서만 실행됩니다.
- **채널 제어 및 48자리 랜덤 암호**: 비활성화된 채널 접근은 차단되며 모든 요청에 재설정 가능한 48자리 랜덤 암호를 검증하고, 고정 터널 토큰은 로컬에만 저장됩니다.
- **경로 접근 제한**: 파일 편집과 탐색은 `$HOME` 및 등록된 워크스페이스 내부로 엄격히 제한되어 시스템 폴더나 인증 저장소(`.ssh`, `.gnupg`, `1Password`, `Antigravity.app`)에 접근하지 못합니다.

---

## 🧪 테스트 및 기여자

```bash
npm run test:suite
```

QR 페어링, 원격 제어 및 성능 개선에 기여한 [@hubo1989](https://github.com/hubo1989), [@Shens](https://github.com/Shens) 님께 감사드립니다. 자세한 안내와 업스트림 목록은 **[简体中文 README](../README.md)** 와 **[English README](README.en.md)** 를 참고하세요. [MIT License](../LICENSE) 를 따릅니다.

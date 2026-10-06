<div align="center">
  <img src="docs/assets/logo.svg" width="80" height="80" alt="Streamer Assist logo">
  <h1>Streamer Assist</h1>
  <p>Your broadcast moments and audience tools, in one Windows app.</p>
  <p>
    <a href="https://github.com/yechankun/streamer-assist/actions/workflows/ci.yml"><img src="https://github.com/yechankun/streamer-assist/actions/workflows/ci.yml/badge.svg?branch=main" alt="Windows CI"></a>
    <img src="https://img.shields.io/badge/platform-Windows_x64-0078D4?style=flat" alt="Windows x64">
    <img src="https://img.shields.io/badge/built_with-React_%2B_Electron-61DAFB?style=flat" alt="Built with React and Electron">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-00c78c?style=flat" alt="MIT license"></a>
  </p>
  <p><strong>English</strong> · <a href="README.ko.md">한국어</a></p>
  <p>
    <a href="#features">Features</a> ·
    <a href="#screenshots">Screenshots</a> ·
    <a href="#get-started">Get started</a> ·
    <a href="#documentation">Documentation</a> ·
    <a href="CONTRIBUTING.md">Contribute</a>
  </p>
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/screenshots/home-light.png">
    <img src="docs/assets/screenshots/home-dark.png" width="1080" alt="Streamer Assist workspace with a broadcast timeline summary and four audience tools">
  </picture>
  <p><sub>Actual development-build captures with an isolated profile and synthetic data. The app interface is currently Korean.</sub></p>
</div>

## Why Streamer Assist?

A Windows companion for **CHZZK, YouTube and Twitch**: keep broadcast moments, review chat and donations, and run audience tools from one frameless workspace. Connections and encrypted archives stay on your PC; a hosted application backend is not required.

## Features

| Area | What you can do |
| --- | --- |
| **Automatic timeline** | Start when any connected channel goes live, end when every channel is confirmed offline, and add markers with a captured global shortcut. |
| **Chat and donations** | Browse all dates by default, combine platforms or filter one, search participants/text and review original message times. |
| **Storage management** | Select days, weeks or months, inspect encrypted-file sizes and delete chosen dates while protecting active recordings. |
| **Local analysis** | View actual viewer samples, minute activity, reactions, keywords and participant statistics; export timestamped JSONL for later AI use. |
| **Viewer raffle** | Recruit through chat/keywords, filter subscribers/members, exclude previous winners and reveal a secure random draw. |
| **Number / donation votes** | Combine chat votes or YouTube native polls; count supported donation messages using explicit amount/currency rules. |
| **Weighted roulette** | Enter 2–12 weighted choices or import ended vote results. Slice sizes reflect draw probabilities. |
| **Workspace settings** | Capture shortcuts, manage platform connections, tray/startup behavior, themes and local data. |

**AI connections** support Codex, Claude, Grok, Antigravity, DeepSeek and Kimi through CLI/API adapters. Download independently versioned adapters from [AI Connectors](https://github.com/yechankun/streamer-assist-ai-connectors), then install, update or remove them in Settings. Provider implementations and CLI binaries stay outside the installer. Select queried models and reasoning effort in Settings, and view usage, available CLI limits and estimated API costs after scoped chat analysis. See [AI connections](docs/ai-integrations.md). Video/audio recording is not provided.

## Screenshots

Click an image for full resolution. All identities, chats, donations, viewer counts and results below are synthetic; no personal accounts or real payments are used.

<table>
  <tr>
    <td width="50%"><a href="docs/assets/screenshots/timeline.png"><img src="docs/assets/screenshots/timeline.png" alt="Follow the whole broadcast"></a><br><strong>Follow the whole broadcast</strong><br>Live viewer samples, the stream clock and highlight markers.</td>
    <td width="50%"><a href="docs/assets/screenshots/chat-storage.png"><img src="docs/assets/screenshots/chat-storage.png" alt="Keep control of disk usage"></a><br><strong>Keep control of disk usage</strong><br>Day/week/month selection, real file sizes and protected active dates.</td>
  </tr>
  <tr>
    <td width="50%"><a href="docs/assets/screenshots/chat-history.png"><img src="docs/assets/screenshots/chat-history.png" alt="Read across dates and platforms"></a><br><strong>Read across dates and platforms</strong><br>Original timestamps, sender search and platform filters.</td>
    <td width="50%"><a href="docs/assets/screenshots/chat-analysis.png"><img src="docs/assets/screenshots/chat-analysis.png" alt="Prepare data for later analysis"></a><br><strong>Prepare data for later analysis</strong><br>Local reactions, keywords, participants and JSONL exports.</td>
  </tr>
  <tr>
    <td width="50%"><a href="docs/assets/screenshots/viewer-raffle.png"><img src="docs/assets/screenshots/viewer-raffle.png" alt="Invite a viewer into the spotlight"></a><br><strong>Invite a viewer into the spotlight</strong><br>Recruitment rules, subscriber filters and winner history.</td>
    <td width="50%"><a href="docs/assets/screenshots/live-poll.png"><img src="docs/assets/screenshots/live-poll.png" alt="Let viewers choose what comes next"></a><br><strong>Let viewers choose what comes next</strong><br>Animated totals, percentages and a broadcast result view.</td>
  </tr>
  <tr>
    <td width="50%"><a href="docs/assets/screenshots/donation-vote.png"><img src="docs/assets/screenshots/donation-vote.png" alt="Turn supported donations into votes"></a><br><strong>Turn supported donations into votes</strong><br>Minimum-amount or votes-by-amount rules.</td>
    <td width="50%"><a href="docs/assets/screenshots/roulette.png"><img src="docs/assets/screenshots/roulette.png" alt="Make an outcome a weighted draw"></a><br><strong>Make an outcome a weighted draw</strong><br>Weighted slices match the selection probabilities.</td>
  </tr>
</table>


<details>
<summary>Connections, settings and data controls</summary>

![CHZZK, YouTube and Twitch connection settings](docs/assets/screenshots/platforms.png)

![Shortcut, tray and automatic recording settings](docs/assets/screenshots/settings.png)

![Download and manage independently versioned AI connectors](docs/assets/screenshots/ai-connectors.png)

![Bundled privacy policy and local data controls](docs/assets/screenshots/privacy.png)

</details>

## Get started

**Development preview:** this page describes the current development build. The latest published [v0.1.0 release](https://github.com/yechankun/streamer-assist/releases/tag/v0.1.0) is an earlier MVP; check release notes before choosing an installer. Store distribution follows the submission workflow and Microsoft review.

Use **Windows 10/11 x64** and **Node.js 22+** to develop without installing:

```powershell
git clone https://github.com/yechankun/streamer-assist.git
cd streamer-assist
npm ci
npm run dev
```

React/CSS changes refresh immediately. Electron code changes save the current session and restart the app. To try the tools offline, start recording in **방송 타임라인**, then enable **설정 → 일반 → 테스트 채팅**. Roulette also runs independently.

Configure real connections in **설정 → 플랫폼 연결**. CHZZK public chat uses a channel URL; YouTube and Twitch use browser approval. App developers configure OAuth once; end users do not paste tokens. See [YouTube/Twitch setup](docs/development.md).

Unsigned EXE and development MSIX artifacts are available in successful [CI runs](https://github.com/yechankun/streamer-assist/actions/workflows/ci.yml) under `windows-packages`. They are preview/verification artifacts; MSIX Store-upload packages are not signed for direct sideloading.

## Documentation

| Guide | English | 한국어 |
| --- | --- | --- |
| Tools, connections and date management | [User guide](docs/user-guide.md) | [사용 가이드](docs/user-guide.ko.md) |
| Archive schema and future AI data | [Timeline data](docs/timeline-data.md) | [기록·분석 형식](docs/timeline-data.ko.md) |
| Live development, OAuth, tests and builds | [Development](docs/development.md) | [개발 가이드](docs/development.ko.md) |
| Measured performance and reproduction | [Performance](docs/performance.md) | [성능 측정](docs/performance.ko.md) |
| MSIX / Store CI/CD | [Store setup](docs/store-setup.en.md) | [Store 설정](docs/store-setup.md) |
| Review walkthrough | [Certification guide](docs/certification.en.md) | [심사용 안내](docs/certification.md) |
| Data handling | [Privacy policy](docs/privacy.en.html) | [개인정보처리방침](docs/privacy.html) |
| Captures and contributions | [Screenshots](docs/assets/screenshots/README.md#english) · [Contribute](CONTRIBUTING.md#english) | [캡처](docs/assets/screenshots/README.md#한국어) · [기여](CONTRIBUTING.md#한국어) |

## Development and releases

```powershell
npm test                 # Core logic and build-cache safety checks
npm run test:desktop     # Checked build + all eight Electron suites
npm run dist:all         # Windows EXE and MSIX
npm run verify:msix      # Manifest, runtime files and privacy exclusions
```

For a focused UI check: `node scripts/test-desktop.cjs --build --suite timeline`. To force a new renderer bundle: `node scripts/build.cjs --force`.

Checked build reuse, incremental type checking, parallel bundling/packaging and public-tool caches reduce repeated work. A source or output change invalidates the cache; a type error blocks publication. Successful test PNG capture is opt-in. See [measurements](docs/performance.md) for the workload and timing limits.

Pushes/PRs run Windows checks, package verification and an installed-MSIX check on a disposable runner. A version-matching `v*` tag publishes installers/checksums. Store updates run only after initial publication and `STORE_PUBLISH_ENABLED=true`. In-app automatic updates are not implemented.

## Data and platform notes

Raw chats, donations, public participant profiles, viewer samples and broadcast metadata are retained locally with Windows DPAPI until explicit deletion. Date deletion preserves other days and markers. All-history deletion resets analytical identities; exported files/backups are separately managed. Markdown/JSON/JSONL exports are unencrypted, and original text can contain personal information.

CHZZK uses an unofficial public read-only protocol. YouTube and Twitch use official APIs and browser authorization. Twitch Bits can be archived as BITS records, while Bits donation voting and Twitch native polls remain unsupported. Live login/chat/native polls and paid events still need validation against real platforms. See [platform limits](docs/user-guide.md#platforms-and-limits).

## Contributing and license

[Issues](https://github.com/yechankun/streamer-assist/issues) and focused pull requests are welcome; follow [CONTRIBUTING.md](CONTRIBUTING.md). Keep English/Korean guides synchronized and remove personal data from captures.

[MIT licensed](LICENSE). This independent project is not affiliated with NAVER/CHZZK, YouTube or Twitch. Participation rules were informed by [CHZZK VOTE](https://github.com/WisdomIT/chzzk-vote), and the public chat protocol by [kimcore/chzzk](https://github.com/kimcore/chzzk). Screens, layout and branding here belong to Streamer Assist.

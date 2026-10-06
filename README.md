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
  <p><sub>Actual app captures from main, using an isolated profile and generated sample data. The app interface is currently Korean.</sub></p>
</div>

## Why Streamer Assist?

Keep track of moments worth editing and invite viewers to shape what happens next. Streamer Assist combines a broadcast timeline, chat reaction highlights, and audience participation tools for **CHZZK and YouTube**, running directly on your PC without a hosted application backend.

The workspace brings your recording status, recent moments and active audience tools together. A frameless window, dark and light themes, animated broadcast views, and optional system tray operation keep everything close at hand during a stream.

## Features

| Tool                   | What you can do                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Broadcast timeline** | Mark a moment from any window with a configurable global shortcut. Add notes, find chat reaction spikes, and export Markdown or JSON after the stream. |
| **Viewer raffle**      | Collect entrants from chat or a keyword, filter subscribers/members, exclude previous winners, and draw with an animated reveal.                       |
| **Number vote**        | Combine CHZZK and YouTube votes, choose a chat command or YouTube's native live poll, and show large animated results.                                 |
| **Donation vote**      | Count eligible CHZZK Cheese and YouTube Super Chat messages as one vote per viewer or votes proportional to the donation amount.                       |
| **Weighted roulette**  | Create 2–12 weighted entries or import an ended vote. Spin a wheel whose slice sizes match the draw probabilities.                                     |
| **Workspace settings** | Capture your own shortcut, manage connections and tray behavior, switch themes, and control locally stored records.                                    |

Chat highlights use local statistics to identify editing candidates from audience reactions. They do not analyze video/audio or use an external AI service.

## Screenshots

Click an image to view it at full resolution. Participants, donations and vote counts are generated samples; no real accounts or payments are shown.

<table>
  <tr>
    <td width="50%">
      <a href="docs/assets/screenshots/timeline.png"><img src="docs/assets/screenshots/timeline.png" alt="Broadcast timeline with manual markers and an automatically detected chat reaction spike"></a>
      <br><strong>Keep the moments worth revisiting</strong><br>
      Timestamped notes and chat evidence in one timeline.
    </td>
    <td width="50%">
      <a href="docs/assets/screenshots/live-poll.png"><img src="docs/assets/screenshots/live-poll.png" alt="Number vote results with four bars, percentages and elapsed time"></a>
      <br><strong>Let viewers choose what comes next</strong><br>
      A vote opens directly into a broadcast view.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="docs/assets/screenshots/viewer-raffle.png"><img src="docs/assets/screenshots/viewer-raffle.png" alt="Viewer raffle showing a generated winner and the recent entrant list"></a>
      <br><strong>Bring a viewer into the spotlight</strong><br>
      Recruitment, eligibility filters and winner history.
    </td>
    <td width="50%">
      <a href="docs/assets/screenshots/donation-vote.png"><img src="docs/assets/screenshots/donation-vote.png" alt="Donation vote showing a sample KRW amount-per-vote rule and three result bars"></a>
      <br><strong>Turn donations into audience choices</strong><br>
      Clear amount rules, totals and currency handling.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="docs/assets/screenshots/roulette.png"><img src="docs/assets/screenshots/roulette.png" alt="Weighted roulette imported from a donation vote with three proportional slices"></a>
      <br><strong>Add a little suspense</strong><br>
      Turn vote results into a weighted wheel.
    </td>
    <td width="50%">
      <a href="docs/assets/screenshots/settings.png"><img src="docs/assets/screenshots/settings.png" alt="General settings for keyboard shortcut, tray, startup and theme"></a>
      <br><strong>Make it fit your workflow</strong><br>
      Shortcuts, tray operation and themes in one place.
    </td>
  </tr>
</table>

<details>
  <summary>The workspace during a stream</summary>
  <p>Recording time, recent markers and tool activity are visible from the home workspace.</p>
  <img src="docs/assets/screenshots/home-recording.png" width="1080" alt="Workspace showing a sample ongoing recording, marker counts and recent moments">
</details>

<details>
  <summary>Privacy and local data controls</summary>
  <p>Read the bundled policy, delete broadcast and participation records after confirmation, or reset the roulette list from Settings → Info &amp; Data.</p>
  <img src="docs/assets/screenshots/privacy.png" width="1080" alt="Information and data settings with privacy policy, record deletion and offline demo instructions">
</details>

## Get started

**This is an active preview.** The screenshots and features above describe `main`. The published `v0.1.0` installer is an earlier MVP and does not include the current design and all of these tools. Microsoft Store publication is still being prepared.

| Option                        | Where to go                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Try the current preview**   | Run from source below, with no app installation required.                                                                                                                    |
| **Download a CI build**       | Open a successful [CI run](https://github.com/yechankun/streamer-assist/actions/workflows/ci.yml) and download `windows-packages`. GitHub sign-in is required for artifacts. |
| **Browse published versions** | [GitHub Releases](https://github.com/yechankun/streamer-assist/releases). Check the version and release notes before downloading.                                            |

Development requirements: **Windows 10/11 x64** and **Node.js 22+**.

```powershell
git clone https://github.com/yechankun/streamer-assist.git
cd streamer-assist
npm ci
npm run dev
```

The Electron window opens alongside Vite. React/CSS changes appear immediately; changes to Electron code save the session and restart the app automatically.

To try it without connecting an account:

1. Open **방송 타임라인** (Broadcast timeline) and start recording.
2. Open **설정 → 일반 → 테스트 채팅 켜기** (Settings → General → Enable test chat).
3. Try the raffle, number vote, and donation vote with generated events. Roulette also works independently.

Connect real platforms under **설정 → 플랫폼 연결** (Settings → Platform connections): a CHZZK channel URL or YouTube browser login. No manual user token entry is required. Building your own copy with YouTube login requires a one-time [developer OAuth setup](docs/development.md#youtube-oauth).

GitHub EXE builds are currently unsigned. MSIX artifacts are intended for Store submission and are not signed for direct installation.

## Documentation

| Guide                                                  | English                                                  | 한국어                                                |
| ------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------- |
| Using the tools, vote rules and platform behavior      | [User guide](docs/user-guide.md)                         | [사용 가이드](docs/user-guide.ko.md)                  |
| Live development, OAuth configuration and architecture | [Development](docs/development.md)                       | [개발 가이드](docs/development.ko.md)                 |
| MSIX packaging and automatic Store updates             | [Store setup](docs/store-setup.en.md)                    | [Store 자동 배포](docs/store-setup.md)                |
| Contributing                                           | [Contributing](CONTRIBUTING.md#english)                  | [기여 안내](CONTRIBUTING.md#한국어)                   |
| Reproducing the product captures                       | [Screenshots](docs/assets/screenshots/README.md#english) | [화면 캡처](docs/assets/screenshots/README.md#한국어) |

The [privacy policy](https://yechankun.github.io/streamer-assist/privacy.html) and [Store review walkthrough](docs/certification.md) are currently available in Korean.

## Development and releases

```powershell
npm test                 # Core logic tests
npm run test:desktop     # Build and isolated Electron checks
npm run dist             # Windows EXE installer
npm run dist:msix        # Microsoft Store MSIX package
```

- **Push / pull request:** Windows checks, EXE/MSIX packaging, package verification, and an installation/runtime check on a disposable GitHub runner.
- **Version tag:** A `v*` tag matching `package.json` publishes installers and SHA256 checksums to GitHub Releases.
- **Store updates:** Once initial publication and API credentials are ready, enabled releases submit the MSIX for Microsoft review.
- **Privacy documentation:** Changes deploy automatically through GitHub Pages.

See the [development guide](docs/development.md) for the full workflow. Automatic in-app updates are not implemented.

## Data and platform notes

Broadcast records and YouTube account tokens are encrypted locally with Windows DPAPI. Full chat transcripts are not written to disk. Markdown/JSON exports are ordinary files you choose to save.

CHZZK uses an unofficial, read-only public chat protocol; platform changes or login-restricted streams may prevent connection. YouTube uses the official API and browser OAuth. See the [user guide](docs/user-guide.md#platforms-and-limits) for platform behavior and validation limits.

## Contributing and license

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, validation and the bilingual documentation workflow.

Released under the [MIT License](LICENSE). Built independently; this project is not affiliated with NAVER/CHZZK or YouTube.

Participation behavior was informed by the public [CHZZK VOTE source](https://github.com/WisdomIT/chzzk-vote), and CHZZK's public chat protocol by [kimcore/chzzk](https://github.com/kimcore/chzzk). Product screens, layout and branding in this repository are from Streamer Assist itself.

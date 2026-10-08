<div align="center">
  <img src="docs/assets/logo.svg" width="80" height="80" alt="Streamer Assist logo">
  <h1>Streamer Assist</h1>
  <p>A Windows app for recording stream chat and running viewer raffles, votes and roulette on CHZZK, YouTube and Twitch.</p>
  <p>
    <a href="https://github.com/yechankun/streamer-assist/actions/workflows/ci.yml"><img src="https://github.com/yechankun/streamer-assist/actions/workflows/ci.yml/badge.svg?branch=main" alt="Windows CI"></a>
    <img src="https://img.shields.io/badge/platform-Windows_x64-0078D4?style=flat" alt="Windows x64">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-00c78c?style=flat" alt="MIT license"></a>
  </p>
  <p><strong>English</strong> · <a href="README.ko.md">한국어</a></p>
  <p><a href="#get-started">Get started</a> · <a href="#screenshots">Screenshots</a> · <a href="docs/user-guide.md">User guide</a></p>
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/screenshots/home-light.png">
    <img src="docs/assets/screenshots/home-dark.png" width="1080" alt="Streamer Assist workspace with a broadcast timeline summary and four audience tools">
  </picture>
  <p><sub>Actual development screens with synthetic data. The interface is currently Korean.</sub></p>
</div>

## Features

- **Record your broadcast** — Keep chat, supported donations and viewer samples, and mark moments with a keyboard shortcut.
- **Involve your viewers** — Run viewer raffles, number votes, supported donation votes and weighted roulette.
- **Review the stream** — Search chat and inspect activity. Optionally analyze selected records with a connected AI.

Arrange tools across tabs and windows, and adjust text size to suit your screen.


Choose live archive, deferred analysis or post-broadcast replay collection in **Settings → Broadcast recording**. YouTube, Twitch and CHZZK replay chat can be merged per video when available; live viewer samples and participation remain independent. See [capture modes and delivery limits](docs/timeline-data.md).

## Get started

Use **Windows 10/11 x64**. Find installers and changes for each version in [GitHub releases](https://github.com/yechankun/streamer-assist/releases/latest). This is a development preview.

Try the tools without connecting an account:

1. Open **방송 타임라인 → 방송 기록 시작** (Timeline → Start recording).
2. Turn on **설정 → 일반 → 테스트 채팅** (Settings → General → Test chat).
3. Open **시청자 추첨**, **숫자 투표** or **룰렛** (Viewer raffle, Number vote or Roulette).

Test chat generates sample messages without payments or real poll publication. For a real broadcast, use **설정 → 플랫폼 연결**. Continue with the [user guide](docs/user-guide.md).

<details>
<summary>Run from source</summary>

Node.js 22 or later is required.

```powershell
git clone https://github.com/yechankun/streamer-assist.git
cd streamer-assist
npm ci
npm run dev
```

See the [development guide](docs/development.md) for builds, tests and OAuth setup.

</details>

## Screenshots

Click a picture for full resolution. All screens use synthetic data.

<table>
  <tr>
    <td width="50%"><a href="docs/assets/screenshots/timeline.png"><img src="docs/assets/screenshots/timeline.png" alt="Broadcast clock, viewer graph and markers"></a><br><strong>Broadcast timeline</strong><br>Keep the stream clock, viewer samples and marked moments together.</td>
    <td width="50%"><a href="docs/assets/screenshots/viewer-raffle.png"><img src="docs/assets/screenshots/viewer-raffle.png" alt="Viewer recruitment and raffle result"></a><br><strong>Viewer raffle</strong><br>Draw a participant from chat.</td>
  </tr>
  <tr>
    <td width="50%"><a href="docs/assets/screenshots/live-poll.png"><img src="docs/assets/screenshots/live-poll.png" alt="Live number-vote results"></a><br><strong>Number vote</strong><br>Show viewers' choices as they arrive.</td>
    <td width="50%"><a href="docs/assets/screenshots/roulette.png"><img src="docs/assets/screenshots/roulette.png" alt="Weighted roulette choices and probabilities"></a><br><strong>Weighted roulette</strong><br>Spin your own entries or import an ended vote.</td>
  </tr>
</table>

[More chat, AI, tab and settings screens](docs/assets/screenshots/README.md)

<a id="data-and-platform-notes"></a>

## Before you use it

- The app does not record video/audio. Automatic highlights are editing candidates found from chat reactions.
- Donation voting uses supported CHZZK and YouTube messages. Twitch native polls and Bits donation voting are unsupported.
- Archives are encrypted on your PC. Exports are ordinary files. Running optional AI analysis sends the selected records to the assigned external CLI/API.

See the [user guide](docs/user-guide.md#platforms-and-limits) for connection requirements and data controls.

## Documentation

| What you want to do | Guide |
| --- | --- |
| Connect a stream and use the tools | [User guide](docs/user-guide.md) |
| Connect an AI and analyze chat | [AI guide](docs/ai-integrations.md) |
| Run, test or build the source | [Development](docs/development.md) |

[All documentation](docs/README.md) · [Privacy policy](docs/privacy.en.html)

## Contributing and license

[Feedback and issues](https://github.com/yechankun/streamer-assist/issues) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)

An independent open-source project, unaffiliated with NAVER/CHZZK, YouTube or Twitch.

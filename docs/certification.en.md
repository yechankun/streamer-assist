# Streamer Assist review walkthrough

This Windows desktop app provides broadcast timelines, local chat reaction highlights, viewer raffles, number/donation votes and weighted roulette. The interface is Korean. It is an independent app, not an official CHZZK, YouTube or Twitch client.

## Review without an account

1. Open **방송 타임라인** (Broadcast timeline) and press **방송 기록 시작** (Start recording).
2. Open **설정 → 일반 → 테스트 채팅** (Settings → General → Test chat).
3. Try **시청자 추첨** (Viewer raffle): recruit from generated chat or a keyword, filter subscriber/member examples, set a timer and draw.
4. In **숫자 투표** (Number vote), add 2–4 blank choices with Add/Enter and start. The app switches to a broadcast result view with generated votes.
5. **도네 투표** (Donation vote) receives only generated sample donations in this mode. No payment occurs.
6. Import an ended vote with **결과로 룰렛**, or create independent weighted roulette entries.
7. In the timeline, inspect the viewer graph, **채팅·후원** all-date/platform filters and **날짜·용량 관리** day/week/month selection. In **분석·AI 데이터**, inspect local statistics and export JSONL. Stop the recording and export Markdown/JSON. **설정 → 정보·데이터** provides the bundled policy and confirmed record deletion.
8. Use **+** or the tab context menu to open multiple instances in tabs/windows. Check reordering, transfers, Close and Close All. Recording and platform collection remain shared and continue after a tab closes. Layouts and window positions survive restart.
9. Adjust **설정 → 일반 → 글자 크기** from 95% to 150% and check reset/window synchronization. Number and donation votes offer **자동 종료 타이머** in minutes/seconds with a remaining-time display and automatic closing.

## Optional AI connection and analysis checks

1. Choose an AI with **설정 → AI 연결 → +**. Prepare its connector and CLI separately; provider implementations and CLI binaries are excluded from the app installer.
2. Sign into the CLI or connect an API key, then retrieve actual available models. Codex, Claude, Grok and Kimi use app-specific login profiles. Antigravity signs in/out of the shared PC session only after **PC 로그인 공유** is explicitly enabled.
3. Change the AI/model/reasoning dropdowns in **기능별 AI** and verify automatic saving, **그룹 따르기** inheritance and **AI 사용 안 함**. Six functions in three groups resolve settings in the order individual function → group → overall default. Unavailable connections show their reason.
4. In **방송 타임라인 → AI 분석**, choose the function and scope and review the resolved AI/model/reasoning, record count and sampling. Running analysis calls an external CLI/API and requires service access; API charges may apply.
5. Check cancellation, saved-result selection/deletion, usage, available CLI limits and estimated API cost. Transmission uses pseudonymous identities by default but retains personal information typed into chat.

Test chat demonstrates the archive and audience tools; it does not authenticate an AI account. Documentation images use simulated authentication/models in isolated profiles and do not establish real-account or paid-service validation.

## Real connections

Public CHZZK chat uses a channel URL and an unofficial read-only protocol. Login-restricted streams are unsupported. YouTube uses browser OAuth and requires the broadcast channel owner's permission and an active broadcast. Live platform behavior depends on the platform and API availability.

The app does not take payments. Donation voting reads qualifying messages already provided by connected platforms; it does not process card or bank information. Roulette is a local weighted selection tool.

Twitch requires a configured Public app Client ID and browser Device Code approval for `user:read:chat`. Official EventSub WebSockets connect to the broadcaster's own channel for highlights, subscriber raffles and number votes. Twitch native polls and Bits donation voting are not supported yet. Real OAuth and live reception require separate validation.

## Package behavior

- **runFullTrust** enables Electron/Node desktop execution, global marker shortcuts, the tray and user-selected exports.
- **internetClient** supports platform APIs, browser OAuth, AI connector/CLI downloads and optional AI analysis.
- The startup task is disabled by default. In MSIX the app opens Windows Startup Apps settings.
- Closing a secondary window returns its tabs to the primary window. Closing the primary window hides it when the tray is enabled or other windows remain. Exit fully through the tray, or disable the tray and close the only remaining primary window.
- Records and YouTube/Twitch tokens are encrypted locally with Windows DPAPI. Original chats/donations/profiles/viewer samples are persisted in encrypted local archives until deletion. Date selection reports file sizes and protects active recordings. JSONL exports pseudonymous analysis data. Optional CLI/API analysis runs only on user request. Verify installation/login, scope preview, cancellation, usage and the AI privacy disclosure in the submitted package.

Privacy policy: https://yechankun.github.io/streamer-assist/privacy.html
Support: https://github.com/yechankun/streamer-assist/issues

This walkthrough describes the current development implementation. Submit descriptions and images that match the exact packaged version; the published v0.1.0 MVP may have fewer features.

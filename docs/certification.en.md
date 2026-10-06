# Streamer Assist review walkthrough

This Windows desktop app provides broadcast timelines, local chat reaction highlights, viewer raffles, number/donation votes and weighted roulette. The interface is Korean. It is an independent app, not an official CHZZK or YouTube client.

## Review without an account

1. Open **방송 타임라인** (Broadcast timeline) and press **방송 기록 시작** (Start recording).
2. Open **설정 → 일반 → 테스트 채팅** (Settings → General → Test chat).
3. Try **시청자 추첨** (Viewer raffle): recruit from generated chat or a keyword, filter subscriber/member examples, set a timer and draw.
4. In **숫자 투표** (Number vote), add 2–4 blank choices with Add/Enter and start. The app switches to a broadcast result view with generated votes.
5. **도네 투표** (Donation vote) receives only generated sample donations in this mode. No payment occurs.
6. Import an ended vote with **결과로 룰렛**, or create independent weighted roulette entries.
7. Stop the recording and export Markdown/JSON. **설정 → 정보·데이터** provides the bundled policy and confirmed record deletion.

## Real connections

Public CHZZK chat uses a channel URL and an unofficial read-only protocol. Login-restricted streams are unsupported. YouTube uses browser OAuth and requires the broadcast channel owner's permission and an active broadcast. Live platform behavior depends on the platform and API availability.

The app does not take payments. Donation voting reads qualifying messages already provided by connected platforms; it does not process card or bank information. Roulette is a local weighted selection tool.

## Package behavior

- **runFullTrust** enables Electron/Node desktop execution, global marker shortcuts, the tray and user-selected exports.
- **internetClient** supports platform APIs and browser OAuth.
- The startup task is disabled by default. In MSIX the app opens Windows Startup Apps settings.
- Closing hides the window when the tray is enabled; use the tray menu to exit fully. Turning the tray off makes Close save and exit.
- Records and YouTube tokens are encrypted locally with Windows DPAPI. Full chat transcripts are not persisted; no analytics or external AI SDK is included.

Privacy policy: https://yechankun.github.io/streamer-assist/privacy.html
Support: https://github.com/yechankun/streamer-assist/issues

# User guide

**English** · [한국어](user-guide.ko.md) · [Back to README](../README.md)

The app interface is currently Korean. Korean labels below help you locate the controls.

## Try it offline

Run `npm run dev`. Open **방송 타임라인** (Broadcast timeline), start recording, then enable **설정 → 일반 → 테스트 채팅** (Settings → General → Test chat).

Generated events create highlights, raffle entrants and sample donations. A test platform appears while demo mode is active. Demo events do not post platform polls or charge donations. Turn test chat off before using real platforms. Roulette works independently.

## Timeline and highlights

1. Enter a title and press **방송 기록 시작**. If already streaming, enter elapsed seconds first (30 minutes = `1800`).
2. Record a moment with the global shortcut, or enter a note and press **마커**. Defaults: `Ctrl+Shift+F8` in installed builds and `Ctrl+Alt+F8` in development.
3. In **설정 → 일반 → 타임라인 기록 단축키**, click the field and press your desired combination. Use Ctrl/Alt/Shift/Win combinations or F1–F24. Conflicts or save failures preserve the old shortcut.
4. Stop recording and export Markdown or JSON. Select previous sessions from the timeline menu.

Elapsed time uses the local recording start and offset, without automatic platform synchronization. The home workspace shows the active recording, marker/highlight counts and two recent moments; its timeline button opens the recording page.

Automatic highlights require at least **15 messages / 5 participants in 10 seconds**, at **2.5 times** the preceding 60-second average. Laughter/exclamation samples add context. Detection has a 45-second cooldown and suggests starting the clip 15 seconds earlier.

These are statistical editing candidates. The app does not record/analyze video or audio, call external AI, or judge whether a moment is objectively funny.

## Platform connections

Open **설정 → 플랫폼 연결** (Settings → Platform connections).

| Platform | Connection                                                                                  | Participation                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| CHZZK    | Public channel/live URL or channel ID, without login or developer app registration.         | Read-only chat, keyword votes, raffles and supported Cheese messages. Copy instructions to announce them yourself. |
| YouTube  | Browser login as the broadcast channel owner; active broadcast chat is found automatically. | Chat commands, native live polls, raffles and supported Super Chat messages.                                       |

Your own YouTube-enabled build needs [developer OAuth configuration](development.md#youtube-oauth). Users grant access in the browser rather than entering tokens. With no active broadcast, the app waits; **방송 채팅 다시 찾기** searches again.

Only connected platforms appear as participation buttons. Toggle them before starting; selected platforms need live chat ready. Starting a vote freezes platform/command settings. You cannot start with no platform selected.

## Number votes

Enter a question and **2–4 choices**. **추가** or Enter adds a choice, clears the field and leaves it focused. Enter during Korean IME composition does not add one. Rows can be edited/removed; initial guidance is placeholder text.

The default accepts `!투표1` or `!투표 1`, followed optionally by ordinary chat. Change the prefix (up to 12 characters), or leave it empty to accept an exact number like `1`. Copy the participation instructions to explain the rules.

Each platform account holds one vote; a later valid command moves it to the latest choice. Identities are not merged across platforms. Older saved polls retain their original bare-number/first-vote rules.

Choose YouTube chat commands or its native live poll. Native mode excludes YouTube chat commands from that vote to avoid counting both methods.

Starting opens the broadcast view with totals, percentages, commands and elapsed time. **결과 가리기** hides results, **투표 설정** revisits setup, and **투표 종료** finishes. Ended results and the frozen timer remain; **새 투표** opens a blank form. Import ended results into roulette.

## Viewer raffles

Recruit from any chat or a keyword (default `!참여`). Optional filters cover CHZZK subscribers/YouTube members and previous winners; an optional timer ends recruitment.

An account enters once per platform. Draw during recruitment or after it closes. Cryptographically secure randomness selects one eligible entrant from the entire pool, with a three-second draw lock and an animated reveal. Results persist across tabs/restarts. A new recruitment resets entrants and winner history.

The latest 100 names are shown; all eligible entrants are included in a draw. Recruitment ends with a notice at 10,000 entrants.

## Donation votes

Choose 2–4 options, a command (default `!투표`), currency, amount rule and optional timer.

| Rule                    | Behavior                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| **One vote per viewer** | A donation at or above the minimum gives one vote. Another qualifying donation changes the viewer's choice. |
| **Votes by amount**     | Each donation adds `floor(amount / amount-per-vote)` votes. Remainders do not carry to later donations.     |

At 1,000 KRW per vote, 2,500 KRW gives 2 votes; a later 500 KRW gives none. CHZZK Cheese uses KRW. YouTube Super Chat must match the selected currency (KRW, USD, JPY, EUR, GBP, CAD or AUD). Other currencies are skipped and reported, without conversion.

Only new supported donations with identifiable accounts and valid commands count. Ordinary chat, anonymous donations, stickers and historical messages are excluded. Duplicate donation IDs are ignored, including after restoring results.

Donation votes have the same broadcast view and roulette import. Collection ends at 50,000 events or one billion votes per choice.

## Weighted roulette

Create **2–12 unique entries** with integer weights from 0 to one billion, or import combined results from an ended vote. Zero-weight entries cannot win; the total must be positive.

Open **방송용 룰렛 보기 → 돌려!**. The Node engine securely chooses a weighted interval. Slice sizes, displayed percentages and draw probabilities match; the animation stops on the selected slice.

Editing/import is locked during a spin. Switching tabs preserves the spin/result. Title, entries and weights persist locally; Settings → Info & Data can reset them after confirmation.

## Window, tray and data

Drag the frameless header to move the window. Custom controls minimize/maximize/close it. Themes persist and Windows reduced-motion preferences are respected. The outer layout stays within the window at the 900 × 650 minimum; long lists scroll inside panels.

- **Tray on:** closing hides the window; collection and timers continue in Electron main. Exit fully through the tray.
- **Tray off:** closing saves records and exits.
- **Startup:** installed EXE builds offer a toggle; MSIX opens Windows Startup Apps settings. Development does not change Windows startup.

Records are encrypted in `records.enc` and YouTube tokens in `accounts.enc` using Windows DPAPI, under `userData` (typically `%APPDATA%/streamer-assist`). Preferences and roulette entries are local configuration; Markdown/JSON exports are ordinary files.

The active recording and latest 100 sessions are saved, including markers, limited reaction samples, results and deduplication identifiers. Full transcripts are not stored. The in-memory analysis buffer is capped at 70 seconds / 10,000 messages. Older plaintext sessions migrate only after encrypted saving succeeds, with an encrypted recovery copy.

**설정 → 정보·데이터** provides the bundled privacy policy, demo instructions and confirmed deletion. End recording/recruitment/votes before deleting. Deletion removes records and encrypted recovery copies, preserving account connections and settings. Disconnect YouTube separately; revoke permissions through Google's connected-app settings if needed.

## Platforms and limits

- CHZZK uses an unofficial, read-only public-chat protocol. Login-restricted streams are unsupported and upstream changes can interrupt connection. Channel changes/disconnections are checked periodically; temporary anonymous read credentials stay in memory.
- YouTube uses official APIs and respects `pollingIntervalMillis`. OAuth requests `youtube.force-ssl` with PKCE and a temporary loopback callback on `127.0.0.1`, which closes after login.
- Hidden CHZZK messages and old fetched chat are excluded from analysis/voting.
- Automated checks use mock responses and isolated profiles. Real YouTube login, live chat/native polls and paid donation reception require validation in a broadcast environment before production release.
- CI installation checks are not Microsoft certification; see [Store setup](store-setup.en.md).

## References

Participation rules were informed by [CHZZK VOTE](https://github.com/WisdomIT/chzzk-vote), including its [vote parser](https://github.com/WisdomIT/chzzk-vote/blob/master/lib/vote.ts) and [result logic](https://github.com/WisdomIT/chzzk-vote/blob/master/app/%28main%29/vote/_views/Running.tsx). The public chat protocol was informed by [kimcore/chzzk](https://github.com/kimcore/chzzk). Streamer Assist does not connect through the reference voting site.

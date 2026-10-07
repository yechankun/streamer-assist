# User guide

**English** · [한국어](user-guide.ko.md) · [Back to README](../README.md)

The app interface is currently Korean. Korean labels below help you locate the controls.

## Try it offline

Run `npm run dev`. Open **방송 타임라인** (Broadcast timeline), start recording, then enable **설정 → 일반 → 테스트 채팅** (Settings → General → Test chat).

Generated events create highlights, raffle entrants and sample donations. A test platform appears while demo mode is active. Demo events do not post platform polls or charge donations. Turn test chat off before using real platforms. Roulette works independently.

## Timeline and highlights

Enable **방송 자동 감지** in the timeline or Settings → General. Any connected channel confirmed live starts recording; recording ends when every connected channel is confirmed offline. A failed request remains unknown and does not close the timeline. The earliest available platform start time becomes the common clock; if unavailable, detection time is used. Capture begins when this app collects messages, so missing earlier chat is not reconstructed.

Manual recording remains available: enter a title and elapsed seconds, then press **방송 기록 시작** (30 minutes = `1800`). Manually stopping an ongoing detected stream prevents its immediate restart until it ends or automatic detection is re-enabled.

Record a moment with the global shortcut or the **마커** button. Defaults are `Ctrl+Shift+F8` for installed builds and `Ctrl+Alt+F8` for development. In **설정 → 일반 → 타임라인 기록 단축키**, click the capture field and press a combination or F1–F24. The previous shortcut is retained if registration/save fails.

The viewer graph shows platform-reported concurrent counts, with an aggregate or per-platform view. Unknown/unavailable samples are gaps, rather than zero estimates. Markers and records adapt to the window with pagination.

Automatic highlights need at least **15 messages from 5 participants within 10 seconds**, at **2.5 times** the preceding 60-second baseline, with a 45-second cooldown. They suggest a clip start 15 seconds earlier. These are local statistical editing candidates. No video/audio recording or external AI judgment is performed.

## Chat history and date selection

Open **방송 타임라인 → 채팅·후원**. The default scope is **전체 방송·전체 날짜** (all broadcasts/dates). Filter to a broadcast, CHZZK/YouTube/Twitch or all platforms, chat/donation type, text or participant. A selected broadcast also supports elapsed-minute filters. Rows show the original local date/time; records are read in bounded pages.

Open **날짜·용량 관리** to manage storage:

1. Switch between **일별 / 주별 / 월별**: day, Monday-based week or month.
2. Click multiple groups, Shift-click a range, set start/end dates, or use **전체 선택**. Selecting a week/month selects its stored dates; zoom changes preserve those dates.
3. Read the selected size. It sums actual encrypted original-file lengths, including participant/viewer events. Shared date/statistical indexes are excluded; disk allocation-unit usage differs.
4. Press **선택 날짜 삭제** and review the dates/size confirmation. Dates belonging to an active recording are protected. Other dates and markers remain; statistics are rebuilt.

Older shared files can span multiple dates. Their physical size is counted once in the selected scope, and shared bytes are identified. Compaction and retained participant profiles can make reclaimed space differ from the preview. Interrupted deletion resumes on reopening. No history is pruned automatically by session count.

## Analysis and exports

**분석·AI 데이터** provides minute activity, lexical reactions, frequent terms and participant statistics. Participant keys distinguish platform accounts across broadcasts on this installation. Subscription/role/badge values reflect information actually provided by the platform.

| Export | Contents |
| --- | --- |
| Header **기록 내보내기 / JSON** | Selected broadcast metadata, markers and highlight evidence in Markdown/JSON. |
| **분석 데이터 내보내기** | JSONL with times, participants, chat, donations, viewer samples, markers and local statistics. |

Default JSONL removes public native account/message IDs and uses pseudonymous nicknames; analytical speaker keys remain linkable. **공개 닉네임·플랫폼 ID 포함** includes public identity fields. Chat text, marker notes and reaction examples stay original and may contain personal information. Exports are ordinary unencrypted files.

## AI connections and function analysis

1. Add an AI with **Settings → AI 연결 → +**. Its connector downloads automatically. Prepare the CLI separately with **다운로드·설치** or **설치 관리 → 설치 찾기** to detect an existing installation.
2. Choose **CLI/API**, then sign in or save an API key. After CLI authentication, **모델 조회하고 계속** retrieves models; the API dialog uses **저장하고 연결 확인**. Save the connection's basic model with **연결 저장**.
3. In **기능별 AI**, assign an overall or group default. Chat analysis includes free-form analysis, question organization and reaction analysis; broadcast review includes summary and highlights; donation analysis includes donation summary. Individual functions can override the model and reasoning level. Settings apply in the order **individual function → group → overall default**.
4. In **방송 타임라인 → AI 분석**, choose the function, broadcast, platform, dates and elapsed-time range. Review the resolved AI, model, reasoning level, included/total records and sampling before running. If the function has no usable AI, **AI 지정하기** opens its settings.
5. Review result usage, available CLI limits and estimated API fees. Running requests can be stopped; saved results can be reopened or deleted.

Codex, Claude, Grok and Kimi use app-specific login profiles. Antigravity uses the shared PC session only after **PC 로그인 공유** is explicitly enabled. Signed-in CLIs show **로그인 완료**; sign out before switching accounts. Change API keys through **API 키 관리**. CLI subscriptions and API billing are separate.

Analysis defaults to pseudonymous nicknames without public account IDs, while personal information typed into chat remains in the text. The selected records are sent to the assigned CLI/API when you run analysis. This optional analysis is separate from automatic local highlights. See [AI connections](ai-integrations.md) for authentication, settings and transmission behavior, and [data formats](timeline-data.md) for archive details.

## Platform connections

Open **설정 → 플랫폼 연결** (Settings → Platform connections).

| Platform | Connection                                                                                  | Participation                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| CHZZK    | Public channel/live URL or channel ID, without login or developer app registration.         | Read-only chat, keyword votes, raffles and supported Cheese messages. Copy instructions to announce them yourself. |
| YouTube  | Browser login as the broadcast channel owner; active broadcast chat is found automatically. | Chat commands, native live polls, raffles and supported Super Chat messages.                                       |
| Twitch | Browser Device Code login as the broadcaster; the app connects to that user's own channel. | Chat highlights, number votes and subscriber/founder raffles. Bits donation voting and Twitch native polls are not supported yet. |

Your own YouTube-enabled build needs [developer OAuth configuration](development.md#youtube-oauth). Users grant access in the browser rather than entering tokens. With no active broadcast, the app waits; **방송 채팅 다시 찾기** searches again.

Twitch-enabled builds need a [Public client configuration](development.md#twitch-oauth). The browser opens Twitch's activation page; approve chat read access using the code shown in Settings. Login can be canceled in the app. Twitch chat can connect while the channel is offline. If authorization expires or is revoked, reconnect the account. A local logout removes the saved tokens; permissions can also be revoked in Twitch's Connections settings.

Only connected platforms appear as participation buttons. Toggle them before starting; selected platforms need live chat ready. Starting a vote freezes platform/command settings. You cannot start with no platform selected.

## Number votes

Enter a question and **2–4 choices**. **추가** or Enter adds a choice, clears the field and leaves it focused. Enter during Korean IME composition does not add one. Rows can be edited/removed; initial guidance is placeholder text.

The default accepts `!투표1` or `!투표 1`, followed optionally by ordinary chat. Change the prefix (up to 12 characters), or leave it empty to accept an exact number like `1`. Copy the participation instructions to explain the rules.

Each platform account holds one vote; a later valid command moves it to the latest choice. Identities are not merged across platforms. Older saved polls retain their original bare-number/first-vote rules.

Choose YouTube chat commands or its native live poll. Native mode excludes YouTube chat commands from that vote to avoid counting both methods.

Enable **자동 종료 타이머** and enter minutes and seconds to finish automatically after 1 second–24 hours. It is off by default. The broadcast view shows the time remaining. One backend owns the deadline across tabs/windows, including after a tab closes or the app restarts. Failed native YouTube poll closes are reported and retried.

Starting opens the broadcast view with totals, percentages, commands and elapsed time. **결과 가리기** hides results, **투표 설정** revisits setup, and **투표 종료** finishes. Ended results and the frozen timer remain; **새 투표** opens a blank form. Import ended results into roulette.

## Viewer raffles

Recruit from any chat or a keyword (default `!참여`). Optional filters cover CHZZK/Twitch subscribers, YouTube members and previous winners; an optional timer ends recruitment. Twitch subscriber status comes from Subscriber or Founder chat badges.

An account enters once per platform. Draw during recruitment or after it closes. Cryptographically secure randomness selects one eligible entrant from the entire pool, with a three-second draw lock and an animated reveal. Results persist across tabs/restarts. A new recruitment resets entrants and winner history.

The latest 100 names are shown; all eligible entrants are included in a draw. Recruitment ends with a notice at 10,000 entrants.

## Donation votes

Choose 2–4 options, a command (default `!투표`), currency and amount rule. The optional **자동 종료 타이머** takes minutes and seconds (1 second–24 hours) and keeps its deadline across tab/window moves and app restarts.

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

Each spin randomly takes 4–7 seconds; there are no duration settings. Reduced-motion preferences show the result immediately.

Editing/import is locked during a spin. Switching tabs preserves the spin/result. Title, entries and weights persist locally; Settings → Info & Data can reset them after confirmation.

## Window, tray and data

Drag the frameless header to move the window. Custom controls minimize/maximize/close it. Themes persist and Windows reduced-motion preferences are respected. The outer layout stays within the window at the 900 × 650 minimum; long lists scroll inside panels. AI connections show six providers per page with previous/next controls. Long login instructions scroll within the dialog while its footer actions remain visible.

- **Tray on:** closing hides the window; collection and timers continue in Electron main. Exit fully through the tray.
- **Tray off:** closing saves records and exits.
- **Startup:** installed EXE builds offer a toggle; MSIX opens Windows Startup Apps settings. Development does not change Windows startup.

Records are encrypted in `records.enc` and YouTube/Twitch tokens in `accounts.enc` using Windows DPAPI, under `userData` (typically `%APPDATA%/streamer-assist`). Preferences and roulette entries are local configuration; Markdown/JSON/JSONL exports are ordinary files.

Recording metadata, markers and participation results are saved in `records.enc`; original chat/donation/profile/viewer events live under `timeline-data/<broadcast UUID>/`. The latest-100-session retention limit is removed. Short-term reaction detection uses a 70-second / 10,000-message memory buffer; this does not limit the raw archive. Display/statistical indexes have bounded capacities while raw events remain available. Legacy plaintext metadata migrates after encrypted saving succeeds.

**설정 → 정보·데이터** provides the bundled privacy policy, demo instructions and confirmed deletion. End recording/recruitment/votes before deleting. Deletion removes records and encrypted recovery copies, preserving account connections and settings. Disconnect YouTube separately; revoke permissions through Google's connected-app settings if needed.

## Platforms and limits

- CHZZK uses an unofficial, read-only public-chat protocol. Login-restricted streams are unsupported and upstream changes can interrupt connection. Channel changes/disconnections are checked periodically; temporary anonymous read credentials stay in memory.
- YouTube uses official APIs and respects `pollingIntervalMillis`. OAuth requests `youtube.force-ssl` with PKCE and a temporary loopback callback on `127.0.0.1`, which closes after login.
- Twitch uses official EventSub WebSockets with `user:read:chat`. Reconnects retain deduplication; messages originating in other channels during Shared Chat are excluded. Bits messages are archived as donation events with the BITS unit; Bits donation voting and Twitch native polls are not enabled.
- Hidden CHZZK messages are not collected. Available historical chat is archived with original times and a historical flag; it is excluded from live burst detection and voting. Anonymous CHZZK donations and YouTube paid stickers can be archived without becoming donation votes.
- Automated checks use mock responses, a local Twitch EventSub socket and isolated profiles. Real YouTube/Twitch login, live chat/native polls and paid donation reception require validation in a broadcast environment before production release.
- CI installation checks are not Microsoft certification; see [Store setup](store-setup.en.md).

## References

Participation rules were informed by [CHZZK VOTE](https://github.com/WisdomIT/chzzk-vote), including its [vote parser](https://github.com/WisdomIT/chzzk-vote/blob/master/lib/vote.ts) and [result logic](https://github.com/WisdomIT/chzzk-vote/blob/master/app/%28main%29/vote/_views/Running.tsx). The public chat protocol was informed by [kimcore/chzzk](https://github.com/kimcore/chzzk). Streamer Assist does not connect through the reference voting site.

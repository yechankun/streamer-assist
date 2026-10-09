# Timeline data and analysis

[한국어](timeline-data.ko.md)

Connected CHZZK, YouTube and Twitch channels are checked for live broadcasts. With automatic recording enabled, any confirmed live broadcast starts a session; a session that has observed live sources ends only when every configured channel is confirmed offline. Request/authentication errors remain unknown. Manually stopping blocks restart of that same live broadcast until it ends or automatic recording is explicitly re-enabled.

The shared timeline uses the earliest platform start time available at detection. If no start time is available, detection time is used. Recording coverage starts when the desktop app begins collecting: missing earlier messages are not reconstructed. In live-archive modes, YouTube's initial available history is archived with a historical flag and excluded from voting and burst detection.

## Local archive

The main encrypted record file holds session metadata, markers, counts and an installation-specific secret for stable viewer keys. New `SAT3` chat batches use AES-256-GCM with a per-profile key protected by Windows DPAPI. Compression, chunk writes, participant/source-ID indexes and detailed analysis run outside the main thread. Participant profiles in SQLite indexes are encrypted blobs; indexes retain salted viewer keys, counts and platform identifiers. Legacy DPAPI/Base64 batches are converted on first use on the same Windows profile. YouTube originals follow the versioned 30-day retention policy. Other platforms' originals remain until explicit deletion; exports remain user-managed.

## Capture modes

Choose **Settings → Broadcast recording**. A change applies to the next manual or automatically detected session; an active session keeps its chosen policy.

| Mode | During the broadcast | After the broadcast |
| --- | --- | --- |
| Live archive and analysis | Raw chat/donations, gameplay, viewer samples and markers. Incremental reaction windows; detailed statistics are calculated on demand in an analysis worker. | Archived records remain available for analysis. |
| Live raw archive, later analysis | Preserve original chat/donation records and basic counts. Full reaction/statistical analysis is deferred. | Calculate statistics/highlights manually or with the automatic-analysis preference. |
| Live features, later replay collection | Twitch/CHZZK text is not written to the live archive or receipt journal. YouTube official API live originals are retained. Polls, raffles, donation votes, roulette, markers and viewer samples continue. | Collect available Twitch/CHZZK VOD chat. Analyze YouTube's stored live originals after the broadcast. |

Automatic detection still starts when any linked broadcast is live and ends when all linked broadcasts are confirmed offline. Multiple broadcast IDs on the same channel are retained as separate sources, including restarts and sessions spanning midnight. Existing live votes, winners, manual markers and viewer samples are preserved when replay chat is added; historical imports never vote or join recruitment.

The YouTube web replay downloader, its yt-dlp download/execution path and its parser have been removed. Official APIs do not provide full ended-chat replay retrieval. YouTube uses official live API originals for post-broadcast analysis, including when other platforms use replay mode. YouTube-only broadcasts do not enter an unsupported automatic VOD retry loop. Messages sent before the app connected or during an outage cannot be promised to be recoverable later.

Twitch uses a separately downloaded, pinned/hash-verified [TwitchDownloaderCLI](https://github.com/lay295/TwitchDownloader). CHZZK uses the web player's paged internal chat endpoint; it has no official complete-delivery contract. See the [reference implementation and stated pagination limits](https://github.com/dudska12/chzzk-chat-report/blob/main/src/vod-chat.ts). Helper binaries are local to the app and excluded from the installer. Removing a helper does not remove archived chat.

### Official YouTube post-broadcast access

Checked against official documentation on 2026-10-09:

| Route | Supported data | Full replay chat |
| --- | --- | --- |
| [LiveChatMessages](https://developers.google.com/youtube/v3/live/docs/liveChatMessages) | Active live chat; ended chats have a `liveChatEnded` error | Not supported |
| [SuperChatEvents.list](https://developers.google.com/youtube/v3/live/docs/superChatEvents/list) | Authorized channel's Super Chat/Super Sticker purchases in the previous 30 days | No ordinary chat or video ID for reliable broadcast matching |
| [Data Portability: sent live chats](https://developers.google.com/data-portability/schema-reference/youtube) | Messages authored by the exporting user | Not all viewers' messages |
| Official API originals saved during the stream | Messages actually received and retained | Only the captured scope can be analyzed later |

Super Chat history is a confirmed official candidate, but this change does not add a separate channel-history importer. Its records are not labeled as full replay chat or silently assigned to a specific broadcast without a video ID.

Downloads are sequential/limited, files are imported incrementally, and each source cursor is saved after its imported page is committed. Pause/retry preserves the last durable import position; helper-based retries may redownload the source file before skipping already imported records. Working files produced by external helpers are temporary, can be unencrypted while downloading, stay in the app's private work folder, and are deleted on completion/cancellation/failure. The final archive and replay-job state are encrypted.

Records carry `origin: vod-replay`, `sourceVideoId`, original timestamps and VOD offsets. This is **available replay chat**, not a complete transcript of everything sent during the live broadcast. Deleted/private/unavailable videos, missing chat tracks, moderation and changes to internal endpoints can prevent collection. Known source IDs and timestamps provide alignment; trimmed videos and missing timestamps can require adjusting the video's start time. Do not infer live viewer counts or reconstruct live poll winners from replay data.

## Throughput and recovery

The live reaction window maintains exact 10/70-second counts and viewer expiry incrementally instead of scanning the last 10,000 messages on each arrival. Display snapshots remain coalesced. Main-thread dispatch has a short execution budget and yields so controls, shortcuts and deadlines can run. Raw-recording modes spill large bursts into an encrypted receipt journal. Live-features-only mode does not journal Twitch/CHZZK text; YouTube official live originals still use encrypted receipts and storage confirmation.

Owner packets stay pending until archive writes and source-ID indexes acknowledge them. Disk failures retry; unexpected writer exits replay unacknowledged packets. Source-ID deduplication is disk-backed and participant counts no longer stop at 50,000; raffles and donation collection no longer stop at 10,000/50,000 entries. Read-only profile caches remain bounded. End/quit drains received work before final persistence. Sudden process/OS/power failures can still lose messages in the volatile interval before durable admission; unlimited disk failure or sustained input above capacity cannot be guaranteed lossless.

YouTube now uses the official [server-streaming RPC](https://developers.google.com/youtube/v3/live/streaming-live-chat), resumes with its page token after committed processing, and retains retrying polling as a fallback. Twitch explicitly provides [no replay across an ordinary connection loss](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/). CHZZK public sockets and VOD web endpoints also cannot establish an end-to-end complete-delivery guarantee. App-level recovery and platform delivery limits are separate.

Use `node scripts/benchmark-chat-load.cjs --rate 20000 --seconds 30 --mode live` for a private synthetic benchmark with an independent JSON sender, visible production renderer, active voting/recruitment and actual Windows encryption. Rates 10,000/20,000/50,000 and modes `live,deferred,replay` are supported. Reports include actual sender rate, received/saved totals, ingress/storage backlog, drain time, gaps, memory and event-loop latency. Short finite runs do not prove indefinite capacity; external platform delivery is excluded.

Events include:

| Type        | Data                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| participant | Stable platform-specific pseudonymous key, public platform account ID, observed nickname, subscription status, public roles/badges, observation time.         |
| chat        | Original text, participant key, platform, source message identifier, UTC event time, UTC receive time, historical status and observed role/subscription data. |
| donation    | Message fields plus amountMicros, currency/unit and provider type. Anonymous donations retain no linked sender identity.                                      |
| viewers     | UTC sample time and per-platform count, availability and live state. Unavailable counts remain null.                                                          |

Viewer keys use a keyed HMAC over platform and platform account ID. The same account remains linkable between sessions on this installation; identical nicknames or IDs on different platforms are not merged. Clearing all history resets this installation's analysis identities; selective date deletion preserves the key. Membership, badges and roles reflect only metadata actually supplied by a platform.

## Analysis

Local statistics include minute-by-minute chat activity and time-addressable quantitative summaries; laughter, questions, excitement and links; token frequency and repeated phrases; participation and nickname changes; and separately totaled donation currencies/units. These are lexical statistics, not AI sentiment or video-content judgments. Queries support time range, platform, type, text and participant key. Viewer samples are actual provider counts rather than unique-chat-user estimates.

The UI reads summaries and the required record range, while raw messages remain in chunk files. Chat starts with the newest records and loads older batches of 100 as the list scrolls down, rendering only nearby rows. A timestamp/session UUID/event-sequence cursor excludes duplicates. Live refreshes occur at the top of the list and preserve the position of readers browsing older records. Display indexes have documented bounded capacities; original events remain in the archive. Storage failures are surfaced, and missed capture counts are retained rather than reported as saved messages.

## CLI/API analysis interface

The analysis exporter writes UTF-8 JSONL asynchronously. [Optional AI connections](ai-integrations.md) use the same timestamps and analytical speaker IDs to build a bounded context, only when the user runs analysis. Exports use the following schema:

1. manifest: schemaVersion=1, format=streamer-assist-timeline, session/capture times, source metadata, time basis and identity mode.
2. Participant and event rows in capture sequence, including original UTC timestamps and at offsets in milliseconds.
3. markers: highlight positions and the local statistical evidence.
4. summary: method=local-statistics-v1, activity bins, quantitative segments, participants, viewer samples and aggregates.

Default exports use pseudonymous profile nicknames and remove public native viewer IDs and source message IDs; analytical speaker keys remain. A desktop checkbox permits public identity fields. Chat text and quoted examples remain original and can contain identifiers typed by viewers. The manifest labels them untrusted viewer content: AI adapters treat these as analysis data rather than executable instructions.

API requests, login tokens and the HMAC secret are never included in the export. An in-progress export is a snapshot rather than a continuing stream.

## AI execution settings and retained results

JSONL exports and the app's AI results are managed separately. An analysis request identifies a function with `functionId`; the app resolves its AI, CLI/API mode, model and reasoning level from individual function → group → overall default. An unavailable assignment displays its reason and blocks execution. Later settings changes do not alter a running analysis.

`ai/settings.json` stores connections, model caches and group/function assignments as ordinary JSON without API keys. Keys live in `ai/credentials.enc` and results in `ai/results.enc`, protected by Windows encryption. CLI authentication uses each CLI's own profile storage format.

Results record the function ID, inheritance source (`assignmentSource`), actual AI/mode/model/reasoning, request, scope, transmission preview, usage, cost, quotas, status and text. Retention count, file size and text length are bounded; truncated responses are labeled in the UI. Selecting or deleting results is separate from managing the source chat archive.

Provider references: [YouTube live statistics](https://developers.google.com/youtube/v3/docs/videos#liveStreamingDetails.concurrentViewers), [Twitch streams](https://dev.twitch.tv/docs/api/reference/#get-streams), [CHZZK events](https://chzzk.gitbook.io/chzzk/chzzk-api/session).

## Date browsing and disk management

Chat history opens across all dates and broadcasts. Use the broadcast selector or CHZZK, YouTube, Twitch/all-platform filters. Each row shows original local date/time. Search, participant, chat/donation and per-broadcast elapsed-minute filters remain available.

In **Date / disk management**, switch between day, Monday-based week and month views. Click multiple items, Shift-click a range, select a start/end date, or select all available days. Date selection survives zoom changes. Pagination adapts to the window without page scrolling.

Selected size sums actual encrypted original-file lengths, including chat, donation, participant and viewer events. Shared statistical/date indexes are excluded; filesystem allocation-unit usage is different. Legacy files spanning multiple dates are counted once for the selected scope and shared size is identified. Space reclaimed can differ after preserving needed participant profiles and compacting shared files.

Deletion requires date/size confirmation, protects active broadcasts, preserves other dates and markers, and rebuilds statistics. An encrypted deletion intent completes interrupted compaction on reopening. Exports and external backups remain separately managed. Selective deletion keeps the installation identity salt; clearing all history resets it.

The production writer keeps a one-second flush and uses larger batches bounded by 20,000 events / 8 MiB. The compatible synchronous fixture/legacy store retains its 256-event / 128 KiB policy. Sequence cutoffs keep reads consistent. Date/time indexes skip unrelated files; quiet capture avoids unchanged checkpoint writes. Selected-date disk size covers encrypted original batches; shared derived SQLite/statistical indexes are excluded.

Separate VODs are merged for highlights using an occurrence-time disk index. YouTube paid-message display amounts are retained as `replayDonationText`; they are not added to monetary totals without precise currency/numeric data. Automatic statistics/highlights are local computations, separate from external AI analysis.

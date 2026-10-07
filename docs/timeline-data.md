# Timeline data and analysis

[한국어](timeline-data.ko.md)

Connected CHZZK, YouTube and Twitch channels are checked for live broadcasts. With automatic recording enabled, any confirmed live broadcast starts a session; a session that has observed live sources ends only when every configured channel is confirmed offline. Request/authentication errors remain unknown. Manually stopping blocks restart of that same live broadcast until it ends or automatic recording is explicitly re-enabled.

The shared timeline uses the earliest platform start time available at detection. If no start time is available, detection time is used. Recording coverage starts when the desktop app begins collecting: missing earlier messages are not reconstructed. YouTube's initial available history is archived with a historical flag and excluded from voting and burst detection.

## Local archive

The main encrypted record file holds session metadata, markers, counts and an installation-specific secret for stable viewer keys. timeline-data/<session UUID>/ contains compressed DPAPI-encrypted batches and an encrypted statistical checkpoint. Each batch is written atomically. Recovery replays newer event sequences, including sequences appended to the checkpoint tail. The application retains raw records until explicit history deletion; exports remain user-managed.

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

One-second flushes atomically extend a same-day tail up to 256 events / 128 KiB rather than creating a tiny file per tick. Sequence cutoffs keep concurrent reads consistent and recover tail events after a checkpoint. New files use a binary encrypted envelope; legacy Base64 files remain readable. Date/time indexes skip unrelated files, unchanged summaries are cached, idle capture avoids rewriting checkpoints, and transcript read requests avoid rewriting broadcast metadata.

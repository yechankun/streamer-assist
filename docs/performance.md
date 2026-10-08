# Performance measurements

[한국어](performance.ko.md) · [Development](development.md)

## Additional processing optimizations — 2026-10-08

Compared with `84aa93f`, FIFO ring queues replace repeated oldest-entry searches in message ID and profile caches. Highlight cooldowns skip calculations and evidence arrays are created only for actual markers. Ranking retains only the required top entries, preserving tie order. Pending-event counters update on admission/acknowledgement, history scrolling reuses its ID set, and burst buffers shrink even while sparse chat continues.

These are medians of three alternating runs on Ryzen 7 3700X / Node.js 22.22.2, with identical synthetic result digests. The table measures **CPU processing without disk, SQLite, platform networking or renderer work**.

| Operation | Before | After |
| --- | ---: | ---: |
| 100,000 chats / 1,000 participants | 2,862ms | 937ms |
| 100,000 chats / distinct participants | 3,567ms | 1,055ms |
| 10,000 keywords and phrases / 100 rankings | 563ms | 31ms |

A regression fixture retaining 40 recent messages after a burst shrank the reaction buffer from 65,536 to 1,024 slots while preserving time-window counts, unique participants, reactions and subsequent growth. This is buffer capacity, not a whole-app RAM reduction.

Additional five-second production Electron tests include a visible renderer, polls, raffles and encrypted archives. The 20k/s request retained 100,000 chats; the 10k/s distinct-participant request retained 50,000 chats, exact participants and votes. Final pending work, retries and reported gaps were zero. Producers run below the requested rates. End-drain time varied across runs, so CPU speedups do not imply equivalent whole-pipeline speedups. A separate baseline run missing its renderer build was excluded. The benchmark now verifies the build and renderer readiness.

Reproduce with `node scripts/benchmark-processing.cjs --baseline-revision 84aa93f`. Local reports are `release/processing-performance.json`, `release/optimization-{before,after}-{live,distinct}.json` and the distinct-participant `-repeat.json` files. Results depend on hardware, disk, messages and participant diversity; they do not guarantee complete delivery by external platforms.

## Paced chat load — 2026-10-08

These finite synthetic runs use Ryzen 7 3700X, Electron 41.10.7, a separate JSON sender, the visible production renderer, active number voting and raffle collection, and Windows DPAPI-protected AES archives. External platform networking is excluded. The paced sender runs below its requested rate; the actual rate is reported. End-drain time is additional time after the last incoming batch.

| Mode / requested rate | Actual input | Received / archived | End drain | Loop p99 / max |
| --- | ---: | ---: | ---: | ---: |
| Live archive · 10k/s, every message a new participant, 10 s | 9,563/s | 100,000 / 100,000 | 2.16 s | 14.7 / 659.0 ms |
| Live archive · 20k/s, 1,000 participants, 30 s | 19,060/s | 600,000 / 600,000 | 4.84 s | 16.9 / 79.6 ms |
| Live raw archive / deferred analysis · 20k/s, 10 s | 19,077/s | 200,000 / 200,000 | 0.54 s | 43.0 / 102.0 ms |
| Live archive · 50k/s, 10 s | 47,036/s | 500,000 / 500,000 | **103.8 s** | 14.4 / 69.9 ms |
| Live features / later replay · 50k/s, 10 s | 47,035/s | 500,000 / **0 by design** | 0.011 s | 13.6 / 16.6 ms |

The replay-mode run preserves live voting/recruitment without raw chat writes. It is not an archive-delivery test. All raw-archive rows ended with zero pending packets/retries and zero counted capture gaps. Peak private commit was approximately 338–657 MiB across these workloads, not idle RAM; populations and histories change memory use. Exact 62,000-participant counting, source-ID redelivery after cache eviction, disk failure, writer restart before/after readiness, ended-session receipt recovery, and multi-VOD chronological highlights have separate regression tests.

The initial 50k/s overload run before ingress/spill fixes saved only 78,129 of 500,000 received messages and stalled the main loop for 15.46 s. After the fixes, accepted bursts are retained and dispatch yields, but the 103.8 s drain demonstrates that this disk workload **does not sustain 50k/s indefinitely**. Live gameplay can also lag behind a disk backlog. The later 20k/s run covers only 30 seconds, and the 10k/s distinct-viewer case still shows a 659 ms worst delay. No universal rate, bounded memory under unlimited load, or recovery of messages never delivered by a platform is promised. Power/process failures can lose the volatile interval before durable admission; persistent storage failure requires intervention.

Reports: `release/chat-load-live-10000-distinct.json`, `chat-load-live-20000-queued-30s.json`, `chat-load-deferred-20000.json`, `chat-load-live-50000-queued-fixed.json`, and `chat-load-replay-50000.json`. The 50k raw row uses the smaller receipt-drain batch measured at that time; subsequent bulk-drain changes are not silently substituted into that result. See [capture modes and platform limits](timeline-data.md).

## Idle and tray operation — 2026-10-08

The current comparison uses the production renderer, Electron 41.10.7 and its Node.js 24.18.0 on Windows x64 with 16 logical processors. Baseline: `5ba36f0`. Each phase has two seconds of warm-up and fifteen seconds of sampling. Both versions use new empty profiles, with no live channels, AI components, personal credentials or forced garbage collection. The AI phases open Settings → AI, then hide that window. Native tests and measurements run sequentially.

| State | CPU before → after | Private commit before → after |
| --- | ---: | ---: |
| Home visible | 0.141% → 0.188% | 227.9 → 220.0 MiB |
| Home minimized | 0.045% → 0.043% | 227.8 → 218.7 MiB |
| Home in tray | 0.038% → 0.036% | 228.5 → 214.9 MiB |
| AI settings visible | 0.199% → 0.131% | 229.2 → 228.2 MiB |
| AI settings in tray | 0.118% → 0.028% | 222.2 → 219.9 MiB |

CPU is the sum of application-process cumulative CPU-time deltas, normalized by logical processor count. Memory below is application-process private bytes in MiB. Resident working-set totals can count shared pages more than once. Short idle CPU samples fluctuate; foreground CPU in this run increased even though JavaScript work decreased. These figures are workload examples, not a guarantee for every PC or a measurement of connected broadcasts.

### Private commit versus resident RAM

The table reports **private commit**, not Windows Task Manager's private resident working set. Commit is the memory commitment backed by RAM or paging; private working set counts private pages currently in RAM. Shared resident pages are additional memory and must not be counted repeatedly as if each process had its own copy. See [Microsoft's memory metrics explanation](https://blogs.windows.com/msedgedev/2021/01/13/investigate-microsoft-edge-memory-usage/).

A separate empty-profile feasibility probe on 2026-10-08 measured **92.4 MiB private resident / 220.4 MiB private commit** in the app's hidden home screen. Destroying all its windows in an isolated experiment gave **71.8 MiB private resident / 191.3 MiB private commit**; the global shortcut remained registered. This is a feasibility experiment, **not shipped tray behavior or a verified restore workflow**. The production app still hides and retains its windows/drafts. Bare Electron without any window measured **45.2 MiB private resident / 103.7 MiB private commit** on this PC. These samples use no forced working-set trimming or garbage collection, no personal profile and no connected broadcast.

The idle benchmark now additionally reports `privateResidentMiB` from Windows process counters and per-process commit/working-set totals. The resident counter is a separate endpoint sample taken after CPU timing; it is not the mean value in the historical table. Unsupported/unavailable counters report `null`. A target below 100 MiB must specify which memory metric it means. Window disposal reduces renderer memory, but production tray suspension would also require tested restoration of all drafts, windows, dialogs and in-progress operations.

The previous version built fifteen engine snapshots per phase, including hidden/minimized phases, and performed ten AI-state reads in each AI phase. The new version performed neither operation during these empty-profile sample windows. Visible AI settings with an added provider still use a ten-second status fallback; tray windows have no such UI polling.

Initial renderer JavaScript decreased from **427.53 to 334.45 kB (21.8%)** and initial CSS from **128.76 to 79.42 kB (38.3%)**. Timeline/AI chunks remain included in the package and load on demand. This reduces startup work, rather than removing features or claiming the same reduction in installer size.

Background validation uses production collection callbacks and local network-transport fixtures: **2,001 chats + 10 donations**, duplicate rejection, exact archive order, a real Windows global marker shortcut, automatic vote deadlines, no hidden snapshots, and fresh state after show/restore. Collection, transport keepalives/reconnects and broadcast detection remain app-owned. Recording keeps its one-second flush; dirty metadata keeps a five-second save interval. Unit checks cover continuous-traffic flush timing and save retry backoff. AI/tray optimizations skip UI work and keep app-owned authentication/analysis jobs running.

## Build and archive measurements — 2026-10-06

Measured locally on Windows x64 on **2026-10-06**, using Node.js 22 and Electron 41.10.7. These are measured examples, not latency guarantees or CI runner benchmarks.

| Workload | Before | After | Scope |
| --- | ---: | ---: | --- |
| Fresh renderer build | 5.350 s | 3.343 s | Same npm command; fresh type-check state. |
| Unchanged renderer build | 5.350 s | 0.436 s | npm startup plus source/output hash validation. |
| EXE + MSIX packaging | 48.663 s | 31.538 s | Renderer build excluded; prepared payload compressed concurrently. |
| Eight desktop suites at measurement time | 62.450 s | 41.657 s | Renderer build excluded; assertions retained. |
| Unit checks | — | 0.893 s | 126 checks, including cache invalidation guards. |

These figures retain the code and workload measured on that date. The current `npm run test:desktop` includes sixteen suites covering AI, tab/window layouts, common collection, text size and tray operation, and unit coverage has also grown. The timings, 126-test count and package sizes above do not measure the current build. Use the commands below to generate fresh timing reports.

The final EXE was **89,391,057 bytes** and MSIX **135,846,017 bytes**. Parallel compression retained the original compression settings and package contents; results were not produced by disabling validation or making uncompressed installers.

## Synthetic archive

24,000 messages over 24 days: encrypted fixture files decreased from **741,456 to 566,024 bytes (23.7%)**. A first-day query read **91 chunks before / 1 after**; median of five queries was **80.81 ms / 0.90 ms**.

A low-volume fixture performed 120 one-second flushes: **120 files / 46,268 bytes → 1 file / 2,032 bytes**. The writer still flushes every second and atomically extends a bounded same-day tail.

This fixture uses AES-GCM instead of Windows DPAPI. Actual encryption, storage latency, traffic patterns, directory size and operating-system caching change timings and size benefits. No personal profile or live chat was benchmarked.

## Reproduce

- `npm run benchmark:timeline` creates temporary synthetic data and removes it afterward. A clean checkout reports current results; historical comparison requires the locally retained baseline code.
- `npm run benchmark:idle` builds checked output and measures a temporary empty profile. `node scripts/benchmark-idle.cjs --sample-ms 15000 --output release/idle-performance-optimized.json` reproduces the sample duration above. `--root <baseline-checkout>` measures a separately built baseline using the same probe. Reports include per-process aggregate CPU/private memory, renderer heap/script time, snapshot builds and IPC counts; they exclude the developer profile. Local comparison reports are `release/idle-performance-baseline.json` and `release/idle-performance-optimized.json`.
- `npm run build` writes `release/renderer-build-timings.json`. Use `node scripts/build.cjs --force` for a new bundle; deleting only `.build-cache/typescript.tsbuildinfo` resets incremental type state.
- `npm run test:desktop` writes per-suite timings to `release/desktop-test-results.json`. Focused runs have a separate report.
- `npm run dist:all` writes `release/build-timings.json`. Overlapping phase durations do not sum to total wall time.
- Local comparison reports are `release/build-performance-report.json` and `release/test-performance-report.json`. Generated outputs are ignored by Git.

Cache tests verify timestamp-preserving edits, output mutation/deletion, environment/import changes and new native dependencies. A real intentional TypeScript error was also checked: publication failed, the prior checked output remained, and packaging rejected stale source.

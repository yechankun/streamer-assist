# Performance measurements

[한국어](performance.ko.md) · [Development](development.md)

## Idle and tray operation — 2026-10-08

The current comparison uses the production renderer, Electron 41.10.7 and its Node.js 24.18.0 on Windows x64 with 16 logical processors. Baseline: `5ba36f0`. Each phase has two seconds of warm-up and fifteen seconds of sampling. Both versions use new empty profiles, with no live channels, AI components, personal credentials or forced garbage collection. The AI phases open Settings → AI, then hide that window. Native tests and measurements run sequentially.

| State | CPU before → after | Private memory before → after |
| --- | ---: | ---: |
| Home visible | 0.141% → 0.188% | 227.9 → 220.0 MiB |
| Home minimized | 0.045% → 0.043% | 227.8 → 218.7 MiB |
| Home in tray | 0.038% → 0.036% | 228.5 → 214.9 MiB |
| AI settings visible | 0.199% → 0.131% | 229.2 → 228.2 MiB |
| AI settings in tray | 0.118% → 0.028% | 222.2 → 219.9 MiB |

CPU is the sum of application-process cumulative CPU-time deltas, normalized by logical processor count. Memory below is application-process private bytes in MiB. Resident working-set totals can count shared pages more than once. Short idle CPU samples fluctuate; foreground CPU in this run increased even though JavaScript work decreased. These figures are workload examples, not a guarantee for every PC or a measurement of connected broadcasts.

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

These figures retain the code and workload measured on that date. The current `npm run test:desktop` includes fifteen suites covering AI, tab/window layouts, common collection, text size and tray operation, and unit coverage has also grown. The timings, 126-test count and package sizes above do not measure the current build. Use the commands below to generate fresh timing reports.

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

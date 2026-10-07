# Performance measurements

[한국어](performance.ko.md) · [Development](development.md)

Measured locally on Windows x64 on **2026-10-06**, using Node.js 22 and Electron 41.10.7. These are measured examples, not latency guarantees or CI runner benchmarks.

| Workload | Before | After | Scope |
| --- | ---: | ---: | --- |
| Fresh renderer build | 5.350 s | 3.343 s | Same npm command; fresh type-check state. |
| Unchanged renderer build | 5.350 s | 0.436 s | npm startup plus source/output hash validation. |
| EXE + MSIX packaging | 48.663 s | 31.538 s | Renderer build excluded; prepared payload compressed concurrently. |
| Eight desktop suites at measurement time | 62.450 s | 41.657 s | Renderer build excluded; assertions retained. |
| Unit checks | — | 0.893 s | 126 checks, including cache invalidation guards. |

These figures retain the code and workload measured on that date. The current `npm run test:desktop` includes fourteen suites covering AI, tab/window layouts, common collection and text size, and unit coverage has also grown. The timings, 126-test count and package sizes above do not measure the current build. Use the commands below to generate fresh timing reports.

The final EXE was **89,391,057 bytes** and MSIX **135,846,017 bytes**. Parallel compression retained the original compression settings and package contents; results were not produced by disabling validation or making uncompressed installers.

## Synthetic archive

24,000 messages over 24 days: encrypted fixture files decreased from **741,456 to 566,024 bytes (23.7%)**. A first-day query read **91 chunks before / 1 after**; median of five queries was **80.81 ms / 0.90 ms**.

A low-volume fixture performed 120 one-second flushes: **120 files / 46,268 bytes → 1 file / 2,032 bytes**. The writer still flushes every second and atomically extends a bounded same-day tail.

This fixture uses AES-GCM instead of Windows DPAPI. Actual encryption, storage latency, traffic patterns, directory size and operating-system caching change timings and size benefits. No personal profile or live chat was benchmarked.

## Reproduce

- `npm run benchmark:timeline` creates temporary synthetic data and removes it afterward. A clean checkout reports current results; historical comparison requires the locally retained baseline code.
- `npm run build` writes `release/renderer-build-timings.json`. Use `node scripts/build.cjs --force` for a new bundle; deleting only `.build-cache/typescript.tsbuildinfo` resets incremental type state.
- `npm run test:desktop` writes per-suite timings to `release/desktop-test-results.json`. Focused runs have a separate report.
- `npm run dist:all` writes `release/build-timings.json`. Overlapping phase durations do not sum to total wall time.
- Local comparison reports are `release/build-performance-report.json` and `release/test-performance-report.json`. Generated outputs are ignored by Git.

Cache tests verify timestamp-preserving edits, output mutation/deletion, environment/import changes and new native dependencies. A real intentional TypeScript error was also checked: publication failed, the prior checked output remained, and packaging rejected stale source.

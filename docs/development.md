# Development

**English** · [한국어](development.ko.md) · [Back to README](../README.md)

## Run without installing

Use Windows 10/11 x64 and Node.js 22+.

```powershell
npm ci
npm run dev
```

`./dev.ps1` also prepares dependencies and launches the development app on Windows.

| Change / action                              | Behavior                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| Save React or CSS in `src/`                  | Vite updates the open window immediately; compatible edits preserve React state.  |
| Save Electron code in `electron/`            | The app saves recording state and restarts, reconnecting saved channels/accounts. |
| Press F12 / `npm run dev:tools`              | Toggle DevTools / open them from launch.                                          |
| Ctrl+C / `npm run dev:stop` / full tray exit | Stop Electron and the development server together.                                |

The development server binds to `http://127.0.0.1:5173`. Its profile is `.dev/profile/`, excluded from Git and separate from installed-app data. Development does not modify Windows startup. The default marker shortcut is `Ctrl+Alt+F8`; a saved custom shortcut takes precedence. The installed default is `Ctrl+Shift+F8`.

Closing the window follows the tray preference; it may hide instead of exiting.

## YouTube OAuth

This is **developer configuration once per application**, not a user token entry workflow. CHZZK public chat needs only a channel URL.

1. Enable YouTube Data API v3 in the Google Cloud project and configure the OAuth consent screen.
2. Create a **Desktop app** OAuth client. Add intended accounts as test users while the consent screen is in testing.
3. Copy `.env.example` to `.env.local` and set `STREAMER_ASSIST_GOOGLE_CLIENT_ID` and `STREAMER_ASSIST_GOOGLE_CLIENT_SECRET`.
4. Save the file. Development reads the local configuration and enables browser login.

The consent screen needs the appropriate publishing/verification preparation for public distribution. The app requests `youtube.force-ssl`, uses PKCE, and briefly opens a loopback callback on this PC. No hosted authentication backend is needed.

A Desktop client's bundled secret **cannot remain confidential in an installed app**. It is app configuration, separate from user access/refresh tokens. Users authorize their own account in the browser; those tokens stay encrypted in their local profile and are not exposed to the renderer or exports.

For packaging, provide app configuration through `GOOGLE_DESKTOP_CLIENT_ID` / `GOOGLE_DESKTOP_CLIENT_SECRET` environment variables. The packager writes a dedicated OAuth resource. It does not copy `.env.local` or personal profiles.

The release workflow receives the app configuration from Actions Variables/Secrets. General push/PR CI does not receive the app secret, so its preview artifacts may not support YouTube login. See [Store setup](store-setup.en.md) for deployment configuration. Actual account login and broadcast participation require separate live validation.

## Twitch OAuth

Register a dedicated application in the [Twitch developer console](https://dev.twitch.tv/console/apps) with **Client Type: Public**. Registration requires a verified developer account with 2FA. If the registration form requires a redirect URL, use `http://localhost`; this app's Device Code flow does not use a callback server.

Set `STREAMER_ASSIST_TWITCH_CLIENT_ID` in `.env.local` for development. For packaging, provide `TWITCH_CLIENT_ID` (also an Actions Variable in the release workflow), or set `twitchClientId` in `electron/oauth-config.json`. The Client ID is public app configuration. No Client Secret or manual user token entry is needed. The login button remains disabled until configuration is present.

The app opens Twitch's device activation page in the default browser and shows the approval code in Settings. It requests only `user:read:chat`, validates the client, user and scope before accepting tokens, and stores tokens in the existing encrypted vault. Public-client refresh tokens rotate after use; the replacement is saved before subsequent validation. Token validation runs at startup and at least every 50 minutes while collecting chat.

Chat uses EventSub WebSockets for the authenticated user's own channel. Shared-chat messages originating in other channels are excluded. Stream status uses Get Streams plus `stream.online`/`stream.offline` subscriptions; the header shows only live platform icons. This version supports chat highlights, subscriber/founder raffles and number votes, including a mix with YouTube native polls. Twitch native polls and Bits donation voting are not implemented. Live OAuth and channel reception still require validation with a registered app and real broadcaster account.

References: [Device Code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow), [EventSub WebSockets](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/).

## Build and test commands

| Command | Behavior |
| --- | --- |
| `npm run dev` / `npm run dev:tools` | Hot-reload Electron window; optional DevTools. |
| `npm run build` | Reuse verified output or run incremental type checking and Vite in parallel. |
| `node scripts/build.cjs --force` | Force a new renderer bundle. |
| `npm test` | All core logic and build-cache safety tests. |
| `npm run test:desktop` | Checked build and all eight isolated Electron suites. |
| `node scripts/test-desktop.cjs --build --suite timeline` | Build and check only the timeline feature. |
| `node scripts/test-desktop.cjs --build --suite presentation,audience` | Focused broadcast and participation checks. |
| `node scripts/test-desktop.cjs --build --screenshots` | All desktop checks with successful PNG capture enabled. |
| `npm run dist:all` | Windows x64 EXE and Store MSIX from the same payload. |
| `npm run dist` / `npm run dist:msix` | Build one package format. |
| `npm run verify:msix` | Manifest, code/assets, locale and private-file checks. |
| `npm run docs` / `npm run docs:check` | Generate bilingual privacy pages / validate local documentation links. |
| `npm run docs:screenshots` | Native 1280 × 800 product captures with synthetic archive data. |
| `npm run docs:screenshots:store` | Native 1600 × 900 Store captures. |
| `npm run benchmark:timeline` | Temporary synthetic archive size/query benchmark. |

The available desktop suites are `icon,desktop,timeline,presentation,audience,twitch,privacy,lifecycle`. Without `--build`, a focused check uses the existing `dist/`. CI builds once and uses `test:desktop:built` then `dist:all:built`.

## Checked builds and resources

`.build-cache/` and `dist/` are generated, ignored outputs. Source/configuration, imported JSON, lockfiles, build environment and output content must match before a successful type check/bundle is reused. Both compiler jobs must succeed before publishing files, with `index.html` replaced last. Source changes during compilation, missing/tampered output and type errors invalidate reuse. Package generation requires a current checked renderer.

Short UI transitions use 4x playback in isolated test renderers. Demo callbacks run at the required test step; roulette motion, selection and deadline checks retain their real behavior. Assertions/layout checks run normally; successful PNG generation is opt-in. Focus/shortcut-sensitive suites stay sequential, and temporary profiles are removed after Electron exits.

React/React DOM are Vite build dependencies, with production code embedded in the renderer rather than duplicated in the desktop runtime. Electron keeps Korean/en-US locale packs, codecs, accessibility, software rendering and licenses. Pure JavaScript runtime dependencies skip native rebuilds; native modules added later keep the Electron rebuild automatically. Asset reuse checks both generator and output hashes.

NSIS and MakeAppx compression share a prepared/signed payload; unsupported builder-helper APIs fall back to sequential packaging. MSIX reads a direct source mapping with semantic validation and compression enabled. Only the current invocation’s validated scratch folder is removed. OAuth configuration and installers are rebuilt, not cached. CI caches public tool downloads, verified renderer output and type-check state by source/Node version.

See [measured performance](performance.md), including limits on synthetic encryption timings and CI comparisons.

## Architecture

| Area | Responsibility |
| --- | --- |
| `src/main.tsx` / `src/audience.tsx` | App shell, platform settings and audience tools. |
| `src/timeline.tsx` / `src/history.tsx` | Graphs, analysis, all-date browsing and day/week/month selection. |
| `src/presentation.tsx` / `src/roulette.tsx` | Animated broadcast results and weighted wheel. |
| `electron/engine.cjs` / `electron/audience.cjs` | Recording, markers, voting, recruitment and restoration. |
| `electron/broadcast-monitor.cjs` | Any-live start, confirmed-all-offline stop and viewer samples. |
| `electron/timeline-store.cjs` / `electron/timeline-history.cjs` | Encrypted archives, indexes, bounded queries and resumable deletion. |
| `electron/chat-analysis.cjs` / `electron/timeline-export.cjs` | Local statistics, participant keys and pseudonymous JSONL. |
| `electron/platforms.cjs` / `electron/chzzk.cjs` / `electron/twitch.cjs` | Provider transports and native YouTube polls. |
| `electron/oauth.cjs` / `electron/twitch-auth.cjs` | Browser authorization, encrypted token storage and refresh. |
| `electron/main.cjs` / `electron/preload.cjs` | Window/tray/shortcuts and the restricted IPC bridge. |
| `scripts/` / `tests/` | Checked builds, packaging, capture, documentation and regression checks. |

## CI/CD and release state

Push/PR CI checks logic, desktop behavior, both package formats and installed MSIX behavior on a **disposable GitHub-hosted runner**. Temporary test certificates/signed test copies are not distributed. A version-matching `v*` tag publishes installers and SHA256 checksums; a manual Windows Release run produces artifacts without a public release or Store submission.

Store updates require initial publication plus API access and `STORE_PUBLISH_ENABLED=true`. Microsoft review determines publication. See [Store setup](store-setup.en.md) for registration, credentials and first-draft handling. No live-platform validation is inferred from mock tests or CI certification checks. In-app automatic updates are not implemented.

Update `package.json` and `package-lock.json` together for an app release. Documentation-only edits do not need a release tag or installer rebuild. `resources/privacy.json` is the in-app Korean policy and `resources/privacy.en.json` its public English translation; run `npm run docs` after editing either.

## Documentation and captures

Keep [English](../README.md) / [Korean](../README.ko.md) descriptions and guide translations synchronized. Follow the [capture guide](assets/screenshots/README.md): actual rendering, synthetic data, isolated temporary profiles and reviewed images. Do not include account tokens, private transcripts or personal profile files.

Official references: [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [YouTube live chat](https://developers.google.com/youtube/v3/live/docs/liveChatMessages), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [MakeAppx mapping files](https://learn.microsoft.com/en-us/windows/msix/package/create-app-package-with-makeappx-tool#mapping-files).

## AI adapters and runtime components

The renderer calls the restricted assist bridge. ai-service owns jobs, cancellation, encrypted keys/results and provider settings; ai-context builds bounded pseudonymous context; ai-api handles bounded HTTP/SSE transport; ai-components verifies and manages separately released GitHub connector modules; ai-runtime manages verified on-demand binaries; ai-quota hosts read-only limit protocols; ai-usage validates tokens and estimates fees. Provider request builders, event mappings, model discovery recipes, price rows and CLI download metadata live in the independent [AI Connectors repository](https://github.com/yechankun/streamer-assist-ai-connectors), outside installers. Its CI publishes API-verified receipts to a fixed repository branch; the desktop uses that publisher-authority HTTPS index and hashes every downloaded package, avoiding anonymous per-provider REST calls. Device-protected receipt caches retain the same checks. Model rows exposed to the UI come only from CLI/API queries; imported metadata does not add selectable models by itself. Provider compatibility changes require a connector module update, while host ABI changes require an app update.

Tests use mock HTTP streams, subprocesses and synthetic encrypted archives. CI prepares verified adapters once with node scripts/fetch-ai-test-components.cjs; tests reuse the ignored cache. A sibling connector checkout can supply local test-only fixtures. The ai desktop suite verifies the real bridge, key redaction, scoped analysis, token/cost display and minimum-size layouts; ai-component checks module install/update/rollback/removal. Neither sends paid prompts nor installs a real CLI. Run targeted suites with node scripts/test-desktop.cjs --suite ai,ai-component; unit tests are part of npm test. Development startup checks backend imports and syntax in a quiet Node process before launching or replacing Electron. See [AI connections](ai-integrations.md).

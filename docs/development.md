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

## Commands

| Command                    | Purpose                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run build`            | TypeScript checks and Vite build.                                                               |
| `npm test`                 | Core logic tests with isolated data and mock platform responses.                                |
| `npm run test:desktop`     | Build and isolated Electron checks covering presentation, participation, privacy and lifecycle. |
| `npm run dist`             | Windows x64 NSIS EXE installer.                                                                 |
| `npm run dist:msix`        | Windows x64 Microsoft Store MSIX package.                                                       |
| `npm run dist:all`         | Both Windows packages.                                                                          |
| `npm run verify:msix`      | Inspect manifest, packaged resources and private-file exclusion.                                |
| `npm run docs`             | Generate public privacy pages from bundled policy resources.                                    |
| `npm run docs:screenshots` | Build and capture the real app with an isolated profile and generated samples.                  |

Build output is in `release/` and is ignored by Git. Electron's runtime is included, so installers are larger than a native utility. There is no external database or AI runtime to operate.

## Architecture

| Area                                                | Responsibility                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `src/main.tsx`                                      | App shell, timeline, number vote, connections and general settings. |
| `src/audience.tsx`                                  | Broadcast workspace, viewer raffle and donation vote screens.       |
| `src/presentation.tsx` / `src/roulette.tsx`         | Broadcast results, animated numbers and SVG roulette.               |
| `src/privacy.tsx`                                   | Privacy and local-data controls.                                    |
| `electron/engine.cjs`                               | Timeline, reaction detection, number vote aggregation and export.   |
| `electron/audience.cjs`                             | Recruitment, raffle, donation voting, timers and restoration.       |
| `electron/roulette.cjs` / `electron/vote-input.cjs` | Secure weighted draw and vote command validation.                   |
| `electron/platforms.cjs` / `electron/chzzk.cjs`     | Official YouTube API and read-only CHZZK chat collection.           |
| `electron/oauth.cjs`                                | Browser OAuth, PKCE, encrypted credentials and refresh.             |
| `electron/main.cjs` / `electron/preload.cjs`        | Tray, global shortcuts, encrypted records and constrained IPC.      |
| `electron/preferences.cjs`                          | Saved preferences and shortcut conflict/recovery handling.          |
| `scripts/` / `tests/`                               | Development supervisor, packaging, documentation and verification.  |

The renderer uses the limited preload bridge; platform credentials stay in Electron main. Collection/timers continue when a tray-enabled window is hidden.

## CI and releases

- `main` pushes and pull requests run Windows tests, build EXE/MSIX, verify package content, and install/run a test-signed MSIX on a **disposable GitHub-hosted runner**. The temporary signing certificate and signed smoke-test copy are not published.
- A tag matching the app version (`v0.1.1` for `0.1.1`) runs the same checks and publishes EXE, MSIX and SHA256 checksums.
- **Windows Release → Run workflow** produces a first-submission artifact using configured app identifiers/OAuth. This manual run does not create a GitHub release or submit to the Store.
- Once initial Store publication and API credentials are ready, `STORE_PUBLISH_ENABLED=true` enables tagged-release Store submissions. Publication follows Microsoft review.
- Privacy page changes deploy through GitHub Pages.

For a new release, update `package.json` and `package-lock.json` together, commit, then push the matching tag. Do not tag documentation-only changes as an application release. In-app automatic updates are not implemented.

## Screenshots and documentation

The product READMEs are [English](../README.md) and [Korean](../README.ko.md). Update both when changing user-visible behavior.

[Capture instructions](assets/screenshots/README.md) explain how to refresh the gallery. Captures use actual app rendering, generated data, no personal account and no real donation. Review each image before copying it to tracked assets.

## Official references

- [Google OAuth for installed apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [YouTube live chat messages and polls](https://developers.google.com/youtube/v3/live/docs/liveChatMessages)
- [Electron global shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

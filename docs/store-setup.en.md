# Microsoft Store deployment

**English** · [한국어](store-setup.md) · [Back to README](../README.md)

## Automated workflow

- Main pushes/PRs: core tests and actual Electron checks → EXE/MSIX build → content/private-file validation → MSIX installation/runtime checks on a disposable GitHub runner → artifacts.
- A `v*` tag matching `package.json`: the same checks, followed by EXE/MSIX/SHA256 publication to GitHub Releases.
- When Store submission is enabled: Microsoft Store CLI submits the MSIX update. Publication follows Microsoft review.
- Public privacy pages deploy from main through GitHub Pages.

Development does not install MSIX or test certificates on your PC. Run `npm run dev`; package installation tests run only on disposable GitHub-hosted runners.

## Verify the saved credentials

Run **GitHub Actions → Store Access Check → Run workflow**. On a disposable runner, the official Store CLI authenticates and reads only the target app, checking its product ID, package identity and publisher. It does not create, modify or publish a submission.

The `store-access-report` artifact contains only authentication/identity results and whether an existing published submission was found. Secrets, tokens and raw private responses are withheld. Seller ID must be the numeric account identifier, rather than the product ID or CN string.

A successful login does not replace the first Store publication. Complete that first, then set `STORE_PUBLISH_ENABLED=true`. Tagged submission jobs perform the same read check immediately before publishing an update.

## Manage the first submission draft

The manual **Store Submission** workflow supports inspect (read the draft), prepare (apply listings, images and a validated MSIX), and submit (commit that draft). The create action requests an API draft without deleting an existing submission.

Use recreate-submit only after approving replacement of an empty first draft. It checks that no published submission exists and the PendingCommit draft has no listings, packages, review notes or trailers. It exports only public category, Free pricing, visibility, publishing mode and boolean declarations to a backup artifact before deleting that draft, then uploads/commits the prepared content to its replacement. Existing pricing, visibility and declarations are preserved.

Microsoft may reject API deletion of a draft created in Partner Center. In that case, remove only the in-progress submission in the portal, keep the app registration, and run create-submit without creating another portal draft. Set settings_backup_run_id to the Store Submission run containing the original public settings backup. The new draft is created, updated and committed through the API.

If execution stops after API draft creation, use resume-submit to restore the original public settings and finish upload/commit on the existing draft. It does not create or delete a submission.

Backups are retained for 90 days and exclude credentials, upload URLs, account information, raw private responses and age questionnaire data. Age questionnaire answers unavailable through the API are neither generated nor changed.

## First-submission package

Open **GitHub Actions → Windows Release → Run workflow** to build a package using the configured Store identity and deployment OAuth application settings. This manual run creates artifacts only: it does not publish a GitHub release or submit to the Store.

Use the artifact for the first Store submission. Subsequent tagged releases support the automated update flow.

## Initial registration

Register at [Microsoft Store developer](https://storedeveloper.microsoft.com), reserve the app name, and select an MSIX application. Prepare the first submission's description, age rating, screenshots, privacy link and review notes. API-based updates follow the initial publication. CI cannot perform account registration, identity verification or name reservation for you.

Privacy URL: [Streamer Assist privacy policy](https://yechankun.github.io/streamer-assist/privacy.html).

Use [certification.md](certification.md) (Korean) as the review walkthrough. Any required account testing details belong in private Partner Center review notes, never in the public repository.

## Actions Variables

| Name                          | Value                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `MSIX_IDENTITY_NAME`          | Full Package/Identity/Name from Partner Center → Product management → Product identity. |
| `MSIX_PUBLISHER`              | Full Package/Identity/Publisher string from the same screen (`CN=…`).                   |
| `MSIX_PUBLISHER_DISPLAY_NAME` | Your registered publisher display name.                                                 |
| `MSSTORE_PRODUCT_ID`          | Reserved Store product ID (`9…`).                                                       |
| `GOOGLE_DESKTOP_CLIENT_ID`    | Google Desktop OAuth app ID; the repository's public ID is used if omitted.             |
| `STORE_PUBLISH_ENABLED`       | Set to `true` after initial publication and API authentication are ready.               |

Partial MSIX identity configuration fails the build. With no identity values, a `StreamerAssist.Development` package is generated and marked as not Store-ready.

## Actions Secrets

| Name                           | Value                                             |
| ------------------------------ | ------------------------------------------------- |
| `MSSTORE_TENANT_ID`            | Microsoft Entra tenant ID.                        |
| `MSSTORE_CLIENT_ID`            | Application ID linked to Partner Center.          |
| `MSSTORE_CLIENT_SECRET`        | That application's credential.                    |
| `MSSTORE_SELLER_ID`            | Partner Center seller/publisher identifier.       |
| `GOOGLE_DESKTOP_CLIENT_SECRET` | Installed Google OAuth application configuration. |

The Store submission application needs the target Partner Center account's Manager role and API access. Store credentials in GitHub Secrets, not chat, source or screenshots. CI does not invoke CLI commands that print authentication information.

Google Desktop clients cannot keep bundled secrets confidential. Only the application Client ID/Secret is packaged in a dedicated resource; personal access/refresh tokens, development profiles and `.env.local` are excluded. Prepare public OAuth consent and required verification as well.

## Versioning and local packaging

Use `npm run dist:msix` for MSIX or `npm run dist:all` for both packages. `npm run verify:msix` inspects the manifest, code, resources and private-file exclusion.

Store packages require a nonzero first version field and a final field of zero. The packager maps app `major.minor.patch` to `(major + 1).minor.patch.0`: app `0.1.0` → MSIX `1.1.0.0`; app `1.0.0` → MSIX `2.0.0.0`. CI run numbers are not appended.

Copy `store.config.example.json` to `.store.local.json` for local identity configuration; the latter is ignored by Git. Local packaging does not automatically copy the secret from `.env.local`. Supply `GOOGLE_DESKTOP_CLIENT_ID` / `GOOGLE_DESKTOP_CLIENT_SECRET` through the packaging environment.

Unsigned MSIX is for Store upload. Direct installation needs a trusted signature; CI's temporary signature is not distributed. Store signing does not sign the separate GitHub EXE.

The manifest declares only the required desktop/network capabilities and a default-disabled startup task. In MSIX, the app opens Windows Startup Apps settings for the user to manage startup.

## Certification

CI validates packages and performs an actual MSIX installation/runtime check. Run Windows App Certification Kit (WACK) and validate real YouTube/CHZZK connections, broadcast reception and participation in a separate Windows test environment before submission.

These checks do not claim a WACK pass or Microsoft approval. Address any review findings and submit a new version.

Official references: [Store CI/CD](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/github-actions), [MSIX version requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/package-version-numbering?pivots=store-installer-msix), [Certification process](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process).

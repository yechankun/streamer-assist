# Microsoft Store deployment

**English** · [한국어](store-setup.md) · [Back to README](../README.md)

The [first submission inputs](store-portal.en.html) collect Pricing, Properties, product declarations, age-rating verification, the package, both localized listings, screenshots and Submission options in one place. URLs, listing text, the runFullTrust reason and certification notes have copy buttons. `npm run docs` regenerates this page from the current app version and source materials, and main's documentation deployment publishes it. Prepared inputs do not prove that Partner Center saved them.

## Automated workflow

- Main pushes/PRs: core tests and actual Electron checks → EXE/MSIX build → content/private-file validation → MSIX installation/runtime checks on a disposable GitHub runner → artifacts.
- Successful main CI: publish a new package.json version from that exact verified commit, including EXE/MSIX, checksums and package metadata, and create its version tag automatically. Existing releases are preserved. Direct version tags must still match package.json.
- When Store submission is enabled: Microsoft Store CLI submits the MSIX update. Publication follows Microsoft review.
- Public privacy pages deploy from main through GitHub Pages.

Development does not install MSIX or test certificates on your PC. Run `npm run dev`; package installation tests run only on disposable GitHub-hosted runners.

## Verify the saved credentials

Run **GitHub Actions → Store Access Check → Run workflow**. On a disposable runner, the official Store CLI authenticates and reads only the target app, checking its product ID, package identity and publisher. It does not create, modify or publish a submission.

The `store-access-report` artifact contains only authentication/identity results and whether an existing published submission was found. Secrets, tokens and raw private responses are withheld. Seller ID must be the numeric account identifier, rather than the product ID or CN string.

`STORE_PUBLISH_ENABLED=true` enables the update job. Its first-publication guard prevents mutation while the initial submission is incomplete. Authentication, upload and commit acceptance do not confirm public availability.

## Manage the first submission draft

After the first publication, release Store jobs use `prepare-store-submission.ps1 -UpdatePublished -Commit` to submit the verified MSIX together with both localized listings, screenshots and review notes. They retain an editable draft or create an update draft when none exists. Pricing, visibility, ratings and declarations are preserved; submissions under review are not replaced. The previous app-authored walkthrough is replaced while appended publisher notes are retained.

### Automatic updates after a Portal first submission

Portal-only Properties URLs and restricted-capability explanations must be saved in Partner Center for the initial submission. Finish that submission in the Portal. This does not prevent future automation: after publication, the API creates an update draft copied from the last published submission. View pending API drafts without saving them in the Portal; if Portal-only fields require changes, finish that submission there. See [Microsoft's mixing restriction and published-copy behavior](https://learn.microsoft.com/en-us/windows/uwp/monetize/manage-app-submissions).

**Store Submission → inspect** reads both the published baseline and the pending draft. `livePublished` confirms the existing publication; `status` and `published` describe the selected submission. `updateState` reports the update path, differing field names and upload-URL presence. URL presence alone does not establish how a draft was created.

No draft means create an API update. Editable drafts are resumed; an already published or in-review target package is not submitted twice. Other submissions under review are preserved. Only the specific HTTP 409/internal `None` edit conflict can trigger recovery.

Release jobs and **update-prepare / update-submit** enable `-RecoverUnchangedDraft`. Recovery requires the entire draft to match a confirmed published baseline. Public settings are backed up and both references, statuses and contents are rechecked before one deletion/recreation attempt. Unique descriptions, packages, prices, notes or concurrent changes prevent deletion. Backups exclude credentials, upload URLs, raw private responses and age questionnaires.

If Microsoft rejects API deletion, the report returns `PortalActionRequired` with a next action. Review any draft-specific changes, then finish the draft in Partner Center or remove only the pending update draft there. Do not create a new Portal draft; run **update-submit** using a verified **Windows Release** `package_run_id` (`37837377769` for v0.4.0). This differs from first-submission `create-submit`/`resume-submit`; the published product is never a deletion target.

Use **create-prepare** to create and populate the initial API draft without committing certification. First delete the Portal-created draft and let automation create the replacement; recreating it in Partner Center can prevent API updates or deletion. The [submitted review summary](store-review-notes.txt) contains 2,583 characters and links the detailed walkthrough. The 4,000-character limit is checked before submission, including preserved user notes.

**Store Publication Status** checks actual status after release/submission workflows and every six hours. CommitStarted means the request was accepted, Certification means review is in progress, and only Published confirms public availability. Failed commit, certification or publication makes the status workflow fail and produces a sanitized report.

Uploaded descriptions, images and packages do not establish that all first-submission fields are complete. Review Pricing and availability, Properties/declarations, Age ratings, Packages and Store listings in Partner Center. InvalidState errors can require portal validation details unavailable through the API. Age-rating answers and product declarations are not invented. Editing an API draft in the portal can prevent further API updates and commits. See the [submission checklist](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission) and [API limitations](https://learn.microsoft.com/en-us/windows/uwp/monetize/manage-app-submissions).

If unsupported Properties or restricted-capability fields need to be saved in the current draft's Portal pages, finish the remaining work and certification submission for that same draft **in the Portal**. Upload the release MSIX and screenshot files linked from the inputs page if they still appear as PendingUpload, and verify the Portal validation results. Do not run API submit again after Portal edits or repeatedly delete the draft. Automatic API updates apply after the first version is confirmed Published.

The manual **Store Submission** workflow supports inspect (read the draft), prepare (apply listings, images and a validated MSIX), and submit (commit that draft). The create action requests an API draft without deleting an existing submission.

Use recreate-submit only after approving replacement of an empty first draft. It checks that no published submission exists and the PendingCommit draft has no listings, packages, review notes or trailers. It exports only public category, Free pricing, visibility, publishing mode and boolean declarations to a backup artifact before deleting that draft, then uploads/commits the prepared content to its replacement. Existing pricing, visibility and declarations are preserved.

Microsoft may reject API deletion of a draft created in Partner Center. In that case, remove only the in-progress submission in the portal, keep the app registration, and run create-submit without creating another portal draft. Set settings_backup_run_id to the Store Submission run containing the original public settings backup. The new draft is created, updated and committed through the API.

If execution stops after API draft creation, use resume-submit to restore the original public settings and finish upload/commit on the existing draft. It does not create or delete a submission.

Use retry-name-failure only for a first API draft in CommitFailed with a single unreserved display-name error. It verifies that listings, images, package and review notes match the prepared materials before replacing that draft and submitting the corrected package. Other errors or additional content block deletion.

Backups are retained for 90 days and exclude credentials, upload URLs, account information, raw private responses and age questionnaire data. Age questionnaire answers unavailable through the API are neither generated nor changed.

## First-submission package

Open **GitHub Actions → Windows Release → Run workflow** to build a package using the configured Store identity and deployment OAuth application settings. This manual run creates artifacts only: it does not publish a GitHub release or submit to the Store.

Use the artifact for the first Store submission. Subsequent tagged releases support the automated update flow.

## Initial registration

Prepared Properties values and the runFullTrust justification are in [store-portal-fields.json](store-portal-fields.json). Save the privacy policy, support contact and website on the Properties page, declare the optional generative AI features, and save the runFullTrust explanation in Submission options. The obsolete submission API fields privacyPolicy/supportContact/websiteUrl are ignored; automation no longer treats them as saved Properties.

Choose Utilities & tools as the primary category and leave the secondary category empty. Declare personal-information access because the app processes chat, nicknames and account information. Select generative AI; leave accessibility conformance, pen/ink, game DVR and immersive/VR options unselected. Declare accessibility only after separate assistive-technology verification. Additional hardware requirements are optional; do not invent untested RAM/GPU minimums. The prepared English runFullTrust explanation is **422 characters including spaces**, within the 500-character limit.

Manual Windows Release runs remain build-only unless `publish_release` is selected. First-submission package sources can also use the automatic release run as long as its `release` package verification job succeeded; a separate Store job failure does not invalidate that verified MSIX.

Register at [Microsoft Store developer](https://storedeveloper.microsoft.com), reserve the app name, and select an MSIX application. Prepare the first submission's description, age rating, screenshots, privacy link and review notes. API-based updates follow the initial publication. CI cannot perform account registration, identity verification or name reservation for you.

Privacy URL: [Streamer Assist privacy policy](https://yechankun.github.io/streamer-assist/privacy.html).

Use [certification.md](certification.md) (Korean) as the review walkthrough. Any required account testing details belong in private Partner Center review notes, never in the public repository.

## Actions Variables

| Name                          | Value                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `MSIX_DISPLAY_NAME`           | Exact app name reserved in Partner Center (package display name, separate from publisher name). |
| `MSIX_IDENTITY_NAME`          | Full Package/Identity/Name from Partner Center → Product management → Product identity.         |
| `MSIX_PUBLISHER`              | Full Package/Identity/Publisher string from the same screen (`CN=…`).                           |
| `MSIX_PUBLISHER_DISPLAY_NAME` | Your registered publisher display name.                                                         |
| `MSSTORE_PRODUCT_ID`          | Reserved Store product ID (`9…`).                                                               |
| `GOOGLE_DESKTOP_CLIENT_ID`    | Google Desktop OAuth app ID; the repository's public ID is used if omitted.                     |
| `STORE_PUBLISH_ENABLED`       | `true` enables automatic updates. Actual submission requires completed initial publication.    |

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

# AI connections and chat analysis

[한국어](ai-integrations.ko.md)

Select **+** in Settings → **AI 연결** and choose an AI. Only added providers appear in the list and settings panel; their required connector is downloaded automatically. Then choose **CLI/API**. In Timeline → **AI 분석**, select a broadcast, platform, dates and elapsed-time range, then enter a request. Highlight, question, reaction and donation prompts are optional examples. Analysis starts only when you select Run.

## Providers

| Provider | CLI | API |
| --- | --- | --- |
| OpenAI | [Codex](https://developers.openai.com/codex/noninteractive), existing CLI/ChatGPT login | Responses |
| Anthropic | [Claude Code](https://code.claude.com/docs/en/headless) | Messages |
| xAI | [Grok Build](https://docs.x.ai/build/cli/headless-scripting) | Chat Completions |
| Google | [Antigravity CLI](https://antigravity.google/docs/cli/headless/) | Gemini API, a separate service |
| DeepSeek | [Official Codex integration](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/), using a DeepSeek API key | Chat Completions |
| Moonshot | [Kimi Code CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html) | Kimi/Moonshot Chat Completions |

CLI subscriptions and API credentials have separate entitlements and billing. Models cannot be typed manually. Select only models retrieved from the CLI’s model-list command/control protocol or the API’s model list. Save both model and reasoning effort in Settings → AI connections; analysis uses those saved settings. Only supported reasoning choices are shown. Selecting the service default omits an explicit override. An incompatible CLI/model fails with a visible explanation.

## Components and updates

Detect an existing CLI or download into the app profile’s ai/components/ directory. App-managed components can be updated, rolled back, or removed. External CLI installations are preserved.

**Login** opens an account connection dialog in the app. Codex and Claude use their official login and authentication-status commands; Grok and Kimi use the completion result of their dedicated official login commands. The dialog shows waiting, success and failure states, supports cancellation, and displays a one-time code when the CLI provides one. Antigravity uses its official interactive CLI window; select **로그인 후 모델 조회** after authentication to check the connection. Opening or closing a terminal alone is never reported as authentication success.

DeepSeek's CLI bridge and each provider's API use **API 키 연결 / API 연결 창 열기** to open the official console, save an encrypted key, and verify access by retrieving actual available models. This does not submit an analysis request. The app does not collect account passwords or return CLI OAuth tokens to the renderer. Older connectors without authentication recipes display an update instruction.

![AI account connection dialog](assets/screenshots/ai-login.png)

Native Electron capture from an isolated test profile. The authentication result uses a simulated CLI response; no real account is signed in.

Binaries are excluded from installers and ASAR. Downloads use official release metadata, SHA-256/SHA-512 checksums, and staged publication. Failed or canceled updates preserve the previous active version. API drivers use the shared built-in HTTP engine; provider SDKs are unnecessary. Connections can be disabled, and user-added providers removed.

The provider list’s **+** button imports JSON endpoint and compatibility metadata. Compatible APIs use the protocol implementation of an installed connector module, including HTTPS and localhost endpoints. Executable connector modules come only from the fixed, verified GitHub source described below.

```json
{
  "schemaVersion": 1,
  "id": "custom-local-model",
  "name": "Local model",
  "protocol": "chat",
  "baseUrl": "http://127.0.0.1:1234/v1",
  "models": []
}
```

Model effort metadata can be updated using a type: model-capabilities profile. Metadata alone never adds selectable models; query the connected API for its model list. Changes to CLI flags or output parsing can be handled by a connector module update. Shared host ABI changes require an app update.

## Scope, privacy and results

The context builder counts the entire selected range and selects a deterministic sample across that range when the input budget is exceeded. Preview shows **included / total records**, bytes, an approximate token estimate, and sampling status. Actual token counts come from the provider response. A sample is never presented as complete original-text coverage.

Default data replaces public nicknames with pseudonyms and excludes public account IDs. Analytical speaker IDs, platforms, timestamps and original messages remain. Identifiers written into message text are not automatically removed. Public identities are opt-in. Viewer content is untrusted data, and generated output is displayed as plain text.

API keys and results use the Windows encrypted store. Saved keys are never returned to the renderer. Requests can be canceled; saved results can be selected and deleted. Results have bounded retention and are separate from the source archive. Providers and CLIs control their own retention and logs.

## Usage, limits and cost

CLI limits come only from official output or documented read-only protocols. Codex exposes session/weekly windows and reset times. Other CLIs expose limits when their official events provide them; otherwise the UI explains that the information is unavailable. API token usage is never converted into a subscription quota estimate.

Results show actual input, output, cache and reasoning tokens when supplied. Missing counts remain unavailable. API fees are **estimates** calculated from actual usage and verified model rates, unless the provider returns an actual charge. Cached/reasoning tokens already included in other counts are not counted twice. Missing pricing is never shown as zero cost. Taxes, exchange rates, discounts and final invoices may differ.

Rates can be updated from official model metadata or imported JSON pricing. Their source and effective/check date are retained. CLI account plans are shown separately from API billing.

See [timeline data](timeline-data.md) and the [development guide](development.md).

## Querying models

Detect/install and sign into the CLI, then select **모델 → 목록 조회**. Codex uses app-server model/list; Claude returns models in its initialization control response; Grok/Antigravity expose model-list commands; Kimi provides ACP session metadata. No model prompt or paid inference is started. A failed query never falls back to an invented default list.

For API connections, entering a key and querying saves it encrypted, then retrieves the provider model list. Choose the model and effort and select **연결 저장**. Analysis exposes the connection, request and record scope; model and effort are configured only in Settings.

## GitHub provider components

![AI connector module settings](assets/screenshots/ai-connectors.png)

Provider implementations are distributed separately in [streamer-assist-ai-connectors](https://github.com/yechankun/streamer-assist-ai-connectors). Each LLM has its own version and release tag, such as openai-v0.1.0 or anthropic-v0.1.0. The main installer contains the common host, encrypted settings/results, and download manager; provider adapter source and native CLI binaries are excluded.

Use **+** to add a provider and **×** beside its list entry to remove the connection and its settings panel. Its encrypted key and adapter remain available for re-adding. To free adapter files, use **연결 모듈 → 연결 모듈 제거**. That view also checks versions, updates, and restores the retained previous version. Existing CLI programs remain independently managed. Original CLI payloads come from vendor distribution sources; this repository distributes our own integration code.

Failed downloads show the operation phase and a public HTTP status or safe filesystem error code. Retry with **다운로드·추가** without removing the connection.

The app accepts artifacts only from the configured GitHub repository. Publishing CI compares GitHub API asset SHA-256 values with downloaded bytes, then publishes its verification records at the same repository’s `distribution-v1/index.json`. The client trusts that publisher at a fixed GitHub HTTPS path and checks repository, tag, asset URL, exact catalog bytes, package/file hashes and ABI. This is publisher-authority verification, not a separate signature or a fresh client API response. Public metadata delivery avoids the user’s anonymous REST quota and requires no personal GitHub token.

Transient Windows file locks receive bounded retries; active files are never deleted before their replacement succeeds. The dev server ignores profile and download staging directories. Installed modules and device-protected verification metadata support offline reuse. Legacy REST lookups honor rate-limit reset times after HTTP 403 instead of repeatedly sending requests.

Provider releases run independent GitHub Actions tests and upload their package, then refresh the shared catalog. This can update one provider’s CLI arguments, output parsing, model discovery, API mapping, pricing, and upstream download recipe without rebuilding the desktop app. Changes to the shared host ABI require an app update.

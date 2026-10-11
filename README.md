# Jarwis

Jarwis is a local-first, provider-agnostic personal AI assistant. It combines
local or hosted models with controlled tools, persistent project context, and
human approval for consequential actions. The Windows desktop app runs its
server and stores its data on your own machine.

## Local setup (Windows)

The quickest way to run Jarwis is the Windows desktop installer. To build it
yourself, install Node.js 20 or newer, open PowerShell in this folder, and run:

```powershell
npm.cmd ci
npm.cmd run desktop:build
```

Run `release\Jarwis-Setup-1.0.0.exe` (the version in the filename may change)
and follow the installer. Jarwis starts its web server on your own computer,
keeps its database, settings, and files in your Windows user-data folder, and
does not require a Jarwis account or cloud database. The installer does not
include AI model weights: install Ollama separately, start it, and download a
model from **Settings → Models**. Keep Jarwis and Ollama running to chat
offline. Model downloads need internet once; after that local model replies do
not. API keys and cloud accounts are optional, and cloud providers may charge
or impose changing free-tier limits.

For a Windows PC with around 8 GB RAM and no dedicated AI GPU, a small
quantized model such as `qwen2.5-coder:1.5b` is a practical local choice; it
can handle basic chat and coding, but it is less capable than a large cloud
model. Jarwis estimates model memory from its parameter count and current free
RAM, then avoids local models that do not fit. A 14B model may be installed
but is too large for automatic use on this class of PC. Close other
memory-heavy apps before asking Jarwis to use a larger local model. Model
downloads are separate from the Jarwis installer.

To run from source instead of installing the desktop app:

```powershell
npm.cmd ci
npm.cmd start
```

Open `http://127.0.0.1:3000`. The source server binds to loopback by default;
it is for this computer, not an internet-facing or multi-user server. Its
database is `nexus.db` and files go in `data\` and `workspaces\` by default.
Copy `.env.example` to `.env` only if you want to change settings or configure
optional hosted providers. Do not share `.env` or put API keys in the browser.
The `NEXUS_*` environment variable names are retained for compatibility with
the existing server configuration.

This repository is an existing JavaScript/Electron/Express application with a
SQLite database and installable browser interface; it is not a Next.js,
FastAPI, or Supabase application. Keeping that working local architecture
avoids requiring cloud accounts or moving private conversations to a hosted
database. The desktop app runs the backend as a local server, and the same UI
can also be opened in a browser or installed as a PWA. Ollama provides local
inference; optional provider adapters can use their own online APIs. There is
no separate job queue or Supabase account required.

For simple steps to add free-tier cloud models, see
[docs/GETTING-STARTED.md](./docs/GETTING-STARTED.md). For a map of the code and
the files that are local development leftovers rather than app features, see
[docs/PROJECT-STRUCTURE.md](./docs/PROJECT-STRUCTURE.md).

## Current capabilities

- Chat with Ollama, OpenAI, Anthropic Claude, Google Gemini, OpenRouter,
  Groq, DeepSeek, Mistral, xAI, Together, or another OpenAI-compatible server
- Discover models from configured providers, then route chat, writing, coding,
  and planning to suitable configured models
- Use agent loops that plan, call tools, verify results, and return an answer
- Create, read, modify, preview, and delete project-scoped workspace files
- Create projects, attach files, download or delete individual project files,
  edit project goals, and group regular chats into a project
- Search and sort projects; open project details to edit its goal and jump to
  any chat grouped there
- Use each chat's options menu to pin, rename, move to a project, copy a
  transcript, archive, or delete it
- Run allowlisted terminal commands and safe Git operations
- Search/fetch web content, run research, and store project artifacts
- Index documents for retrieval-augmented answers and retain user memories
- Inspect images, work with SQLite databases, connect MCP servers, and run
  scheduled/manual workflows
- Generate prompt-driven images into the workspace with `image_generate` when
  `OPENAI_API_KEY` is configured; generated files are available under
  `/api/preview/` and require approval when approvals are enabled
- Use the Images workspace to generate, browse, open, download, and delete images;
  direct generation is owner/admin-only because the current workspace is
  shared by the instance
- Edit an existing workspace PNG, WebP, or JPEG with `image_edit`; it writes a
  separate result by default, keeping the source image intact
- Generate AI-disclosed speech with `audio_synthesize`, and transcribe a
  workspace audio file with `audio_transcribe`
- Have a spoken back-and-forth conversation in a supported browser using its
  speech recognition and speech synthesis APIs; microphone permission is
  required, the desktop app grants audio-only access to its local Jarwis
  origin, recognition may use the browser vendor's online service, and Jarwis
  sends recognized text through the normal chat and agent flow
- Require one-time approval for risky tools, with paths constrained to the
  workspace and terminal/Git commands restricted by policy

The browser app can be installed from a supported browser. Its service worker
caches only the public UI shell (HTML, CSS, JavaScript, manifest, and logo);
it never caches `/api` responses, conversations, or credentials. The app
shell can reopen offline, but hosted model calls and other server features
still need the Jarwis server and network connection. A locally running desktop
or web server can continue to use local Ollama without internet access.

For password-account email verification and password recovery, configure a
Resend account and set `RESEND_API_KEY`, `NEXUS_EMAIL_FROM`, and
`NEXUS_PUBLIC_URL`. Set `NEXUS_REQUIRE_EMAIL_VERIFICATION=true` to block
password sign-in until the one-time email link is used. Links expire after 30
minutes and can be used once. Recovery requests return a generic response so
they do not disclose whether an account exists. With verification disabled,
local password registration keeps its existing immediate-sign-in behavior.

## Windows desktop installer

Build a single Windows x64 installer with `npm.cmd ci` followed by
`npm.cmd run desktop:build`. The installer is written to `release/` as
`Jarwis-Setup-<version>.exe`; it installs a desktop window and runs the
Jarwis server locally without requiring a separate Node.js installation.

The desktop app stores its database, workspace, and provider configuration in
its per-user application data directory. On first launch it creates a `.env`
file there from `.env.example`; edit that file to add provider API keys, then
restart Jarwis. The installer does not bundle third-party model weights,
Ollama, or paid-provider access. Local models must be downloaded separately
through Ollama, and hosted models require the provider's own credentials and
may incur usage charges. The existing Node server and Render Blueprint remain
available for server deployments; the Windows installer is a separate local
desktop distribution.

Jarwis currently uses shared, instance-wide storage and is **single-user only**.
Public signup and creation of additional accounts are disabled even if
`NEXUS_ALLOW_SIGNUP` or an invite code is configured. Google sign-in can only
link an already provisioned account; it does not create accounts. The first
owner can be configured through `NEXUS_BOOTSTRAP_ADMIN_USERNAME` and
`NEXUS_BOOTSTRAP_ADMIN_PASSWORD`; if no account is provisioned, the desktop
app remains available in trusted loopback mode. If more than one enabled
account is present in the security store, Jarwis blocks sign-in and application
data APIs until extra accounts are removed. This guard does not provide
per-user isolation: do not use the same instance as a multi-user service.

In Settings → Models, use **Discover models** on a configured provider to
fetch the models that account can actually access. Select a task preset or an
available model in the model menu. Automatic routing uses discovered model
capabilities for chat, writing, coding, research, and other tasks. It refreshes
configured provider/model availability every 30 seconds and exposes the live
snapshot at `/api/runtime`. Local model selection uses currently free system
RAM with a 1 GB operating reserve and a conservative parameter-count estimate;
it does not currently measure dedicated
GPU/VRAM. The selected provider/model is shown below each response. If a model
fails before a tool starts, Jarwis tries up to two safe alternatives; it will
not retry after a tool action begins, to avoid repeating side effects.
Free-tier quotas are not consistently exposed by provider APIs, so Jarwis
reports quota as unknown and learns a provider is rate-limited only when a
request fails. Automatic routing uses local models, Groq/Google free-tier
access, and explicitly free OpenRouter models for ordinary requests. Paid
providers are excluded from automatic routing by default, even for
high-intelligence or long-context requests. Enable **Allow paid models in
automatic routing** in Settings only if you accept possible charges; explicitly
choosing a paid model remains available. Paid-provider fallbacks after a first
attempt are disabled unless `NEXUS_AUTO_ALLOW_PAID_FALLBACK=true`. Provider
free quotas and terms can change; check each provider's account dashboard.
Choose a discovered OpenAI image model separately under Image generation. The built-in
provider list is not a claim that every model or framework on the market is
included; provider APIs, access rights, and model catalogs change over time.
RAM estimates apply only to local models. Automatic routing avoids local
models that exceed the current free-memory estimate; you can still explicitly
select a larger installed model at your own risk. Hosted models are not
constrained by the local machine's RAM.

## Deploying to Render

The included `render.yaml` is a Render Blueprint for the free web-service
plan. Free services sleep after inactivity and have an ephemeral filesystem:
chats, user state, memories, and workspace files can be lost when Render
restarts or redeploys the service. This is suitable for trying Jarwis, not for
storing important data. To deploy:

1. Create a new Render Blueprint from this GitHub repository and select the
   `main` branch.
2. Render generates the initial admin password and stores it as a private
   environment variable. In the Render Dashboard, open the `nexus-ai` service,
   then **Environment** and reveal `NEXUS_BOOTSTRAP_ADMIN_PASSWORD`. The
   initial login is `nexus-admin` (or use the bootstrap username configured
   there) and that password. Do not share it or commit it to Git.
3. Open the `onrender.com` URL Render assigns and sign in. Keep the generated
   password environment variable configured: the free service can lose its
   local user database on restart, and Jarwis needs this value to recreate the
   initial owner.
4. Provider credentials such as `OPENAI_API_KEY` are added in Render's private
   **Environment** settings; locally, edit the `.env` in Jarwis's per-user
   application-data folder. The Settings → Models page shows the exact
   credential variable each provider needs.
5. Keep account creation disabled. Public signup, invite signup, and admin
   creation of additional accounts are disabled in this build, even if signup
   environment variables are set. Do not use the hosted instance as a
   multi-user service: chats, projects, memories, and workspace files still
   share instance-wide storage.
6. To enable AI responses, add a provider API key in the Render service's
   Environment page (for the default model, add `OPENAI_API_KEY`). This is
   optional for starting the web app; provider usage may be billed separately.
7. To enable Google sign-in, create a Google OAuth **Web application** client
   in Google Cloud Console. Add
   `https://nexus-ai-f1k8.onrender.com/api/auth/google/callback` as an
   authorized redirect URI. In Render, set `GOOGLE_OAUTH_CLIENT_ID`,
   `GOOGLE_OAUTH_CLIENT_SECRET`, and `NEXUS_GOOGLE_ADMIN_EMAIL` (the exact
   email used by the owner). Google OAuth only links to an account provisioned
   in advance; it does not create additional accounts. Do not allowlist other
   people until per-user data isolation is implemented.
   Keep the OAuth client secret in Render, never in Git.

The service binds to Render's assigned `PORT`, requires authentication, uses
HttpOnly secure session cookies, and rate-limits login attempts. The SQLite
database and generated workspace live on temporary storage and are not backed
up. The default remote model in the blueprint is OpenAI `gpt-4o-mini`; provider
usage is billed separately. Render does not supply model access or provider
credits. Add provider credentials only through Render's private environment
settings; they are not included in the GitHub repository.

## Private persistent deployment (Docker + Oracle Cloud + Tailscale)

The Docker deployment keeps SQLite, account state, usage logs, and project
workspaces together in a persistent named volume. Port 3000 is bound to
loopback only; it is not published on the VM's public network. Tailscale Serve
can provide HTTPS access to approved devices in your private tailnet.

### Local Docker test

1. Install Docker Desktop and start it.
2. Copy `.env.cloud.example` to `.env`. Generate secrets in PowerShell:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Use one random value for `NEXUS_SECURITY_PEPPER`; generate a different
   password for `NEXUS_BOOTSTRAP_ADMIN_PASSWORD` (at least 16 characters).
   Set `NEXUS_BOOTSTRAP_ADMIN_USERNAME` to your email address. Add a model
   provider key if you want cloud-model responses. Keep `.env` private.
3. Build and start Jarwis:

   ```powershell
   docker compose up -d --build
   docker compose ps
   ```

4. Open `http://127.0.0.1:3000` and sign in using the bootstrap credentials.
   `docker compose down` stops the service but keeps the named data volume;
   `docker compose down -v` permanently deletes it.

### Oracle Cloud private VM

1. Create an Oracle Cloud account and choose a region with Always Free
   Ampere A1 capacity. In **Compute → Instances → Create instance**, select
   Ubuntu 24.04 and the Ampere A1 Flex shape. A 1 OCPU / 8 GB configuration
   fits this Node deployment; Always Free capacity is region-dependent and
   is not guaranteed. Keep an SSH key somewhere safe.
2. Give the VM outbound internet access for package and image downloads and
   Tailscale. In the VM's security list/network security group, allow SSH
   only from your own IP address and do **not** add public inbound rules for
   ports 3000 or 443. The app's Docker port is loopback-only.
3. SSH into Ubuntu and install Docker Engine and Compose using Docker's
   official Ubuntu instructions. Install the Tailscale client from its
   official Linux instructions, then run `sudo tailscale up` and complete
   sign-in for your private tailnet.
4. Authenticate GitHub CLI to access this private repository, clone it, and
   enter the checkout. Copy `.env.cloud.example` to `.env`, set the bootstrap
   username, a unique 16+ character password, a random 32-byte pepper, and
   any provider keys. Restrict the file to the VM owner with `chmod 600 .env`.
5. Run `docker compose up -d --build` and check `docker compose ps` and
   `docker compose logs --tail=100 nexus`. Sign in locally on the VM at
   `http://127.0.0.1:3000` before enabling remote access.
6. From `tailscale status`, note the VM's MagicDNS name. Set
   `NEXUS_PUBLIC_URL` in `.env` to its `https://<machine>.<tailnet>.ts.net`
   name, then restart with `docker compose up -d`. Run
   `sudo tailscale serve --bg http://127.0.0.1:3000` on the VM and check
   `tailscale serve status`. Install/sign in to Tailscale on each personal
   phone, tablet, or computer to use the private URL. Do not enable Tailscale
   Funnel or expose the app port publicly.
7. Back up the persistent volume regularly. Stop Jarwis, archive the named
   volume, and restart it:

   ```sh
   docker compose stop
   docker run --rm -v nexus-ai-data:/data:ro -v "$PWD:/backup" alpine \
     tar -czf /backup/nexus-ai-data-backup.tar.gz -C /data .
   docker compose start
   ```

   Store backups off the VM in a private location and test restoring one.
   The VM and volume are not a substitute for a second backup copy.

This is a single-owner private deployment, not a multi-tenant service. Jarwis
still uses shared application data for accounts: keep signup disabled and
allow only your own Google identity. A true multi-user installation needs
tenant-scoped storage for chats, projects, memories, provider secrets, and
usage before it is safe to invite other people. The OCI account, VM, GitHub
authorization, Tailscale identity, provider API keys, and email-sending
credentials are yours to create; none are embedded in this repository.

## Integration status

Model-provider transports (Ollama, OpenAI-compatible, Anthropic, and Gemini)
are implemented, but each hosted provider requires its own credentials and
successful network access. A model appearing in the catalogue does not mean
that its provider is configured or reachable.

The Google Drive, OneDrive, GitHub, email, calendar, generic REST, storage, and
browser entries in Settings → Integrations are **connector manifests**, not
complete turnkey OAuth/API integrations. Jarwis does not mark them connected
until an adapter exists; using “Check setup” returns an explicit adapter-
unavailable status instead of a false success. MCP clients can connect to
operator-configured MCP servers; available actions depend on those servers.
This repository does not
provide one-click deployment to every host: Render has a Blueprint, while
other hosting platforms need their own configuration, secrets, persistent
storage, and provider setup. Verify each external integration against real
credentials in its target environment before relying on it.

## Validation

**`npm run verify`** runs every check and prints one verdict. By default it
starts Jarwis on an available test port with a temporary database and
workspace, then removes that test data. It does not reuse or modify the
Jarwis server already running on port 3000:

```
[PASS] unit tests       218 pass, 0 fail
[PASS] agents           OK: every agent references only real tools.
[PASS] ui smoke         UI SMOKE: PASS
[PASS] stream render    STREAM RENDER: PASS
[PASS] api surface      API SURFACE: PASS - 23/23 endpoints healthy
[PASS] subsystems       23/23 checks passed
[SKIP] responsive       pass --browsers to include

7/7 checks passed in 41.4s
ALL CHECKS PASSED
```

Use `npm run verify:all` to include the Firefox and WebKit layout runs. The
current browser driver provides Chromium; Firefox and WebKit are reported as
unavailable when their drivers are not installed.

To point checks at an existing server, set `NEXUS_URL` explicitly. This is
opt-in because API checks create and remove temporary project/chat records and
a temporary viewer key; use a throwaway instance if you choose this mode.

The suite has 223 tests in total. Five Git integration tests are skipped when
the Git CLI is not installed or not available on PATH; install Git for Windows
to exercise those repository operations. Each check can also be run on its
own:

| command | checks |
|---|---|
| `npm test` | 223 tests; five Git integration tests skip if Git CLI is missing (model routing, security, media, evaluation, observability, chat titles, workspace and knowledge safety) |
| `npm test:ui` | headless UI smoke: clicks real controls and asserts an observable effect |
| `npm test:stream` | replays a known NDJSON stream and asserts the messages render |
| `npm test:api` | every documented endpoint answers without a server crash |
| `npm test:browsers` | responsive layout in Chromium, Firefox, and WebKit |
| `npm check:agents` | every agent references only registered tools |
| `npm test:smoke` | provider connectivity, model discovery, and a real completion |

`test:ui` exists because rendering correctly is not the same as working. It
renders the page, clicks the composer tools, attachment menu, sidebar toggle,
workspace toggle, and Settings button, and fails if any of them produces no
effect — the signature of an unguarded throw during startup that aborts event
binding.

`test:stream` replays a fixed NDJSON stream into the real UI, so the assertion
does not depend on how fast the configured model happens to be.

**Note on browser coverage:** Chromium is verified at four viewport widths.
Firefox and WebKit are installed but patchright's driver cannot launch them in
this environment, so their layout is reported as *unavailable* rather than
passing. A driver limitation is printed as a note and does not fail the run; a
measured layout defect (horizontal overflow) does.

## Security and platform layer
Jarwis now ships with a security core and a developer/observability surface:

- **Authentication** (`lib/security/`): API keys (stored hashed, never in
  plaintext), users with scrypt-hashed passwords, expiring session tokens, and
  a JSONL audit log. Auth is *opt-in*: with no keys and no users the app runs as
  the local owner exactly as before; creating a user or key — or setting
  `NEXUS_REQUIRE_AUTH=true` — makes unauthenticated requests return 401.
- **Account creation** is disabled. Signup flags and invitation codes do not
  enable registration. Additional-account creation is blocked until data is
  isolated per user.
- **Google sign-in** is an optional OAuth 2.0 web flow with CSRF state,
  verified-email checks, explicit email allowlisting, and secure session
  cookies. It is disabled until Google OAuth client credentials and an
  authorized administrator email are configured.
- **Role-based permissions**: `owner`, `admin`, `member`, and `viewer`, each
  mapping onto the tool capability model. `requireCapability()` gates routes.
- **Streaming chat** (`POST /api/chat/stream`): Server-Sent Events token
  streaming with cancellation, mirroring the context assembly of `/api/chat`.
- **Benchmarking** (`POST /api/benchmarks/run`) and the offline invariant
  suite (`POST /api/evals/run`) for regression testing.
- **Observability** (`GET /api/usage`, `GET /api/metrics`): per-call records of
  latency, tokens, errors, and estimated cost.
- **Health probes** (`GET /api/ready`).

See the **Settings → Usage** and **Benchmarks** panels in the UI.

## Interface

The web UI is a from-scratch recreation of ChatGPT's layout language: 260px
collapsible sidebar, centered conversation column, floating rounded composer
with a circular send button, a top-center model/intelligence picker, and
light/dark/system theming. All original markup, CSS, and icons — no proprietary
assets were copied.

Settings mirrors ChatGPT's section structure:

- **General** — language, default intelligence, auto-title, Enter-to-send,
suggested prompts, wide layout, streaming, keep-awake, reasoning summary,
request timeout
- **Appearance** — theme swatches, accent/background/sidebar colours, chat font,
chat font size, code font size, high contrast, pointer cursors, translucent
sidebar, reduce motion
- **Profile** — display name, username, avatar colour, usage insights
- **Personalization** — custom instructions, response style, context toggles,
memory management
- **Models** — providers, roles, catalog, routing health, local model install,
advanced sampling (temperature, top-p, top-k, repetition penalty, seed, output
budget, agent steps)
- **Notifications** — task/message/sound toggles and browser permission
- **Voice** — dictation language and test, read-aloud voice, speed, and pitch
- **Keyboard** — searchable shortcut catalogue
- **Browser** — enable agent, live activity, downloads, allowed and blocked sites
- **Computer Use** — master switch plus screen read, mouse, typing, launching,
and per-action confirmation
- **Integrations** — connector registry with connect/disconnect
- **Archived chats** — archive/restore all, per-chat unarchive
- **Data controls** — export, delete all, clear memories, automations
- **Security** — protections, auth posture, API keys, audit log
- **About** — version, runtime, browser, platform

Every Appearance control applies immediately through CSS custom properties and
body attributes; advanced sampling options are mapped to each provider's own
field names in the gateway.

## Agents

Jarwis ships **27 specialist agents**, each restricted to tools that are actually
registered — `npm run check:agents` fails if an agent ever names a tool that does
not exist, so a selectable agent can never be a broken one:

general, coding, research, data-analyst, browser, computer-use, writer,
documents, presentations, spreadsheets, science, mathematics, business,
education, planner, project-manager, automation, productivity, vision, media,
database, security-review, devops, translation, legal, health, design.

## Capability boundary

The built-in GitHub, Drive, email, calendar, storage, REST, and browser entries
are connector manifests. They describe the intended integration surface but do
not yet include OAuth flows or live third-party actions. MCP can connect live
tool servers, but each server must be configured by the operator.

Authentication accounts do not yet have tenant-isolated chats, memories,
documents, projects, provider settings, or workspace files. The usage ledger is
instance-wide and is restricted to administrators. Signup and additional
account provisioning are disabled; if a legacy security store contains more
than one active account, Jarwis blocks data APIs and sign-in, while leaving
account-list and account-removal routes available to an administrator for
recovery. This safety gate does not replace tenant-scoped storage.

The Projects page and workspace file tree expose download and delete controls
for stored files. Image gallery entries can also be downloaded or deleted.
These controls operate on the single shared local workspace; they do not make
the data private to separate accounts.

Jarwis is an AI application and agent harness; it does not train or reproduce a
frontier foundation model. Its quality is determined by the selected provider
model, its context, tools, guardrails, and evaluation process.

## Model strategy

Do not install every model blindly. Use the provider catalog and live discovery
endpoint (`/api/providers/models`) to select models your account can actually
use, then route each task to a capable model. A practical starting mix is a
frontier reasoning/coding model for difficult work, a lower-cost model for
summaries and classification, local Ollama models for private/offline work,
and dedicated image/audio models for media. MCP is the framework-neutral way
to add trusted tools and specialist agent services without coupling Jarwis to a
single vendor framework.

Before treating a model as production-ready, evaluate it on representative
tasks for accuracy, tool reliability, latency, cost, citation quality, and
safety. Retrieval over your approved documents and targeted fine-tuning of
eligible models can improve a narrow workflow; neither is equivalent to
training a new frontier foundation model.

## Roadmap to a frontier-style assistant

1. **Reliable core:** add authentication, encrypted credential storage,
   per-user/project access control, rate limits, audit logs, backups, and
   production deployment/observability.
2. **Agent runtime:** durable jobs and queues, resumable long-running tasks,
   browser automation with user takeover, parallel specialist agents, budgets,
   retries, and approval checkpoints.
3. **Knowledge:** source ingestion, OCR, hybrid retrieval with citations,
   document permissions, memory controls, and evaluation datasets.
4. **Connected work:** OAuth-backed connectors for the services you choose,
   MCP allowlists, scoped tokens, and action previews before writes/sends.
5. **Multimodality:** image/file generation, speech input/output, and video or
   screen understanding where a selected model/provider supports it.
6. **Quality and safety:** task-specific evals, regression tests, tracing,
   prompt-injection defenses, sandboxing, and red-team review before enabling
   autonomous external actions.

The practical way to approach this is to use frontier models through their APIs
first, prove the workflow with evals, then replace or supplement models only
where cost, privacy, or latency requires it. Training a comparable foundation
model independently requires a research team, large curated datasets, and
substantial compute; it is not a normal application-development milestone.

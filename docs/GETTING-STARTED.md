# Getting Started with Jarwis

Jarwis can use both local Ollama models and online model providers. Local
models keep prompts on this PC. A cloud model can be more capable, but the
provider receives the prompt and conversation context that Jarwis sends to
it.

## Start Jarwis and choose a first task

Open the **Jarwis** desktop shortcut (or start the local server using the
setup instructions in the README). Jarwis opens its workspace in a desktop
window or browser. On the first screen, the setup summary reports local models
installed and whether any local model is currently eligible for automatic
routing, whether cloud-provider keys have been saved, and the number of
available tools and specialist agents. Installed models are not necessarily
ready to answer if the system cannot run them at that moment. The summary does
not claim a cloud provider is connected just because a key exists.

Choose a suggested task or type your own request. Examples include asking for
a plain-language explanation, writing code, summarizing an uploaded document,
or researching a topic. For tasks that need an outside action, enable the
relevant tool and review approval prompts. Open **Settings → Models** to add a
cloud provider; it is optional, and automatic paid routing stays off unless
you explicitly enable it.

The sign-in screen is used when the Jarwis server requires an account. A
trusted local installation can work without signing in. When you are signed
in, open the account control at the bottom of the sidebar and choose
**Sign out** to end that browser session. The same menu opens **Settings** and
**Profile**. In trusted local mode there is no account session to revoke, and
Jarwis explains that local access remains available; this is not the same as
locking your PC or switching Windows users.

The bottom-left account menu contains **Settings**, **Profile**, and
**Sign out**. Open **Settings** to find the **Workspace & tools** section,
which links to **Artifacts & workspace**, **Scheduled**, **Library**,
**Memory**, **Plugins**, **Usage**, **Benchmarks**, and **Admin**. Memory and
Admin open their management panels inside Settings; the other links open their
corresponding workspace pages. The shorter main sidebar keeps Projects and
Images easy to reach.

To start a project, open **Projects** in the sidebar and select **New project**.
Give it a name and, optionally, a goal or a short description of the work.
Jarwis creates a project chat and keeps its goal and uploaded files together.
The **+** beside Projects in the sidebar opens the same creation form directly.
Search or sort the Projects page to find a workspace. Select **Details** to edit
its name or goal and jump to a chat grouped there. From a chat's **···** menu,
choose **Add to project** to organize a regular conversation with that
workspace; the linked project goal is also included when Jarwis handles that
conversation.

The same chat menu can pin, rename, archive, or delete a conversation. Archived
chats remain recoverable under **Settings → Archived chats**. **Share chat**
copies a plain-text transcript to your clipboard. Jarwis does not create a
public link or invite collaborators in its single-user local mode, so you
choose where to share the copied text.

## Use voice chat

Select the microphone button in the chat composer and allow microphone access
when Windows or the browser asks. The Windows desktop app allows audio capture
only from Jarwis's own local app origin; it does not grant camera access.
Windows can still block microphone access globally, so check **Settings →
Privacy & security → Microphone** and allow desktop apps to use the microphone.

Voice chat uses the browser's speech-recognition and speech-synthesis features.
Recognition may be processed by the browser vendor's online service, so it
needs a supported browser and may need an internet connection. Jarwis sends the
recognized words through the same chat and agent workflow as typed messages;
existing tool permissions and approval prompts still apply. If voice
recognition is unavailable, use the chat input instead.

## Add free-tier cloud models

You need to create your own provider accounts and API keys. Jarwis cannot
create accounts, provide another person's key, or promise that a provider's
free plan will stay free. Availability, model lists, usage limits, and billing
rules can change. Check the provider's current terms before using it.

1. In Jarwis, open **Settings → Models**.
2. Under **Connect cloud models**, choose a provider's **Get a key** link and
   sign in or create your own account.
3. Create an API key in that provider's dashboard and copy it. Keep the key
   private; anyone with it may be able to use your account's quota.
4. Paste it into the matching password field in Jarwis and select **Save API
   keys on this PC**. The key is stored in Jarwis's local server configuration;
   it is not saved in browser storage and is not displayed again.
5. Under **Providers**, choose **Test connection**. When it connects, choose
   **Discover models** to refresh the models available to your account.
6. Leave the model picker on **Auto** for automatic routing, or choose one of
   the discovered models yourself. Jarwis shows which provider and model
   answered below the reply.

Common providers with a free access option:

- **Google Gemini** — [Google AI Studio API keys](https://aistudio.google.com/apikey).
  Google lists free input and output for eligible models, but the free tier is
  limited to certain models and has account-specific rate limits. Free-tier
  content may be used to improve Google's products; do not send sensitive data
  unless the applicable terms and settings meet your privacy needs. Check
  [current pricing](https://ai.google.dev/gemini-api/docs/pricing) and
  [active rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).
- **Groq** — [Groq Console API keys](https://console.groq.com/keys). Its
  free developer access is rate-limited; check the current
  [rate limits](https://console.groq.com/docs/rate-limits) for your account.
- **OpenRouter** — [OpenRouter API keys](https://openrouter.ai/settings/keys).
  Only models explicitly marked free (usually with `:free`) are eligible for
  Jarwis's ordinary automatic free-tier routing. OpenRouter currently
  documents a 20-request-per-minute limit and 50 requests per day for free
  models when the account has no purchased credits. Check its
  [current limits](https://openrouter.ai/docs/limits) and model availability
  before relying on it.

The Models settings also accepts keys for OpenAI, Anthropic, DeepSeek,
Mistral, xAI, Together, and compatible OpenAI-style servers. Those providers
may require payment, so do not add their keys unless you understand their
pricing. An API key does not automatically grant free use.

Jarwis never receives keys from this project or from Copilot. Do not paste a
key into a chat, issue, or source file. If a key is accidentally shared,
revoke it in the provider dashboard and create a replacement.

## What "automatic" means

Jarwis checks which configured providers are reachable, discovers their
available models, and checks local model fit against currently free system
memory. It prefers an eligible local model where possible and uses recognized
free-tier cloud candidates when they are configured. Paid models are excluded
from automatic routing unless you turn on **Allow paid models in automatic
routing** in Settings; Jarwis asks you to confirm before enabling that option.
You can still manually choose a configured paid model. Provider APIs
do not reliably expose remaining daily free quota, so Jarwis may learn that a
free quota is exhausted only after that provider rejects a request. Review
the model label under each reply and the provider's own usage dashboard.

## Your PC and local model sizes

This PC has about 8 GB of RAM and integrated graphics. Small Ollama models
are appropriate for it; a large model's download size is not the same as the
memory it needs to run. Jarwis avoids local models whose estimated runtime
memory does not fit the current available-memory budget. Larger local models
can make the PC unresponsive or fail to load, so this guide does not
recommend installing more large weights on this machine. Cloud inference
uses the provider's hardware instead, subject to that provider's terms.

The existing Ollama installation and the `qwen2.5-coder:1.5b` model are
already set up. No second Ollama installation is needed. When Jarwis reports
no cloud provider, add one of your own provider keys above; the machine has no
preloaded or shared cloud credentials.

## Using the specialist tools

Jarwis includes specialist agents and tools for research, writing, documents,
spreadsheets, data analysis, workspace files, web access, and other tasks.
Describe the outcome you want in chat. Turn on only the tools needed for that
conversation; risky operations can ask for approval. Some capabilities
depend on an installed local program, a supported browser feature, network
access, or an account/API key. A provider connection alone does not sign in to
third-party services such as Google Drive or email; follow each integration's
own setup status in **Settings → Integrations**.

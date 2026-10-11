const express = require("express");
const fs = require("fs");
const path = require("path");

const config = require("../lib/config");
const assistantIdentity = require("../lib/assistantIdentity");
const providers = require("../lib/providers");
const modelRegistry = require("../lib/models");
const modelFallback = require("../lib/models/fallback");
const modelPolicy = require("../lib/models/policy");
const agentRegistry = require("../lib/agents");
const integrationRegistry = require("../lib/integrations");
const workflowModule = require("../lib/workflows");

const database = require("./rag/database");
const memory = require("./memory/memory");
const knowledge = require("./rag/knowledge");

const {
    normalizeMemoryKey
} = require("./memory/memoryNormalizer");

const {
    extractMemories
} = require("./memory/memoryExtractor");

const {
    retrieveContext,
    buildContext
} = require("./rag/rag");

const workspaceTools =
    require("./agent/workspaceTools");

const projectState =
    require("./agent/projectState");

const agentCore =
    require("./agent/agentCore");

const taskEngine =
    require("./agent/taskEngine");

const workflowEngine =
    new workflowModule.WorkflowEngine({
        maxHistory: 100,
        maxTimeoutMs: 10 * 60 * 1000
    });

const toolRegistry =
    require("./agent/toolRegistry");

const registeredTools =
    require("./agent/tools");

const agentLoop =
    require("./agent/agentLoop");

const {
    Client
} = require(
    "@modelcontextprotocol/sdk/client/index.js"
);

function resolveRuntimeRouting(options = {}) {
    const decision = modelRegistry.router.select(options);
    const allowPaid = modelPolicy.allowsPaidAutomatic(options);
    const candidates = modelPolicy.filterAutomaticCandidates(
        decision.candidates,
        options
    );
    const selected = candidates.length
        ? modelRegistry.getModel(candidates[0].provider, candidates[0].model)
        : null;
    return {
        ...decision,
        selected,
        candidates,
        paidRoutingEnabled: allowPaid,
        paidAlternativesAvailable: decision.candidates.some(candidate =>
            !modelPolicy.isKnownFreeTierCandidate(candidate)
        ),
        rationale: selected
            ? {
                ...decision.rationale,
                reasons: [
                    modelPolicy.isKnownFreeTierCandidate(candidates[0])
                        ? "uses a local or known free-tier provider"
                        : "uses a paid provider because paid automatic routing is enabled",
                    ...(decision.rationale?.reasons || [])
                ]
            }
            : {
                reasons: decision.candidates.length && !allowPaid
                    ? ["Only paid models are available; enable paid automatic routing in Settings or select a paid model manually."]
                    : ["No configured, compatible model is currently available."]
            }
    };
}

/*
Platform layer: security, streaming chat, benchmarks,
observability, and the extra HTTP surface. Mounted below
so the original route definitions stay untouched.
*/
const security =
    require("../lib/security");

const securityRoutes =
    require("../lib/security/routes");

const platformRoutes =
    require("./routes/platform");

const mediaRoutes =
    require("./routes/media");

const usage =
    require("./observability/usage");

const app =
    express();

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

/* Sync locally installed Ollama models into the registry so the
   frontend sees them as configured/available. Never throws: if Ollama
   is offline we just keep whatever is already registered. */
async function syncLocalModels() {
    try {
        const installed = await providers.listModels("ollama");
        modelRegistry.registerDiscoveredModels("ollama", installed);
        return installed;
    } catch {
        return [];
    }
}

app.get(
    "/api/models",
    async (req, res) => {
        await syncLocalModels();
        res.json({
            models:
                modelRegistry.listModels({
                    provider:
                        req.query.provider
                            ? String(req.query.provider)
                            : undefined
                }),

            intelligence:
                modelRegistry.INTELLIGENCE_PROFILES,

            hardware:
                modelRegistry.detectHardware()
        });
    }
);

app.get(
    "/api/agents",
    (req, res) => {
        res.json({
            agents:
                agentRegistry.list()
        });
    }
);

app.get(
    "/api/agents/:id",
    (req, res) => {
        const agent =
            agentRegistry.get(req.params.id);

        if (!agent) {
            return res.status(404).json({
                error: "Agent not found."
            });
        }

        res.json(agent);
    }
);

app.get(
    "/api/automations",
    (req, res) => {
        res.json({
            automations:
                workflowEngine.listWorkflows()
        });
    }
);

app.get(
    "/api/workflows",
    (req, res) => {
        res.json({
            automations:
                workflowEngine.listWorkflows()
        });
    }
);

app.get(
    "/api/automations/runs",
    (req, res) => {
        const requestedLimit =
            Number.parseInt(
                String(req.query.limit || "50"),
                10
            );

        res.json({
            runs:
                workflowEngine.listRuns(
                    Number.isFinite(requestedLimit)
                        ? Math.min(Math.max(requestedLimit, 1), 100)
                        : 50
                )
        });
    }
);

app.get(
    "/api/automations/runs/:id",
    (req, res) => {
        const run =
            workflowEngine.getRun(req.params.id);

        if (!run) {
            return res.status(404).json({
                error: "Automation run not found."
            });
        }

        res.json({ run });
    }
);

app.post(
    "/api/automations/runs/:id/cancel",
    security.requireCapability("EXECUTE"),
    (req, res) => {
        const run =
            workflowEngine.getRun(req.params.id);

        if (!run) {
            return res.status(404).json({
                error: "Automation run not found."
            });
        }

        if (!workflowEngine.cancel(req.params.id)) {
            return res.status(409).json({
                error: "Automation run is no longer active.",
                run
            });
        }

        res.json({
            ok: true,
            run: workflowEngine.getRun(req.params.id)
        });
    }
);

app.get(
    "/api/automations/:name",
    (req, res) => {
        const workflow =
            workflowEngine.registry.get(req.params.name);

        if (!workflow) {
            return res.status(404).json({
                error: "Automation not found."
            });
        }

        res.json(workflow);
    }
);

app.post(
    "/api/automations/:name/run",
    security.requireCapability("EXECUTE"),
    async (req, res) => {
        try {
            const result = await workflowEngine.run(
                req.params.name,
                req.body?.input || {},
                {
                    trigger:
                        req.body?.trigger || "manual",
                    runId:
                        req.body?.runId || undefined
                }
            );

            if (result.ok) {
                return res.json(result);
            }

            if (result.approvalRequired) {
                return res.status(202).json(result);
            }

            res.status(400).json(result);
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error.message
            });
        }
    }
);

app.get(
    "/api/integrations",
    (req, res) => {
        res.json({
            integrations:
                integrationRegistry.list().map(
                    connector => ({
                        ...connector,
                        state:
                            integrationRegistry.state(
                                connector.id
                            )
                    })
                )
        });
    }
);

app.get(
    "/api/integrations/:id",
    (req, res) => {
        const connector =
            integrationRegistry.get(req.params.id);

        if (!connector) {
            return res.status(404).json({
                error: "Integration not found."
            });
        }

        res.json({
            ...connector,
            state:
                integrationRegistry.state(
                    connector.id
                ),
            health:
                integrationRegistry.health(
                    connector.id
                )
        });
    }
);

app.post(
    "/api/integrations/:id/connect",
    security.requireCapability("WRITE"),
    (req, res) => {
        const connector = integrationRegistry.get(req.params.id);
        if (!connector) {
            return res.status(404).json({ error: "Integration not found." });
        }
        if (!connector.adapterAvailable) {
            const error = "This connector is a catalog entry only. Its provider API/OAuth adapter has not been implemented or configured yet.";
            integrationRegistry.setConnectionState(connector.id, "error", { error });
            return res.status(501).json({
                ok: false,
                code: "CONNECTOR_ADAPTER_UNAVAILABLE",
                error
            });
        }
        try {
            res.json(
                integrationRegistry.connect(
                    req.params.id,
                    req.body?.metadata || {}
                )
            );
        } catch (error) {
            res.status(400).json({
                error: error.message
            });
        }
    }
);

app.post(
    "/api/integrations/:id/disconnect",
    security.requireCapability("WRITE"),
    (req, res) => {
        const state =
            integrationRegistry.disconnect(
                req.params.id
            );

        if (!state) {
            return res.status(404).json({
                error: "Integration not found."
            });
        }

        res.json(state);
    }
);

app.post(
    "/api/agents",
    security.requireCapability("WRITE"),
    (req, res) => {
        try {
            const agent =
                agentRegistry.register(req.body || {});

            res.status(201).json(agent);
        } catch (error) {
            res.status(400).json({
                error: error.message
            });
        }
    }
);

app.patch(
    "/api/agents/:id",
    security.requireCapability("WRITE"),
    (req, res) => {
        try {
            const agent =
                agentRegistry.update(
                    req.params.id,
                    req.body || {}
                );

            res.json(agent);
        } catch (error) {
            res.status(400).json({
                error: error.message
            });
        }
    }
);

app.delete(
    "/api/agents/:id",
    security.requireCapability("DELETE"),
    (req, res) => {
        try {
            res.json({
                deleted:
                    agentRegistry.remove(
                        req.params.id
                    )
            });
        } catch (error) {
            res.status(400).json({
                error: error.message
            });
        }
    }
);

const {
    StdioClientTransport
} = require(
    "@modelcontextprotocol/sdk/client/stdio.js"
);

const {
    decideAction
} = require("./agent/agent");

const gateway =
    require("../lib/providers/gateway");

const MODEL =
    config.LOCAL_FALLBACK_MODEL;

const NEXUS_VERSION =
    "3.1.0";

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(
    express.static(path.join(config.ROOT_DIR, "public"))
);

/*
AUTHENTICATION
Attach the caller's identity to every request. When
no users or API keys exist and NEXUS_REQUIRE_AUTH is
unset, this resolves to the local owner and the app
behaves exactly as before (single-user local mode).
Once a key or user is created, or auth is forced on,
unauthenticated requests are rejected with 401.
*/

app.use(
    "/api",
    security.middleware()
);

app.use(
    "/api",
    securityRoutes.routes()
);

app.use(
    "/api",
    mediaRoutes.routes()
);

/*
PLATFORM ROUTES
Streaming chat, benchmarks, evaluations, usage and
health probes.
*/

app.use(
    "/api",
    platformRoutes.routes({
        database,
        memory,
        rag: require("./rag/rag")
    })
);

/*
LIVE PREVIEW (master spec section 8)
Serves the Nexus workspace read-only over
HTTP so the UI can show a running preview
of generated sites inside an iframe.
express.static refuses any path outside the
root (no .., no absolute escapes), which is
exactly the workspace path-safety rule.
The UI's getPreviewUrl() points at
/api/preview/index.html.
*/
try {
    workspaceTools.ensureWorkspace();

    app.use(
        "/api/preview",
        express.static(
            workspaceTools.getWorkspaceRoot(),
            {
                index: "index.html",

                fallthrough: true
            }
        )
    );
} catch (error) {
    console.error(
        "Preview engine init error:",
        error
    );
}

app.get(
    "/api/provider",
    (req, res) => {
        res.json({
            ...gateway.getActiveProvider(),
            version: NEXUS_VERSION
        });
    }
);

/*
Provider and model introspection for the settings UI and
diagnostics. This endpoint is deliberately metadata-only:
model discovery remains opt-in through /api/providers/models
so opening the UI never triggers network calls.
*/
app.get(
    "/api/providers",
    (req, res) => {
        res.json({
            active:
                gateway.getActiveProvider(),

            providers:
                providers.describeProviders(),

            roles:
                providers.describeRoles(),

            models:
                modelRegistry.listModels(),

            intelligence:
                modelRegistry.INTELLIGENCE_PROFILES,

            hardware:
                modelRegistry.detectHardware()
        });
    }
);

app.get(
    "/api/runtime",
    async (req, res) => {
        const runtime = await modelRegistry.runtime.refresh({
            force: req.query.refresh === "true"
        });
        const intelligence = req.query.intelligence || "balanced";
        res.json({
            ...runtime,
            routing: resolveRuntimeRouting({
                task: req.query.task || "chat",
                intelligence,
                preferLocal: req.query.preferLocal !== "false"
            })
        });
    }
);

app.get(
    "/api/providers/models",
    async (req, res) => {
        try {
            const provider =
                req.query.provider
                    ? String(req.query.provider)
                    : null;

            if (provider) {
                const discovered = await providers.listModels(provider);
                const registered = modelRegistry.registerDiscoveredModels(
                    provider,
                    discovered
                );
                return res.json({
                    provider,
                    models: discovered,
                    registered: registered.length
                });
            }

            res.json({
                models:
                    await providers.listAllModels()
            });
        } catch (error) {
            res.status(error.status || 502).json({
                error: error.message
            });
        }
    }
);

app.get(
    "/api/providers/:provider/health",
    async (req, res) => {
        const provider = String(req.params.provider || "").trim();
        if (!provider) {
            return res.status(400).json({ error: "Provider is required." });
        }
        const result = await providers.checkProvider(provider);
        res.status(result.ok ? 200 : 503).json(result);
    }
);

app.get(
    "/api/capabilities",
    (req, res) => {
        res.json({
            product: {
                name: "Jarwis",
                version: NEXUS_VERSION
            },

            active:
                gateway.getActiveProvider(),

            providers:
                providers.describeProviders(),

            roles:
                providers.describeRoles(),

            paidAutoRoutingEnabled:
                process.env.NEXUS_AUTO_ALLOW_PAID_API === "true",

            models:
                modelRegistry.listModels(),

            hardware:
                modelRegistry.detectHardware(),

            tools:
                toolRegistry.list(),

            agents:
                agentRegistry.list(),

            automations:
                workflowEngine.listWorkflows(),

            integrations:
                integrationRegistry.list().map(
                    connector => ({
                        ...connector,
                        state:
                            integrationRegistry.state(
                                connector.id
                            )
                    })
                ),

            permissions: {
                granted:
                    permissions.getGranted(),

                available:
                    permissions.CAPABILITIES
            },

            features:
                config.FEATURES
        });
    }
);

/*
==================================================
CHAT HELPERS
==================================================
*/

function getChatOrCreate(chatId) {
    if (chatId) {
        const existing =
            database.getChat(chatId);

        if (existing) {
            return existing;
        }
    }

    return database.createChat(
        "New Chat",
        MODEL
    );
}

function getHistoryBeforeCurrent(
    chatId,
    currentUserMessageId,
    limit = 12
) {
    const messages =
        database.getRecentChatMessages(
            chatId,
            limit + 1
        );

    return messages
        .filter(
            message =>
                message.id !==
                currentUserMessageId
        )
        .slice(-limit)
        .map(
            message =>
                `${message.role}: ${message.content}`
        )
        .join("\n");
}

/*
Derive a short, readable chat title from the first user message.

The goal is a title that reads like a topic, not a copy of the
instruction. The rules below strip the conversational scaffolding
("reply with exactly", "please can you") and keep the subject.
*/
function generateChatTitle(message) {
    let title = String(message || "").trim();

    /* Remove code fences / inline code so a pasted snippet does not
       become the title. */
    title = title.replace(/```[\s\S]*?```/g, " ");
    title = title.replace(/`([^`]*)`/g, "$1");

    /*
    Strip leading meta-instructions. Each pattern removes phrasing
    that describes HOW to answer rather than WHAT is being asked.
    */
    const LEADING_NOISE = [
        /^(please\s+)?(can|could|would)\s+you\s+(please\s+)?/i,
        /^(please\s+)?(can|could|would)\s+you\s+/i,
        /^please\s+/i,
        /^i\s+(want|need|would like)\s+(you\s+)?to\s+/i,
        /^(help\s+me\s+)?(to\s+)?/i,
        /^(reply|respond|answer|say|write|output|print)\s+(with\s+)?(exactly|only|just)\s*:?\s*/i,
        /* "one word: ready", "in a single word - yes" */
        /^(reply|respond|answer|say)\s+(with\s+|in\s+)?(one\s+word|a\s+single\s+word|one\s+sentence)\s*[:,-]?\s*/i,
        /* The noun phrase alone: "one word: ready" */
        /^(one\s+word|a\s+single\s+word)\s*[:,-]\s*/i,
        /^(reply|respond|answer)\s+with\s+/i,
        /^(tell|show)\s+me\s+(about\s+|more\s+about\s+)?/i,
        /^(explain|describe|summari[sz]e)\s+/i,
        /^(give|provide)\s+me\s+/i,
        /^(what|who|where|when|why|how)\s+(is|are|was|were|does|do|did|can|could|would|should)\s+/i,
        /^(hi|hello|hey)[,!.]?\s*/i
    ];

    /*
    Trailing filler: politeness that adds no meaning to a title.
    "summarize this document for me please" should not keep the
    "for me please".
    */
    const TRAILING_NOISE = [
        /\s+(for\s+me|to\s+me|please)$/i,
        /\s+(please|thanks|thank\s+you)$/i,
        /\s+(in\s+simple\s+terms|simply|really\s+quickly|quickly|asap)$/i,
        /\s+(for\s+me\s+)?please$/i
    ];

    /* Apply repeatedly: "please can you reply with exactly:" is several. */
    let changed = true;
    let guard = 0;
    while (changed && guard < 8) {
        changed = false;
        guard += 1;
        for (const pattern of LEADING_NOISE) {
            const next = title.replace(pattern, "");
            if (next !== title && next.trim()) {
                title = next.trim();
                changed = true;
            }
        }
    }

    /* Collapse whitespace and trailing punctuation. */
    title = title.replace(/\s+/g, " ").trim();

    /* Drop trailing politeness until one stops matching. */
    let trimmed = true;
    let trimGuard = 0;
    while (trimmed && trimGuard < 5) {
        trimmed = false;
        trimGuard += 1;
        for (const pattern of TRAILING_NOISE) {
            const next = title.replace(pattern, "");
            if (next !== title && next.trim()) {
                title = next.trim();
                trimmed = true;
            }
        }
    }

    title = title.replace(/^[\s:,.!?-]+/, "").replace(/[\s:,.!?-]+$/, "");

    if (!title) {
        return "New Chat";
    }

    /*
    Prefer breaking at a word boundary so the title is not cut
    mid-word. 48 characters keeps it readable in the sidebar.
    */
    const LIMIT = 48;
    if (title.length > LIMIT) {
        const clipped = title.slice(0, LIMIT);
        const lastSpace = clipped.lastIndexOf(" ");
        title = (lastSpace > LIMIT * 0.6 ? clipped.slice(0, lastSpace) : clipped).trim();
    }

    return title.charAt(0).toUpperCase() + title.slice(1);
}

/*
Repair titles that were stored before the title generator improved.

An older build copied the first message verbatim, so chats are named
"Reply with exactly: pong". This re-derives a proper title from the
same first message, once, at startup. It only touches titles that
match known instruction phrasing, so a user-renamed chat is never
altered.
*/
function repairLegacyChatTitles() {
    /*
    Matches the instruction phrasings older builds copied verbatim,
    including the case where the leading verb was already stripped
    and only the noun phrase remains ("One word: ready").
    Kept narrow so a genuine user-renamed title is not rewritten.
    */
    const LOOKS_RAW = /^((reply|respond|answer)\s+(with\s+)?)?(exactly|only|just|one\s+word|a\s+single\s+word|one\s+sentence)\b\s*[:,-]?/i;

    try {
        const chats = database.getChats();
        let repaired = 0;

        for (const chat of chats) {
            const title = String(chat.title || "");
            if (!LOOKS_RAW.test(title.trim())) continue;

            const messages = database.getChatMessages(chat.id);
            const firstUser = messages.find(m => m.role === "user");
            if (!firstUser) continue;

            const better = generateChatTitle(firstUser.content);
            if (better && better !== title) {
                database.renameChat(chat.id, better);
                repaired += 1;
            }
        }

        if (repaired) {
            console.log(
                "Repaired " + repaired + " legacy chat title(s)."
            );
        }
    } catch (error) {
        /* A failed migration must never stop the server starting. */
        console.error("Chat title repair skipped:", error.message);
    }
}

function updateAutomaticChatTitle(
    chatId,
    userMessage
) {
    const chat =
        database.getChat(chatId);

    if (
        !chat ||
        chat.title !== "New Chat"
    ) {
        return;
    }

    database.renameChat(
        chatId,
        generateChatTitle(
            userMessage
        )
    );
}

/*
==================================================
MEMORY
==================================================
*/

function isMemoryQuestion(
    message
) {
    return (
        /what do you remember about me/i.test(message) ||
        /what do you know about me/i.test(message) ||
        /what memories do you have about me/i.test(message) ||
        /tell me what you remember about me/i.test(message) ||
        /show me what you remember about me/i.test(message)
    );
}

function getMemoryDeletionKey(
    message
) {
    const text =
        String(message || "")
            .toLowerCase();

    if (
        /\b(forget|delete|remove)\b.*\bportfolio\b/
            .test(text)
    ) {
        return "user_favorite_project";
    }

    if (
        /\b(forget|delete|remove)\b.*\bjob\b/
            .test(text) ||
        /\b(forget|delete|remove)\b.*\brole\b/
            .test(text)
    ) {
        return "user_job_role";
    }

    if (
        /\b(forget|delete|remove)\b.*\bnexus\b/
            .test(text)
    ) {
        return "user_building_nexus_ai";
    }

    if (
        /\b(forget|delete|remove)\b.*\barticulate storyline\b/
            .test(text)
    ) {
        return "user_uses_articulate_storyline";
    }

    if (
        /\b(forget|delete|remove)\b.*\bcode\b/
            .test(text)
    ) {
        return "user_coding_preference";
    }

    return null;
}

function isExplicitMemoryStatement(
    message
) {
    const patterns = [
        /^remember that\b/i,
        /^remember this\b/i,
        /^please remember\b/i,
        /^please save this\b/i,
        /^save this to memory\b/i,
        /^save this in memory\b/i,
        /^save this as a memory\b/i,
        /^keep this in memory\b/i,
        /^keep this remembered\b/i,
        /^store this in memory\b/i,
        /^store this as a memory\b/i,
        /^add this to memory\b/i,
        /^add this to my memory\b/i,
        /^from now on,? remember\b/i,
        /^from now on remember\b/i,
        /^don't forget that\b/i,
        /^do not forget that\b/i
    ];

    return patterns.some(
        pattern =>
            pattern.test(
                String(message || "").trim()
            )
    );
}

function saveExplicitMemory(
    message
) {
    try {
        const memories =
            extractMemories(message);

        for (
            const item of memories || []
        ) {
            const key =
                normalizeMemoryKey(
                    item.key ||
                    item.type ||
                    item.name
                );

            if (!key) {
                continue;
            }

            memory.saveMemory(
                key,
                item.value
            );
        }

        return true;
    } catch (error) {
        console.error(
            "Memory save error:",
            error.message
        );

        return false;
    }
}

function buildMemoryResponse() {
    const memories =
        memory.getAllMemories();

    if (!memories.length) {
        return (
            "I don't have any saved long-term memories about you yet."
        );
    }

    return [
        "Here is what I currently remember:",
        "",
        ...memories.map(
            item =>
                `- ${item.key}: ${item.value}`
        )
    ].join("\n");
}

function getMemoryText() {
    const memories =
        memory.getAllMemories();

    if (!memories.length) {
        return "No saved long-term memories.";
    }

    return memories
        .map(
            item =>
                `${item.key}: ${item.value}`
        )
        .join("\n");
}

/*
==================================================
PROJECT PROMPT
==================================================
*/

function buildProjectText(
    project
) {
    if (!project) {
        return "No active project state.";
    }

    return [
        `Project: ${project.name}`,
        `Goal: ${project.goal}`,

        `Requirements: ${
            (project.requirements || [])
                .join(", ") || "None"
        }`,

        `Preferences: ${
            (project.preferences || [])
                .join(", ") || "None"
        }`,

        `Artifacts: ${
            (project.artifacts || [])
                .join(", ") || "None"
        }`,

        `Status: ${project.status}`
    ].join("\n");
}

/*
==================================================
OLLAMA PROMPT
==================================================
*/

function buildCapabilitiesText() {
    try {
        const tools = toolRegistry.list();
        const names = tools.map(t => t.name).sort();
        const groups = {};
        for (const n of names) {
            const g = n.split("_")[0];
            (groups[g] = groups[g] || []).push(n);
        }
        const lines = names.map(n => `- ${n}`);
        return [
            "TOOLS YOU CAN USE (registered in the tool registry — these are real, do not deny they exist):",
            lines.join("\n"),
            "",
            "AGENT CAPABILITIES:",
            "- workspace agent: create/read/update/delete/list files in the project workspace",
            "- terminal agent: run workspace-scoped commands (npm, node, tests, builds)",
            "- git agent: status, diff, log, commit",
            "- web agent: web_fetch (read URLs), web search",
            "- research agent: research_run — multi-step web research with sources and cross-checking",
            "- vision agent: vision_analyze — analyze images/screenshots with a vision model",
            "- database agent: db_query (read SQL), db_exec (write SQL) on SQLite databases",
            "- preview/build: run and verify web projects in the workspace"
        ].join("\n");
    } catch (e) {
        return "Tool registry unavailable.";
    }
}

function buildPrompt({
    userMessage,
    conversation,
    project,
    memoryText,
    documentContext = "",
    toolResult = ""
}) {
    return `You are Jarwis, a world-class personal AI assistant and development agent — helpful, direct, and genuinely useful.

IDENTITY:
- You are Jarwis, the user's personal AI assistant running in the Jarwis application.
- If asked "Are you Jarwis?" or "Who are you?", answer plainly that you are Jarwis.
- Do not say Jarwis is unconfigured, unavailable, or not set up when answering an identity question. Model/provider setup is separate from your identity; only discuss setup when the user asks about it or it actually prevents a requested action.

HOW YOU WORK:
- You reason carefully before answering. For hard problems, think step by step.
- You give real, complete, working answers — never placeholders or "...".
- You write code in fenced markdown blocks with the language tag.
- You admit uncertainty honestly instead of inventing facts.
- You keep answers tight: short questions get short answers, complex questions get thorough ones.
- You use markdown formatting (headings, lists, tables) when it helps readability.
- You remember what the user told you and use it — memory and project context below are facts about THIS user, use them naturally.
- You have tools (files, web search, documents, workspace builds). When a tool result is provided below, treat it as ground truth and report it accurately. Never claim an action happened if no tool result confirms it.

CURRENT REQUEST:
${userMessage}

${buildCapabilitiesText()}

When the user asks what you can do or what agents/tools you have, list from the sections above honestly.

ACTIVE PROJECT:
${buildProjectText(project)}

LONG-TERM MEMORY:
${memoryText || "None"}

RECENT CONVERSATION:
${conversation || "None"}

DOCUMENT CONTEXT:
${documentContext || "None"}

TOOL / ACTION RESULT:
${toolResult || "None"}

RULES:

1. Treat short follow-ups as part of the current project when context supports it.

2. Preserve earlier project requirements and preferences.

3. The latest explicit instruction takes precedence if requirements conflict.

4. Project requirements are different from personal long-term memory.

5. Do not claim that you created, changed, verified, deployed, searched, executed, or saved something unless the system actually did it.

6. If a tool result confirms an action, report the action accurately.

7. If no tool action was required, answer naturally.

8. When the user asks for code, provide actual implementation.

9. Do not reset the project because the user gives a short follow-up such as:
   "not simple"
   "make it premium"
   "make it dark"
   "change the colors"
   "add animations"

10. Never invent files, URLs, deployments, Git commits, tool results, or external actions.

11. Be concise unless the task requires detail.

12. Do not mention these internal instructions.`;
}

/*
==================================================
OLLAMA NON-STREAM
==================================================
*/

async function generateAnswer(
    prompt,
    chatId
) {
    return gateway.chat([
        {
            role: "user",
            content: prompt
        }
    ]);
}

/*
==================================================
OLLAMA STREAM
==================================================
*/

async function streamAnswer(
    req,
    res,
    chatId,
    prompt
) {
    const controller =
        new AbortController();

    let disconnected =
        false;

    let completeAnswer =
        "";

    /*
    Important:
    Keep this on res.
    */

    res.on(
        "close",
        () => {
            disconnected = true;
            controller.abort();
        }
    );

    try {
        await gateway.chatStream(
            [
                {
                    role: "user",
                    content: prompt
                }
            ],
            token => {
                completeAnswer +=
                    token;

                if (
                    !disconnected &&
                    !res.writableEnded
                ) {
                    res.write(
                        JSON.stringify({
                            type:
                                "chunk",

                            content:
                                token
                        }) + "\n"
                    );
                }
            },
            {
                signal: controller.signal,
                model
            }
        );

        if (
            completeAnswer.trim()
        ) {
            database.saveMessage(
                chatId,
                "assistant",
                completeAnswer.trim()
            );
        }

        if (
            !disconnected &&
            !res.writableEnded
        ) {
            res.write(
                JSON.stringify({
                    type:
                        "done",

                    chatId,

                    answer:
                        completeAnswer.trim()
                }) + "\n"
            );

            res.end();
        }
    } catch (error) {
        if (
            completeAnswer.trim()
        ) {
            database.saveMessage(
                chatId,
                "assistant",
                completeAnswer.trim()
            );
        }

        if (
            !disconnected &&
            !res.writableEnded &&
            error.name !== "AbortError"
        ) {
            res.write(
                JSON.stringify({
                    type:
                        "error",

                    message:
                        error.message
                }) + "\n"
            );

            res.end();
        }
    }
}

/*
// ------------------------------------------------
// CONVERSATION HISTORY
// ------------------------------------------------
Converts the stored conversation text back into
proper user/assistant messages for the gateway.
*/

function buildHistoryMessages(conversation) {
    const messages = [];

    const lines =
        String(conversation || "")
            .split(/\n+/)
            .map(l => l.trim())
            .filter(Boolean);

    for (const line of lines) {
        if (
            /^user:/i.test(line)
        ) {
            messages.push({
                role: "user",

                content: line
                    .replace(/^user:\s*/i, "")
            });
        } else if (
            /^(assistant|nexus):/i.test(line)
        ) {
            messages.push({
                role: "assistant",

                content: line
                    .replace(/^(assistant|nexus):\s*/i, "")
            });
        }
    }

    return messages;
}

/*
// ------------------------------------------------
// STREAM (MESSAGES VARIANT)
// ------------------------------------------------
Streaming variant that takes a full messages
array instead of a flat prompt.
*/

async function streamAnswerMessages(
    req,
    res,
    chatId,
    messages,
    model = null,
    metadata = {}
) {
    const controller =
        new AbortController();

    let disconnected =
        false;

    let completeAnswer = "";
    let actualCandidate = null;

    res.on(
        "close",
        () => {
            disconnected = true;
            controller.abort();
        }
    );

    /*
    Overall watchdog for the plain streaming call. Without it a
    stalled provider leaves the request open forever and the UI
    shows a spinner with no answer and no error.
    */
    const streamTimeoutMs = Number(
        process.env.NEXUS_STREAM_TIMEOUT_MS
    ) || config.LIMITS.requestTimeoutMs || 180000;

    const streamTimer = setTimeout(
        () => controller.abort(),
        streamTimeoutMs
    );
    const streamStartedAt = Date.now();
    const persistedMetadata = () => {
        const {
            candidates: _candidates,
            automatic: _automatic,
            selectionReason: _selectionReason,
            ...fields
        } = metadata;
        return fields;
    };

    try {
        const candidates = Array.isArray(metadata.candidates) &&
            metadata.candidates.length
            ? metadata.candidates
            : [{
                provider: metadata.provider || config.DEFAULT_PROVIDER,
                model: metadata.model || model || config.LOCAL_FALLBACK_MODEL
            }];

        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            let candidateAnswer = "";
            try {
                const stream = await providers.chat({
                    provider: candidate.provider,
                    model: candidate.model,
                    messages,
                    stream: true,
                    signal: controller.signal,
                    temperature: metadata.temperature ?? undefined,
                    topP: metadata.topP ?? undefined,
                    topK: metadata.topK ?? undefined,
                    maxTokens: metadata.maxTokens ?? undefined
                });
                for await (const event of stream) {
                    if (event.type !== "text_delta" || !event.text) continue;
                    candidateAnswer += event.text;
                    if (!disconnected && !res.writableEnded) {
                        res.write(JSON.stringify({
                            type: "chunk",
                            content: event.text
                        }) + "\n");
                    }
                }
                if (!candidateAnswer.trim()) {
                    throw new Error("The model returned an empty response.");
                }
                completeAnswer = candidateAnswer;
                actualCandidate = candidate;
                modelRegistry.router.recordOutcome({
                    provider: candidate.provider,
                    model: candidate.model,
                    task: metadata.task || "chat",
                    status: "success",
                    latencyMs: Date.now() - streamStartedAt
                });
                break;
            } catch (error) {
                if (candidateAnswer || controller.signal.aborted || index === candidates.length - 1) {
                    throw error;
                }
                modelRegistry.router.recordOutcome({
                    provider: candidate.provider,
                    model: candidate.model,
                    task: metadata.task || "chat",
                    status: "failure",
                    latencyMs: Date.now() - streamStartedAt
                });
                if (!disconnected && !res.writableEnded) {
                    res.write(JSON.stringify({
                        type: "activity",
                        message: "That model is unavailable; trying the next available option.",
                        status: "running"
                    }) + "\n");
                }
            }
        }

        if (!actualCandidate) {
            throw new Error("No available model could handle this request.");
        }

        if (completeAnswer.trim()) {
            database.saveMessage(
                chatId,
                "assistant",
                completeAnswer.trim(),
                {
                    ...persistedMetadata(),
                    provider: actualCandidate.provider,
                    model: actualCandidate.model
                }
            );
        }

        if (
            !disconnected &&
            !res.writableEnded
        ) {
            res.write(
                JSON.stringify({
                    type: "done",
                    chatId,

                    answer:
                        completeAnswer.trim(),
                    provider: actualCandidate.provider,
                    model: actualCandidate.model,
                    automatic: metadata.automatic === true,
                    fallback: actualCandidate.provider !== metadata.provider ||
                        actualCandidate.model !== metadata.model,
                    selectionReason: metadata.selectionReason || null
                }) + "\n"
            );

            res.end();
        }
    } catch (error) {
        if (completeAnswer.trim()) {
            database.saveMessage(
                chatId,
                "assistant",
                completeAnswer.trim(),
                {
                    ...persistedMetadata(),
                    provider: actualCandidate?.provider || metadata.provider,
                    model: actualCandidate?.model || metadata.model
                }
            );
        }

        if (
            !disconnected &&
            !res.writableEnded &&
            error.name !== "AbortError"
        ) {
            res.write(
                JSON.stringify({
                    type: "error",
                    message: "Jarwis could not reach an available model. Check provider status in Settings and try again."
                }) + "\n"
            );

            res.end();
        }

        /*
        An AbortError here with no partial text means the watchdog
        fired: the selected model did not finish in time. Tell the
        user explicitly instead of ending the stream silently.
        */
        if (
            error.name === "AbortError" &&
            !disconnected &&
            !res.writableEnded
        ) {
            res.write(
                JSON.stringify({
                    type: "done",
                    chatId,
                    answer:
                        completeAnswer.trim() ||
                        `The model did not respond within ${Math.round(streamTimeoutMs / 1000)}s. ` +
                        "Try a faster model or raise NEXUS_STREAM_TIMEOUT_MS.",
                    timedOut: true
                }) + "\n"
            );

            res.end();
        }
    } finally {
        clearTimeout(streamTimer);
    }
}

/*
==================================================
MCP CLIENTS
==================================================
*/

async function createNexusClient() {
    const client =
        new Client({
            name:
                "nexus-ai-client",

            version:
                NEXUS_VERSION
        });

    const transport =
        new StdioClientTransport({
            command:
                process.execPath,

            args: [
                require.resolve("./mcp/mcp-server.js")
            ]
        });

    await client.connect(
        transport
    );

    return {
        client,
        transport
    };
}

async function createWebClient() {
    const client =
        new Client({
            name:
                "nexus-web-client",

            version:
                NEXUS_VERSION
        });

    const transport =
        new StdioClientTransport({
            command:
                process.execPath,

            args: [
                require.resolve("./mcp/web-search-mcp-server.js")
            ]
        });

    await client.connect(
        transport
    );

    return {
        client,
        transport
    };
}

/*
==================================================
WEB
==================================================
*/

async function handleWebRequest(
    chatId,
    userMessage,
    conversation,
    project
) {
    const {
        client
    } =
        await createWebClient();

    try {
        const tools =
            await client.listTools();

        const action =
            await decideAction(
                userMessage,
                conversation,
                tools.tools || tools
            );

        let toolResult =
            "";

        if (
            action?.tool ===
                "web_search" ||
            action?.name ===
                "web_search"
        ) {
            const args =
                action.arguments ||
                action.args || {
                    query:
                        userMessage
                };

            const result =
                await client.callTool({
                    name:
                        "web_search",

                    arguments:
                        args
                });

            toolResult =
                JSON.stringify(
                    result
                );
        } else {
            toolResult =
                JSON.stringify({
                    availableTools:
                        tools.tools ||
                        tools,

                    message:
                        "No web action was selected."
                });
        }

        const answer =
            await generateAnswer(
                buildPrompt({
                    userMessage,
                    conversation,
                    project,

                    memoryText:
                        getMemoryText(),

                    toolResult
                })
            );

        database.saveMessage(
            chatId,
            "assistant",
            answer
        );

        return answer;
    } finally {
        try {
            await client.close();
        } catch {}
    }
}

/*
==================================================
DOCUMENTS
==================================================
*/

async function handleDocumentsRequest(
    chatId,
    userMessage,
    conversation,
    project
) {
    const {
        client
    } =
        await createNexusClient();

    try {
        const result =
            await client.callTool({
                name:
                    "list_documents",

                arguments: {}
            });

        const answer =
            await generateAnswer(
                buildPrompt({
                    userMessage,
                    conversation,
                    project,

                    memoryText:
                        getMemoryText(),

                    toolResult:
                        JSON.stringify(
                            result
                        )
                })
            );

        database.saveMessage(
            chatId,
            "assistant",
            answer
        );

        return answer;
    } finally {
        try {
            await client.close();
        } catch {}
    }
}

/*
==================================================
STATUS
==================================================
*/

async function handleStatusRequest(
    chatId,
    userMessage,
    conversation,
    project
) {
    const {
        client
    } =
        await createNexusClient();

    try {
        const result =
            await client.callTool({
                name:
                    "get_nexus_status",

                arguments: {}
            });

        const answer =
            await generateAnswer(
                buildPrompt({
                    userMessage,
                    conversation,
                    project,

                    memoryText:
                        getMemoryText(),

                    toolResult:
                        JSON.stringify(
                            result
                        )
                })
            );

        database.saveMessage(
            chatId,
            "assistant",
            answer
        );

        return answer;
    } finally {
        try {
            await client.close();
        } catch {}
    }
}

/*
==================================================
RAG
==================================================
*/

async function handleRagRequest(
    chatId,
    userMessage,
    conversation,
    project
) {
    const results =
        await retrieveContext(
            userMessage,
            5
        );

    const documentContext =
        buildContext(results);

    const answer =
        await generateAnswer(
            buildPrompt({
                userMessage,
                conversation,
                project,

                memoryText:
                    getMemoryText(),

                documentContext
            })
        );

    database.saveMessage(
        chatId,
        "assistant",
        answer
    );

    return answer;
}

/*
==================================================
DIRECT
==================================================
*/

async function handleDirectRequest(
    req,
    res,
    chatId,
    userMessage,
    conversation,
    project
) {
    const runtimeSnapshot = await modelRegistry.runtime.refresh();
    const selectedModel =
        typeof req.body?.model === "string" &&
        req.body.model.trim()
            ? req.body.model.trim()
            : null;
    const requestedProvider =
        typeof req.body?.provider === "string" &&
        req.body.provider.trim()
            ? req.body.provider.trim().toLowerCase()
            : null;

    const intelligence =
        typeof req.body?.intelligence === "string" &&
        req.body.intelligence.trim()
            ? req.body.intelligence.trim()
            : "balanced";

    const task =
        typeof req.body?.task === "string" && req.body.task.trim()
            ? req.body.task.trim().toLowerCase()
            : "chat";

    /*
    Agent selection.

    An explicit `agent` from the client (the user pinned one, or the UI
    already routed the message) wins. Otherwise the agent is derived
    from the task, which is the automatic path.
    */
    const requestedAgent =
        typeof req.body?.agent === "string" && req.body.agent.trim()
            ? req.body.agent.trim().toLowerCase()
            : null;

    const selectedAgent =
        (requestedAgent && agentRegistry.get(requestedAgent)) ||
        agentRegistry.resolveForTask(task);

    const routingDecision =
        resolveRuntimeRouting({
            task,
            intelligence,
            provider: requestedProvider || undefined,
            model: selectedModel,
            preferLocal: req.body?.preferLocal !== false,
            contextTokens: req.body?.contextTokens,
            allowPaid: Boolean(selectedModel || requestedProvider)
        });

    const automaticCandidates = selectedModel
        ? [{
            provider: requestedProvider || config.DEFAULT_PROVIDER,
            model: selectedModel,
            local: (requestedProvider || config.DEFAULT_PROVIDER) === "ollama"
        }]
        : routingDecision.candidates
            .map(candidate => ({
                provider: candidate.provider,
                model: candidate.model,
                local: candidate.local
            }))
            .filter(candidate => modelPolicy.allowsPaidAutomatic({
                intelligence,
                contextTokens: req.body?.contextTokens,
                allowPaid: Boolean(requestedProvider)
            }) || modelPolicy.isKnownFreeTierCandidate(candidate))
            .slice(0, 3);
    const fallbackCandidates = automaticCandidates.filter((candidate, index) =>
        index === 0 ||
        modelPolicy.isFallbackEligible(candidate)
    );
    if (!fallbackCandidates.length) {
        return res.status(503).json({
            error: routingDecision.rationale?.reasons?.[0] ||
                "No configured model is currently available.",
            paidAlternativesAvailable: routingDecision.paidAlternativesAvailable
        });
    }
    const initialCandidate = automaticCandidates[0] || null;
    let actualCandidate = initialCandidate;
    let automaticModel = initialCandidate?.model || selectedModel || null;

    const requestedTemperature = Number(req.body?.temperature);
    const requestedMaxTokens = Number(req.body?.maxTokens);
    const requestedMaxSteps = Number(req.body?.maxAgentSteps);
    const requestedTopP = Number(req.body?.topP);
    const requestedTopK = Number(req.body?.topK);
    const requestedRepetitionPenalty = Number(req.body?.repetitionPenalty);
    const requestedSeed = Number(req.body?.seed);
    const allowedTools = Array.isArray(req.body?.tools)
        ? req.body.tools.filter(name => typeof name === "string")
        : null;
    const execution = {
        maxSteps: Math.min(config.LIMITS.maxAgentSteps, Math.max(1,
            Number.isFinite(requestedMaxSteps)
                ? requestedMaxSteps
                : routingDecision.profile.maxAgents * 2)),
        toolNames: allowedTools,
        temperature: Number.isFinite(requestedTemperature)
            ? Math.min(2, Math.max(0, requestedTemperature))
            : null,
        maxTokens: Number.isFinite(requestedMaxTokens)
            ? Math.min(32768, Math.max(64, requestedMaxTokens))
            : null,
        /* Advanced sampling. Bounded so a bad value cannot break a call. */
        topP: Number.isFinite(requestedTopP)
            ? Math.min(1, Math.max(0.01, requestedTopP))
            : null,
        topK: Number.isFinite(requestedTopK)
            ? Math.min(200, Math.max(0, requestedTopK))
            : null,
        repetitionPenalty: Number.isFinite(requestedRepetitionPenalty)
            ? Math.min(2, Math.max(0.1, requestedRepetitionPenalty))
            : null,
        seed: Number.isFinite(requestedSeed) ? requestedSeed : null
    };
    const imageModel =
        typeof req.body?.imageModel === "string" &&
        req.body.imageModel.trim()
            ? req.body.imageModel.trim().slice(0, 200)
            : null;
    let routedProvider =
        initialCandidate?.provider ||
        requestedProvider ||
        null;

    const routeStartedAt = Date.now();
    const recordRouteOutcome = (status, candidate = actualCandidate) => {
        if (!candidate?.model || !candidate?.provider) return;
        try {
            modelRegistry.router.recordOutcome({
                provider: candidate.provider,
                model: candidate.model,
                task,
                status,
                latencyMs: Date.now() - routeStartedAt
            });
        } catch (error) {
            console.warn("Model telemetry was not recorded:", error.message);
        }
    };

    const modelAttribution = () => ({
        provider: actualCandidate?.provider || routedProvider,
        model: actualCandidate?.model || automaticModel,
        automatic: !selectedModel && !requestedProvider,
        fallback: Boolean(
            actualCandidate &&
            initialCandidate &&
            (actualCandidate.provider !== initialCandidate.provider ||
                actualCandidate.model !== initialCandidate.model)
        ),
        selectionReason: routingDecision.rationale?.reasons?.[0] || null,
        runtimeCheckedAt: runtimeSnapshot.checkedAt
    });

    /*
    ChatGPT/Claude-style: the system prompt carries
    persona + context, and the real conversation
    history is sent as proper alternating messages.
    */

    const systemPrompt =
        buildPrompt({
            userMessage: "",
            conversation: "",
            project,

            memoryText:
                getMemoryText()
        }) + `\n\nExecution policy: use the ${selectedAgent.name} for this ${task} request. Follow its allowed tools and approval policy.`;

    const messages = [
        {
            role: "system",
            content: systemPrompt
        },

        ...buildHistoryMessages(conversation),

        {
            role: "user",
            content: userMessage
        }
    ];

    const wantsStream =
        req.body?.stream !== false &&
        (
            req.headers.accept ||
            ""
        ).includes(
            "application/x-ndjson"
        );

    /*
    Tool-loop mode: the model sees the tool
    registry and can call tools across multiple
    steps. Runs for every streaming request —
    even when headers are already sent (the
    NDJSON fallthrough from the workspace
    agent), because the loop just writes
    activity/chunk/done events to the open
    stream. Falls back to plain streaming if
    the provider cannot do tool calls.
    */

    if (wantsStream) {
        if (!res.headersSent) {
            res.status(200);

            res.setHeader(
                "Content-Type",
                "application/x-ndjson; charset=utf-8"
            );

            res.setHeader(
                "Cache-Control",
                "no-cache"
            );

            res.setHeader(
                "Connection",
                "keep-alive"
            );
        }

        const controller =
            new AbortController();

        let disconnected = false;
        let streamedAnswer = "";

        res.on(
            "close",
            () => {
                disconnected = true;

                controller.abort();
            }
        );

        try {
            /*
            Bound the agent loop.

            The loop can legitimately take a while on a large
            task, but it must never hold the HTTP request open
            indefinitely: a small local model that stalls would
            otherwise leave the browser waiting forever with no
            answer and no error. NEXUS_AGENT_LOOP_TIMEOUT_MS
            defaults to two minutes; on expiry the loop is
            aborted and the plain streaming fallback below still
            produces an answer.
            */
            const loopTimeoutMs = Number(
                process.env.NEXUS_AGENT_LOOP_TIMEOUT_MS
            ) || 120000;

            const loopController =
                new AbortController();

            const forwardAbort = () => loopController.abort();
            controller.signal.addEventListener(
                "abort",
                forwardAbort,
                { once: true }
            );

            const loopTimer = setTimeout(
                () => loopController.abort(),
                loopTimeoutMs
            );

            let result;

            try {
                const attempt = await modelFallback.runWithFallback({
                    candidates: fallbackCandidates,
                    signal: loopController.signal,
                    onOutcome: recordRouteOutcome,
                    onRetry: () => {
                        if (streamedAnswer && !disconnected && !res.writableEnded) {
                            streamedAnswer = "";
                            res.write(JSON.stringify({ type: "reset" }) + "\n");
                        }
                    },
                    onActivity: event => {
                        if (!disconnected && !res.writableEnded) {
                            res.write(JSON.stringify({
                                type: "activity",
                                message: event.message,
                                status: event.status
                            }) + "\n");
                        }
                    },
                    run: (candidate, onAttemptActivity) => agentLoop.run({
                        userMessage,
                        system: systemPrompt,
                        messages,
                        signal: loopController.signal,
                        provider: candidate.provider,
                        model: candidate.model,
                        imageModel,
                        ...execution,
                        onActivity: onAttemptActivity,
                        onToken: token => {
                            if (!disconnected && !res.writableEnded) {
                                streamedAnswer += token;
                                res.write(JSON.stringify({
                                    type: "chunk",
                                    content: token
                                }) + "\n");
                            }
                        }
                    })
                });
                result = attempt.result;
                actualCandidate = attempt.candidate;
                automaticModel = actualCandidate.model;
                routedProvider = actualCandidate.provider;

            const answer =
                result.answer ||
                streamedAnswer;

            if (
                !answer &&
                !disconnected &&
                !res.writableEnded
            ) {
                throw new Error(
                    "Agent loop returned an empty answer."
                );
            }

            if (
                answer &&
                !disconnected
            ) {
                database.saveMessage(
                    chatId,
                    "assistant",
                    answer,
                    {
                        ...modelAttribution(),
                        intelligence,
                        toolRuns:
                            result.toolRuns || []
                    }
                );
            }

            if (
                !disconnected &&
                !res.writableEnded
            ) {
                res.write(
                    JSON.stringify({
                        type: "done",

                        chatId,

                            agent: selectedAgent.id,

                            answer:
                            answer,

                        toolRuns:
                            result.toolRuns,
                        ...modelAttribution()
                    }) + "\n"
                );

                res.end();
            }

            return;
            } finally {
                /*
                Always stop the watchdog timer and detach the
                outer abort listener, whatever the loop did.
                */
                clearTimeout(loopTimer);
                controller.signal.removeEventListener(
                    "abort",
                    forwardAbort
                );
            }
        } catch (loopError) {
            /*
            The loop failed or timed out — most likely the
            active provider/model cannot do tool calling, or a
            slow model exceeded the loop budget. Fall back to
            the plain streaming path below rather than failing
            (or hanging) the user's message.
            */
            console.error(
                "Agent loop failed, falling back to plain chat:",
                loopError.message
            );

            if (
                disconnected ||
                res.writableEnded
            ) {
                return;
            }
            if (loopError.toolStarted) {
                res.write(JSON.stringify({
                    type: "error",
                    message: "A tool action already started, so automatic model retries were stopped to avoid repeating it. Review the activity and workspace before trying again."
                }) + "\n");
                res.end();
                return;
            }
            res.write(JSON.stringify({
                type: "error",
                message: "Jarwis could not reach an available model after trying safe alternatives. Check provider status in Settings and try again."
            }) + "\n");
            res.end();
            return;
        }

    }

    /*
    Non-streaming path: also use the tool loop
    so the model can act, then answer.
    */

    try {
        const attempt = await modelFallback.runWithFallback({
            candidates: fallbackCandidates,
            onOutcome: recordRouteOutcome,
            run: (candidate, onAttemptActivity) => agentLoop.run({
                userMessage,
                system: systemPrompt,
                messages,
                provider: candidate.provider,
                model: candidate.model,
                ...execution,
                onActivity: onAttemptActivity
            })
        });
        const result = attempt.result;
        actualCandidate = attempt.candidate;
        automaticModel = actualCandidate.model;
        routedProvider = actualCandidate.provider;

        if (!result.answer) {
            throw new Error(
                "Agent loop returned an empty answer."
            );
        }

        database.saveMessage(
            chatId,
            "assistant",
            result.answer,
            {
                ...modelAttribution(),
                intelligence,
                toolRuns:
                    result.toolRuns || []
            }
        );

        return res.json({
            type: "done",
            chatId,
            answer: result.answer,
            toolRuns: result.toolRuns,
            ...modelAttribution()
        });
    } catch (loopError) {
        if (loopError.toolStarted) {
            return res.status(502).json({
                error: "A tool action already started, so automatic model retries were stopped to avoid repeating it. Review the activity and workspace before trying again."
            });
        }
        console.warn("All safe model attempts failed:", loopError.message);
        return res.status(503).json({
            error: "Jarwis could not reach an available model. Check the provider status in Settings and try again."
        });
    }
}

/*
==================================================
CHAT ROUTES
==================================================
*/

app.get(
    "/api/chats",
    (req, res) => {
        res.json(
            database.getChats()
        );
    }
);

app.post(
    "/api/chats",
    security.requireCapability("WRITE"),
    (req, res) => {
        const title =
            String(
                req.body?.title ||
                "New Chat"
            )
                .trim() ||
            "New Chat";

        const chat =
            database.createChat(
                title,
                MODEL
            );

        res.json(chat);
    }
);

app.get(
    "/api/chats/:id",
    (req, res) => {
        const chat =
            database.getChat(
                req.params.id
            );

        if (!chat) {
            return res.status(404).json({
                error:
                    "Chat not found."
            });
        }

        res.json({
            chat,

            messages:
                database.getChatMessages(
                    req.params.id
                ),

            project:
                projectState.get(
                    chat.project_id || req.params.id
                )
        });
    }
);

app.patch(
    "/api/chats/:id",
    security.requireCapability("WRITE"),
    (req, res) => {
        const title =
            String(
                req.body?.title || ""
            ).trim();

        if (!title) {
            return res.status(400).json({
                error:
                    "Title is required."
            });
        }

        const chat =
            database.renameChat(
                req.params.id,
                title
            );

        res.json(chat);
    }
);

app.patch(
    "/api/chats/:id/pin",
    security.requireCapability("WRITE"),
    (req, res) => {
        const pinned =
            Boolean(
                req.body?.pinned
            );

        res.json(
            database.setChatPinned(
                req.params.id,
                pinned
            )
        );
    }
);

app.patch(
    "/api/chats/:id/project",
    security.requireCapability("WRITE"),
    (req, res) => {
        const chat = database.getChat(req.params.id);
        if (!chat) return res.status(404).json({ error: "Chat not found." });

        const requestedProjectId = req.body?.projectId;
        if (requestedProjectId !== null && requestedProjectId !== undefined && requestedProjectId !== "") {
            const projectId = String(requestedProjectId).trim();
            if (!/^\d+$/.test(projectId) || !projectState.get(projectId)) {
                return res.status(404).json({ error: "Project not found." });
            }
            if (Number(projectId) === Number(chat.id)) {
                return res.status(400).json({ error: "A project cannot contain itself as a chat." });
            }
            return res.json(database.setChatProject(chat.id, Number(projectId)));
        }

        return res.json(database.setChatProject(chat.id, null));
    }
);

app.delete(
    "/api/chats/:id",
    security.requireCapability("DELETE"),
    (req, res) => {
        const id =
            req.params.id;

        database.deleteChat(id);

        projectState.clear(id);

        res.json({
            success:
                true
        });
    }
);

app.get("/api/projects", (req, res) => {
    const projects = Object.values(projectState.getAll())
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    res.json({ projects });
});

app.post(
    "/api/projects",
    security.requireCapability("WRITE"),
    (req, res) => {
        const name = String(req.body?.name || "").trim();
        if (!name) return res.status(400).json({ error: "Project name is required." });
        const chat = database.createChat(name, MODEL);
        const project = projectState.save(chat.id, {
            name,
            goal: String(req.body?.goal || "").trim(),
            status: "in_progress"
        });
        res.status(201).json({ chat, project });
    }
);

app.get("/api/projects/:chatId", (req, res) => {
    const projectId = String(req.params.chatId || "").trim();
    const project = projectState.get(projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    return res.json({
        project,
        chat: database.getChat(projectId),
        chats: database.getProjectChats(Number(projectId))
    });
});

app.patch(
    "/api/projects/:chatId",
    security.requireCapability("WRITE"),
    (req, res) => {
        const projectId = String(req.params.chatId || "").trim();
        const existing = projectState.get(projectId);
        if (!existing) return res.status(404).json({ error: "Project not found." });
        const name = req.body?.name === undefined
            ? existing.name
            : String(req.body.name).trim();
        const goal = req.body?.goal === undefined
            ? existing.goal
            : String(req.body.goal).trim();
        if (!name) return res.status(400).json({ error: "Project name is required." });

        const project = projectState.save(projectId, { ...existing, name, goal });
        const chat = database.renameChat(projectId, name);
        return res.json({ project, chat });
    }
);

app.delete(
    "/api/projects/:chatId",
    security.requireCapability("DELETE"),
    (req, res) => {
        const chatId = String(req.params.chatId || "").trim();
        if (!projectState.get(chatId)) {
            return res.status(404).json({ error: "Project not found." });
        }

        try {
            const projectRoot = `projects/${chatId}`;
            const absolute = workspaceTools.resolveWorkspacePath(projectRoot);
            if (fs.existsSync(absolute)) {
                workspaceTools.deleteFolder(projectRoot);
            }
            for (const chat of database.getProjectChats(Number(chatId))) {
                database.setChatProject(chat.id, null);
            }
            projectState.clear(chatId);
            database.deleteChat(chatId);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({
                error: error?.message || "Could not delete project."
            });
        }
    }
);

/*
==================================================
PROJECT API
==================================================
*/

app.get(
    "/api/project/:chatId",
    (req, res) => {
        res.json({
            project:
                projectState.get(
                    req.params.chatId
                )
        });
    }
);

app.delete(
    "/api/project/:chatId",
    security.requireCapability("DELETE"),
    (req, res) => {
        projectState.clear(
            req.params.chatId
        );

        res.json({
            success:
                true
        });
    }
);

/*
List the files attached to a project.

Attachments live under projects/<chatId>/uploads inside the
active workspace, so this reads that folder and reports the
files back. A missing folder simply means nothing is attached
yet, which is not an error.
*/
app.get(
    "/api/project/:chatId/files",
    (req, res) => {
        const chatId = String(req.params.chatId || "").trim();

        if (!projectState.get(chatId)) {
            return res.status(404).json({
                error: "Project not found."
            });
        }

        try {
            const uploadRoot = `projects/${chatId}/uploads`;
            const absolute = workspaceTools.resolveWorkspacePath(uploadRoot);

            if (!fs.existsSync(absolute)) {
                return res.json({ files: [] });
            }

            const files = fs
                .readdirSync(absolute, { withFileTypes: true })
                .filter(entry => entry.isFile())
                .map(entry => {
                    const stat = fs.statSync(
                        path.join(absolute, entry.name)
                    );

                    return {
                        name: entry.name,
                        size: stat.size,
                        path: `${uploadRoot}/${entry.name}`,
                        modifiedAt: stat.mtime.toISOString()
                    };
                });

            res.json({ files });
        } catch (error) {
            res.status(500).json({
                error:
                    error?.message ||
                    "Could not list project files."
            });
        }
    }
);

app.delete(
    "/api/project/:chatId/files/:name",
    security.requireCapability("DELETE"),
    (req, res) => {
        const chatId = String(req.params.chatId || "").trim();
        const name = String(req.params.name || "");
        if (!projectState.get(chatId)) {
            return res.status(404).json({ error: "Project not found." });
        }
        if (!name || name === "." || name === ".." || path.basename(name) !== name) {
            return res.status(400).json({ error: "The project filename is invalid." });
        }

        try {
            const filePath = `projects/${chatId}/uploads/${name}`;
            const absolute = workspaceTools.resolveWorkspacePath(filePath);
            if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
                return res.status(404).json({ error: "Project file not found." });
            }
            workspaceTools.deleteFile(filePath);
            res.json({ success: true, path: filePath });
        } catch (error) {
            res.status(400).json({
                error: error?.message || "Could not delete project file."
            });
        }
    }
);

/*
==================================================
WORKSPACE API
==================================================
*/

app.get(
    "/api/workspace",
    (req, res) => {
        try {
            res.json({
                root:
                    workspaceTools.getWorkspaceRoot(),

                tree:
                    workspaceTools.getWorkspaceTree()
            });
        } catch (error) {
            res.status(500).json({
                error:
                    error.message
            });
        }
    }
);

app.get(
    "/api/workspace/files",
    (req, res) => {
        try {
            res.json(
                workspaceTools.listFiles(
                    String(
                        req.query.path ||
                        ""
                    )
                )
            );
        } catch (error) {
            res.status(400).json({
                error:
                    error.message
            });
        }
    }
);

app.get(
    "/api/workspace/download",
    (req, res, next) => {
        try {
            const filePath = String(req.query.path || "");
            const absolute = workspaceTools.resolveWorkspacePath(filePath);
            if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
                return res.status(404).json({ error: "File not found." });
            }
            const workspaceRoot = fs.realpathSync(workspaceTools.getWorkspaceRoot());
            const fileRealPath = fs.realpathSync(absolute);
            const relative = path.relative(workspaceRoot, fileRealPath);
            if (relative.startsWith("..") || path.isAbsolute(relative)) {
                return res.status(403).json({
                    error: "Access denied: file resolves outside the Nexus workspace."
                });
            }
            res.download(fileRealPath, path.basename(fileRealPath), error => {
                if (error && !res.headersSent) next(error);
            });
        } catch (error) {
            res.status(400).json({
                error: error?.message || "Could not download workspace file."
            });
        }
    }
);

app.post(
    "/api/workspace/upload",
    security.requireCapability("WRITE"),
    (req, res) => {
        try {
            const files = Array.isArray(req.body?.files)
                ? req.body.files
                : [];

            if (!files.length) {
                return res.status(400).json({
                    error: "At least one file is required."
                });
            }

            if (files.length > 20) {
                return res.status(400).json({
                    error: "A maximum of 20 files can be uploaded at once."
                });
            }

            const projectId = String(req.body?.projectId || "").trim();
            if (projectId && !projectState.get(projectId)) {
                return res.status(404).json({ error: "Project not found." });
            }
            const uploadRoot = projectId
                ? `projects/${projectId}/uploads`
                : "uploads";

            const uploaded = files.map(file => {
                const name = String(file?.name || "").trim();
                const content = String(file?.content || "");
                const encoding = file?.encoding === "base64"
                    ? "base64"
                    : "utf8";

                if (!name || name.includes("\0")) {
                    throw new Error("Invalid upload filename.");
                }

                if (Buffer.byteLength(content, "utf8") > 7 * 1024 * 1024) {
                    throw new Error(`Upload is too large: ${name}`);
                }

                const relativePath =
                    `${uploadRoot}/${name.replace(/^[\\/]+/, "")}`;
                workspaceTools.resolveWorkspacePath(
                    relativePath
                );
                const decoded = encoding === "base64"
                    ? Buffer.from(content, "base64")
                    : Buffer.from(content, "utf8");

                if (decoded.length > 5 * 1024 * 1024) {
                    throw new Error(`Upload exceeds the 5 MB limit: ${name}`);
                }

                const result = workspaceTools.createFile(
                    relativePath,
                    decoded
                );

                return {
                    path: result.path,
                    size: decoded.length
                };
            });

            res.status(201).json({
                success: true,
                files: uploaded
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    }
);

app.get(
    "/api/workspace/file",
    (req, res) => {
        try {
            const filePath =
                String(
                    req.query.path ||
                    ""
                );

            res.json({
                path:
                    filePath,

                content:
                    workspaceTools.readFile(
                        filePath
                    )
            });
        } catch (error) {
            res.status(400).json({
                error:
                    error.message
            });
        }
    }
);

app.post(
    "/api/workspace/file",
    security.requireCapability("WRITE"),
    (req, res) => {
        try {
            const filePath =
                String(
                    req.body?.path ||
                    ""
                );

            const content =
                String(
                    req.body?.content ||
                    ""
                );

            workspaceTools.createFile(
                filePath,
                content
            );

            res.json({
                success:
                    true,

                path:
                    filePath,

                verified:
                    workspaceTools.fileExists(
                        filePath
                    )
            });
        } catch (error) {
            res.status(400).json({
                error:
                    error.message
            });
        }
    }
);

app.put(
    "/api/workspace/file",
    security.requireCapability("WRITE"),
    (req, res) => {
        try {
            const filePath =
                String(
                    req.body?.path ||
                    ""
                );

            const content =
                String(
                    req.body?.content ||
                    ""
                );

            workspaceTools.updateFile(
                filePath,
                content
            );

            res.json({
                success:
                    true,

                path:
                    filePath,

                verified:
                    workspaceTools.fileExists(
                        filePath
                    )
            });
        } catch (error) {
            res.status(400).json({
                error:
                    error.message
            });
        }
    }
);

app.delete(
    "/api/workspace/file",
    security.requireCapability("DELETE"),
    (req, res) => {
        try {
            const filePath =
                String(
                    req.query.path ||
                    ""
                );

            workspaceTools.deleteFile(
                filePath
            );

            res.json({
                success:
                    true,

                path:
                    filePath,

                exists:
                    workspaceTools.fileExists(
                        filePath
                    )
            });
        } catch (error) {
            res.status(400).json({
                error:
                    error.message
            });
        }
    }
);

/*
==================================================
MEMORY API
==================================================
*/

app.get(
    "/api/memories",
    (req, res) => {
        res.json(
            memory.getAllMemories()
        );
    }
);

/*
Delete a single saved memory by key.
*/
app.delete(
    "/api/memory/:key",
    security.requireCapability("DELETE"),
    (req, res) => {
        const key = String(req.params.key || "").trim();

        if (!key) {
            return res.status(400).json({ error: "A memory key is required." });
        }

        memory.deleteMemory(key);

        security.audit({
            action: "memory.delete",
            actor: req.nexusUser?.username || "local",
            target: key
        });

        res.json({ success: true });
    }
);

/*
Delete every saved memory. Exposed as DELETE /api/memories so
Data controls can clear memory without deleting conversations.
*/
app.delete(
    "/api/memories",
    security.requireCapability("DELETE"),
    (req, res) => {
        const memories = memory.getAllMemories();

        memories.forEach(item => memory.deleteMemory(item.key));

        security.audit({
            action: "memory.clear",
            actor: req.nexusUser?.username || "local",
            detail: { removed: memories.length }
        });

        res.json({
            success: true,
            removed: memories.length
        });
    }
);

app.post(
    "/api/memories",
    security.requireCapability("WRITE"),
    (req, res) => {
        const key = String(req.body?.key || "").trim();
        const value = String(req.body?.value || "").trim();
        if (!key || !value) {
            return res.status(400).json({ error: "Both a key and a value are required." });
        }
        memory.saveMemory(key, value);
        security.audit({
            action: "memory.save",
            actor: req.nexusUser?.username || "local",
            target: key
        });
        res.json({ success: true, key, value });
    }
);

app.put(
    "/api/memory/:key",
    security.requireCapability("WRITE"),
    (req, res) => {
        const key = String(req.params.key || "").trim();
        const value = String(req.body?.value || "").trim();
        if (!key || !value) {
            return res.status(400).json({ error: "A memory key and value are required." });
        }
        if (!memory.getMemory(key)) {
            return res.status(404).json({ error: "Memory not found." });
        }
        memory.updateMemory(key, value);
        security.audit({
            action: "memory.update",
            actor: req.nexusUser?.username || "local",
            target: key
        });
        res.json({ success: true, key, value });
    }
);

app.get(
    "/api/knowledge/documents",
    (req, res) => {
        res.json({ documents: knowledge.listDocuments() });
    }
);

app.post(
    "/api/knowledge/documents",
    security.requireCapability("WRITE"),
    async (req, res) => {
        try {
            const result = await knowledge.ingestUpload({
                name: req.body?.name,
                content: req.body?.content,
                encoding: req.body?.encoding
            });
            security.audit({
                action: "knowledge.index",
                actor: req.nexusUser?.username || "local",
                target: result.name,
                detail: { chunks: result.chunks }
            });
            res.json(result);
        } catch (error) {
            res.status(400).json({
                error: error.message || "Could not index that document."
            });
        }
    }
);

app.delete(
    "/api/knowledge/documents/:name",
    security.requireCapability("DELETE"),
    (req, res) => {
        try {
            const result = knowledge.deleteDocument(req.params.name);
            security.audit({
                action: "knowledge.delete",
                actor: req.nexusUser?.username || "local",
                target: result.name
            });
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message || "Could not remove that document." });
        }
    }
);

app.post(
    "/api/settings/providers",
    security.requireCapability("ADMIN"),
    (req, res) => {
        try {
            const result = config.persistEnvValues(req.body || {});
            security.audit({
                action: "settings.providers",
                actor: req.nexusUser?.username || "local",
                detail: { saved: result.saved }
            });
            res.json({
                success: true,
                saved: result.saved,
                message: "Keys saved on this machine. Jarwis will use them on the next model call."
            });
        } catch (error) {
            res.status(400).json({ error: error.message || "Could not save provider settings." });
        }
    }
);

app.post(
    "/api/clear",
    security.requireCapability("DELETE"),
    (req, res) => {
        database.clearAllChats();

        res.json({
            success:
                true
        });
    }
);

/*
Archive or restore a single conversation.
POST /api/chat/:id/archive  { archived: true|false }
*/
app.post(
    "/api/chat/:id/archive",
    security.requireCapability("WRITE"),
    (req, res) => {
        const chatId = Number(req.params.id);

        if (!Number.isFinite(chatId)) {
            return res.status(400).json({ error: "A numeric chat id is required." });
        }

        const archived = req.body?.archived !== false;
        const changed = database.setArchived(chatId, archived);

        security.audit({
            action: archived ? "chat.archive" : "chat.unarchive",
            actor: req.nexusUser?.username || "local",
            target: String(chatId)
        });

        res.json({ success: true, changed });
    }
);

/*
Archive or restore every conversation at once.
POST /api/chats/archive  { archived: true|false }
*/
app.post(
    "/api/chats/archive",
    security.requireCapability("WRITE"),
    (req, res) => {
        const archived = req.body?.archived !== false;
        const changed = database.setArchived(null, archived);

        security.audit({
            action: archived ? "chats.archiveAll" : "chats.unarchiveAll",
            actor: req.nexusUser?.username || "local",
            detail: { changed }
        });

        res.json({ success: true, changed });
    }
);

/*
Delete every conversation. DELETE /api/chats complements
POST /api/clear for clients that prefer REST semantics.
*/
app.delete(
    "/api/chats",
    security.requireCapability("DELETE"),
    (req, res) => {
        const chats = database.getChats();

        database.clearAllChats();

        security.audit({
            action: "chats.clear",
            actor: req.nexusUser?.username || "local",
            detail: { removed: chats.length }
        });

        res.json({
            success: true,
            removed: chats.length
        });
    }
);

/*
==================================================
STATUS API
==================================================
*/

app.get(
    "/api/status",
    (req, res) => {
        const chats =
            database.getChats();

        const memories =
            memory.getAllMemories();

        res.json({
            nexus: {
                name:
                    "Jarwis",

                version:
                    NEXUS_VERSION,

                model:
                    MODEL,

                streaming:
                    true,

                agentFoundation:
                    true,

                agentLoop:
                    "understand-plan-act-verify",

                conversationContext:
                    true,

                persistentProjectState:
                    true,

                projectContext:
                    true,

                workspace:
                    true,

                artifactCreation:
                    true,

                artifactModification:
                    true,

                artifactVerification:
                    true,

                memory:
                    true,

                rag:
                    true,

                webTools:
                    true,

                mcp:
                    true
            },

            workspace: {
                root:
                    workspaceTools.getWorkspaceRoot()
            },

            statistics: {
                chats:
                    chats.length,

                memories:
                    memories.length,

                tools:
                    toolRegistry.list().length,

                tasks:
                    taskEngine.listTasks().length
            },

            providers: {
                active:
                    gateway.getActiveProvider(),

                roles:
                    providers.describeRoles()
            }
        });
    }
);

app.get(
    "/api/health",
    (req, res) => {
        const health = {
            ok: true,
            service: "jarwis",
            product: config.PRODUCT_NAME,
            version: NEXUS_VERSION,
            uptimeSeconds: Math.round(process.uptime()),
            tools: toolRegistry.list().filter(
                tool => tool.runnable
            ).length
        };

        try {
            workspaceTools.ensureWorkspace();
        } catch {
            health.ok = false;
        }

        res.status(health.ok ? 200 : 503).json(health);
    }
);

/*
==================================================
REGENERATE
==================================================
*/

app.post(
    "/api/chats/:id/regenerate",
    security.requireCapability("WRITE"),
    async (req, res) => {
        const chatId =
            req.params.id;

        const chat =
            database.getChat(
                chatId
            );

        if (!chat) {
            return res.status(404).json({
                error:
                    "Chat not found."
            });
        }

        try {
            const messages =
                database.getChatMessages(
                    chatId
                );

            const lastUser =
                [...messages]
                    .reverse()
                    .find(
                        message =>
                            message.role ===
                            "user"
                    );

            if (!lastUser) {
                return res.status(400).json({
                    error:
                        "No user message to regenerate."
                });
            }

            database.deleteMessagesAfter(
                chatId,
                lastUser.id
            );

            const history =
                getHistoryBeforeCurrent(
                    chatId,
                    lastUser.id,
                    12
                );

            const userMessage =
                lastUser.content;

            const agent =
                await agentCore.run({
                    chatId,

                    userMessage,

                    conversation:
                        history,

                    executeWorkspaceActions:
                        true
                });

            if (agent.actionTaken) {
                database.saveMessage(
                    chatId,
                    "assistant",
                    agent.response
                );

                return res.json({
                    type:
                        "done",

                    chatId,

                    answer:
                        agent.response,

                    project:
                        agent.project,

                    action:
                        agent.type
                });
            }

            const project =
                agent.project;

            let answer;

            if (
                agent.type ===
                "web"
            ) {
                answer =
                    await handleWebRequest(
                        chatId,
                        userMessage,
                        history,
                        project
                    );
            } else if (
                agent.type ===
                "documents"
            ) {
                answer =
                    await handleDocumentsRequest(
                        chatId,
                        userMessage,
                        history,
                        project
                    );
            } else if (
                agent.type ===
                "status"
            ) {
                answer =
                    await handleStatusRequest(
                        chatId,
                        userMessage,
                        history,
                        project
                    );
            } else if (
                agent.type ===
                "rag"
            ) {
                answer =
                    await handleRagRequest(
                        chatId,
                        userMessage,
                        history,
                        project
                    );
            } else {
                answer =
                    await generateAnswer(
                        buildPrompt({
                            userMessage,

                            conversation:
                                history,

                            project,

                            memoryText:
                                getMemoryText()
                        })
                    );

                database.saveMessage(
                    chatId,
                    "assistant",
                    answer
                );
            }

            res.json({
                type:
                    "done",

                chatId,

                answer,

                project
            });
        } catch (error) {
            console.error(
                "Regenerate error:",
                error
            );

            res.status(500).json({
                type:
                    "error",

                message:
                    error.message
            });
        }
    }
);

/*
==================================================
MAIN CHAT
==================================================
*/

app.post(
    "/api/chat",
    security.requireCapability("WRITE"),
    async (req, res) => {
        const userMessage =
            String(
                req.body?.message ||
                ""
            ).trim();

        if (!userMessage) {
            return res.status(400).json({
                error:
                    "Message is required."
            });
        }

        const chat =
            getChatOrCreate(
                req.body?.chatId
            );

        const chatId =
            chat.id;

        database.saveMessage(
            chatId,
            "user",
            userMessage
        );

        updateAutomaticChatTitle(
            chatId,
            userMessage
        );

        const messages =
            database.getChatMessages(
                chatId
            );

        const currentUser =
            [...messages]
                .reverse()
                .find(
                    message =>
                        message.role ===
                        "user"
                );

        const conversation =
            getHistoryBeforeCurrent(
                chatId,
                currentUser?.id,
                12
            );

        /*
        ----------------------------------------
        STREAMING AGENT PATH
        ----------------------------------------
        When the client asks for NDJSON, workspace
        create/modify runs through the activity
        streaming path (task engine + live events).
        Non-workspace messages return null here and
        fall through to the normal handlers.
        */

        const wantsNdjson =
            (
                req.headers.accept || ""
            ).includes(
                "application/x-ndjson"
            );

        if (assistantIdentity.isIdentityQuestion(userMessage)) {
            const answer = assistantIdentity.IDENTITY_ANSWER;
            database.saveMessage(chatId, "assistant", answer);
            const payload = { type: "done", chatId, answer };

            if (wantsNdjson) {
                res.status(200);
                res.setHeader(
                    "Content-Type",
                    "application/x-ndjson; charset=utf-8"
                );
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
                res.write(JSON.stringify(payload) + "\n");
                return res.end();
            }

            return res.json(payload);
        }

        if (wantsNdjson) {
            res.status(200);

            res.setHeader(
                "Content-Type",
                "application/x-ndjson; charset=utf-8"
            );

            res.setHeader(
                "Cache-Control",
                "no-cache"
            );

            res.setHeader(
                "Connection",
                "keep-alive"
            );

            let streamedAgent = null;

            try {
                streamedAgent =
                    await runAgentWithActivity(
                        res,
                        chatId,
                        userMessage,
                        conversation,
                        resolveRequestModel(req.body)
                    );
            } catch (streamError) {
                /*
                The agent failed mid-task. Report the
                failure honestly over the NDJSON
                stream instead of killing the socket
                (which the browser shows as a
                "network error").
                */
                console.error(
                    "Agent stream failed:",
                    streamError
                );

                if (!res.writableEnded) {
                    res.write(
                        JSON.stringify({
                            type: "error",

                            message:
                                streamError?.message ||
                                "Agent task failed."
                        }) + "\n"
                    );

                    res.end();
                }

                return;
            }

            if (streamedAgent) {
                return;
            }

            /*
            Not a workspace action — fall through
            to the normal handlers below.

            The response is already committed to
            NDJSON (the activity event went out),
            so the content type can no longer be
            changed back to JSON. Instead, shim
            res.json so every later handler
            (simple greeting, memory, web, rag,
            direct chat) is delivered as a final
            NDJSON "done" event. Without this,
            res.json after a header send throws
            ERR_HTTP_HEADERS_SENT and kills the
            socket after the first activity line.
            */
            res.json = payload => {
                if (res.writableEnded) {
                    return res;
                }

                res.write(
                    JSON.stringify({
                        type: "done",

                        ...payload,

                        answer:
                            payload?.answer ??
                            payload?.error ??
                            ""
                    }) + "\n"
                );

                res.end();

                return res;
            };
        }

        try {
            /*
            --------------------------------------
            MEMORY DELETE
            --------------------------------------
            */

            const deletionKey =
                getMemoryDeletionKey(
                    userMessage
                );

            if (deletionKey) {
                memory.deleteMemory(
                    deletionKey
                );

                const answer =
                    `Done. I removed the saved memory for "${deletionKey}".`;

                database.saveMessage(
                    chatId,
                    "assistant",
                    answer
                );

                return res.json({
                    type:
                        "done",

                    chatId,

                    answer
                });
            }

            /*
            --------------------------------------
            MEMORY QUESTION
            --------------------------------------
            */

            if (
                isMemoryQuestion(
                    userMessage
                )
            ) {
                const answer =
                    buildMemoryResponse();

                database.saveMessage(
                    chatId,
                    "assistant",
                    answer
                );

                return res.json({
                    type:
                        "done",

                    chatId,

                    answer
                });
            }

            /*
            --------------------------------------
            EXPLICIT MEMORY
            --------------------------------------
            */

            if (
                isExplicitMemoryStatement(
                    userMessage
                )
            ) {
                saveExplicitMemory(
                    userMessage
                );
            }

            /*
            --------------------------------------
            AGENT CORE
            --------------------------------------
            */

            const agent =
                await agentCore.run({
                    chatId,

                    userMessage,

                    conversation,

                    executeWorkspaceActions:
                        true
                });

            /*
            --------------------------------------
            ACTION COMPLETED
            --------------------------------------
            */

            if (agent.actionTaken) {
                database.saveMessage(
                    chatId,
                    "assistant",
                    agent.response
                );

                return res.json({
                    type:
                        "done",

                    chatId,

                    answer:
                        agent.response,

                    project:
                        agent.project,

                    action:
                        agent.type
                });
            }

            /*
            --------------------------------------
            SIMPLE
            --------------------------------------
            */

            if (
                agent.type ===
                "simple"
            ) {
                let answer;

                if (
                    /^good morning/i.test(
                        userMessage
                    )
                ) {
                    answer =
                        "Good morning! How can I help?";
                } else if (
                    /^good afternoon/i.test(
                        userMessage
                    )
                ) {
                    answer =
                        "Good afternoon! How can I help?";
                } else if (
                    /^good evening/i.test(
                        userMessage
                    )
                ) {
                    answer =
                        "Good evening! How can I help?";
                } else {
                    answer =
                        "Hi! How can I help?";
                }

                database.saveMessage(
                    chatId,
                    "assistant",
                    answer
                );

                return res.json({
                    type:
                        "done",

                    chatId,

                    answer
                });
            }

            const project =
                agent.project;

            /*
            --------------------------------------
            WEB
            --------------------------------------
            */

            if (
                agent.type ===
                "web"
            ) {
                const answer =
                    await handleWebRequest(
                        chatId,
                        userMessage,
                        conversation,
                        project
                    );

                return res.json({
                    type:
                        "done",

                    chatId,

                    answer,

                    project
                });
            }

            /*
            --------------------------------------
            DOCUMENTS
            --------------------------------------
            */

            if (
                agent.type ===
                "documents"
            ) {
                const answer =
                    await handleDocumentsRequest(
                        chatId,
                        userMessage,
                        conversation,
                        project
                    );

                return res.json({
                    type:
                        "done",

                    chatId,

                    answer,

                    project
                });
            }

            /*
            --------------------------------------
            STATUS
            --------------------------------------
            */

            if (
                agent.type ===
                "status"
            ) {
                const answer =
                    await handleStatusRequest(
                        chatId,
                        userMessage,
                        conversation,
                        project
                    );

                return res.json({
                    type:
                        "done",

                    chatId,

                    answer,

                    project
                });
            }

            /*
            --------------------------------------
            RAG
            --------------------------------------
            */

            if (
                agent.type ===
                "rag"
            ) {
                const answer =
                    await handleRagRequest(
                        chatId,
                        userMessage,
                        conversation,
                        project
                    );

                return res.json({
                    type:
                        "done",

                    chatId,

                    answer,

                    project
                });
            }

            /*
            --------------------------------------
            WORKSPACE READ
            Delegated to the agent tool loop: the
            model reads the actual file via the
            workspace_read_file tool instead of
            hallucinating content from a tree
            listing (spec: never invent tool
            results).
            --------------------------------------
            */

            return handleDirectRequest(
                req,
                res,
                chatId,
                userMessage,
                conversation,
                project
            );
        } catch (error) {
            console.error(
                "Chat error:",
                error
            );

            if (!res.headersSent) {
                return res.status(500).json({
                    type:
                        "error",

                    message:
                        error.message
                });
            }

            if (!res.writableEnded) {
                res.write(
                    JSON.stringify({
                        type:
                            "error",

                        message:
                            error.message
                    }) + "\n"
                );

                res.end();
            }
        }
    }
);

/*
 AGENT ACTIVITY STREAM (workspace actions)
 Streams concise activity events while the agent
 runs, then persists the full task record.
 */

function resolveRequestModel(body = {}) {
    const decision = modelRegistry.router.select({
        task: body.task || "code",
        intelligence: body.intelligence || "balanced",
        provider: body.provider || undefined,
        model: body.model || undefined,
        preferLocal: body.preferLocal === true
    });
    return {
        provider: body.provider || decision.selected?.provider || null,
        model: body.model || decision.selected?.model || null
    };
}

async function runAgentWithActivity(
    res,
    chatId,
    userMessage,
    conversation,
    modelOptions = {}
) {
    let taskId = null;

    const activity = [];

    const onActivity = event => {
        activity.push(event);

        if (taskId) {
            taskEngine.addActivity(
                taskId,
                event.message,
                event.status
            );
        }

        if (!res.writableEnded) {
            res.write(
                JSON.stringify({
                    type: "activity",

                    message: event.message,

                    status: event.status
                }) + "\n"
            );
        }
    };

    /*
    Persist the task before running so activity
    events land in the log.
    */
    const task = taskEngine.createTask({
        chatId,

        goal: userMessage,

        plan: [
            "understand",
            "plan",
            "execute",
            "verify",
            "complete"
        ]
    });

    taskId = task.id;

    taskEngine.setStatus(taskId, "running");

    try {
        const agent = await agentCore.run({
            chatId,

            userMessage,

            conversation,

            executeWorkspaceActions: true,
            provider: modelOptions.provider,
            model: modelOptions.model,

            onActivity
        });

        if (!agent.actionTaken) {
            taskEngine.deleteTask(taskId);

            return null;
        }

        taskEngine.updateTask(taskId, {
            status: "completed",

            stepsDone:
                agent.result?.verified?.length || 0,

            stepsTotal:
                agent.result?.changed?.length || 0,

            result:
                `Verified files: ${(agent.result?.verified || []).join(", ")}`
        });

        if (!res.writableEnded) {
            res.write(
                JSON.stringify({
                    type: "done",

                    chatId,

                    answer: agent.response,

                    project: agent.project,

                    action: agent.type,

                    taskId,

                    activity
                }) + "\n"
            );

            res.end();
        }

        return agent;
    } catch (error) {
        taskEngine.updateTask(taskId, {
            status: "failed",

            error: error.message
        });

        taskEngine.addActivity(
            taskId,
            `Failed: ${error.message}`,
            "error"
        );

        throw error;
    }
}

/*
 TASK API
 */

app.get(
    "/api/tasks",
    (req, res) => {
        if (req.query.chatId) {
            return res.json(
                taskEngine.listTasksByChat(
                    req.query.chatId
                )
            );
        }

        res.json(taskEngine.listTasks());
    }
);

app.get(
    "/api/tasks/:id",
    (req, res) => {
        const task =
            taskEngine.getTask(req.params.id);

        if (!task) {
            return res.status(404).json({
                error: "Task not found."
            });
        }

        res.json({
            task,

            activity:
                taskEngine.getActivity(task.id)
        });
    }
);

app.post(
    "/api/tasks/:id/cancel",
    security.requireCapability("EXECUTE"),
    (req, res) => {
        const result =
            taskEngine.cancelTask(
                req.params.id
            );

        if (!result.ok) {
            return res.status(
                result.code === "NOT_FOUND" ? 404 : 409
            ).json(result);
        }

        res.json(result);
    }
);

app.post(
    "/api/chats/:id/branch",
    security.requireCapability("WRITE"),
    (req, res) => {
        const chat = database.branchChat(
            req.params.id,
            Number(req.body?.messageId),
            req.body?.title
        );
        if (!chat) return res.status(404).json({ error: "Chat or branch point not found." });
        res.status(201).json({ chat, messages: database.getChatMessages(chat.id) });
    }
);

app.post(
    "/api/local-models/:action",
    security.requireCapability("ADMIN"),
    async (req, res) => {
        const action = String(req.params.action || "").toLowerCase();
        const model = String(req.body?.model || "").trim();
        if (!["pull", "delete"].includes(action)) {
            return res.status(400).json({ error: "Action must be pull or delete." });
        }
        if (action === "delete" && req.body?.confirm !== true) {
            return res.status(400).json({ error: "Set confirm: true to remove a local model." });
        }
        try {
            const result = await providers.manageLocalModel(action, model);
            const installed = await providers.listModels("ollama");
            modelRegistry.registerDiscoveredModels("ollama", installed);
            if (action === "delete") modelRegistry.unregisterModel("ollama", model);
            const requiredMemoryGB = action === "pull"
                ? modelRegistry.estimateLocalMemory(model)
                : null;
            const availableMemoryGB = modelRegistry.detectHardware().memoryGB;
            res.json({
                ok: true,
                action,
                result,
                installed,
                memoryWarning: requiredMemoryGB > availableMemoryGB
                    ? `This model is estimated to need ${requiredMemoryGB} GB of RAM; this device has ${availableMemoryGB} GB. It may be slow or fail to load.`
                    : null
            });
        } catch (error) {
            res.status(502).json({ ok: false, error: error.message });
        }
    }
);

app.get("/api/local-models/estimate", (req, res) => {
    const model = String(req.query.model || "").trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/.test(model)) {
        return res.status(400).json({ error: "A valid Ollama model name is required." });
    }
    const requiredMemoryGB = modelRegistry.estimateLocalMemory(model);
    const availableMemoryGB = modelRegistry.detectHardware().memoryGB;
    res.json({
        model,
        requiredMemoryGB,
        availableMemoryGB,
        knownEstimate: requiredMemoryGB < 1024,
        fitsAvailableRam: requiredMemoryGB <= availableMemoryGB
    });
});

/* Explainable local policy; it performs no provider calls or key access. */
app.get(
    "/api/model-routing",
    (req, res) => {
        res.json(modelRegistry.router.select({
            task: req.query.task,
            provider: req.query.provider,
            model: req.query.model,
            intelligence: req.query.intelligence,
            contextTokens: req.query.contextTokens,
            preferLocal: req.query.preferLocal === "true",
            localOnly: req.query.localOnly === "true"
        }));
    }
);

app.get(
    "/api/model-metrics",
    (req, res) => res.json({ metrics: modelRegistry.router.listMetrics() })
);

app.post(
    "/api/model-metrics",
    security.requireCapability("ADMIN"),
    (req, res) => {
        try {
            res.status(201).json({ metrics: modelRegistry.router.recordOutcome(req.body || {}) });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
);

app.get(
    "/api/tools",
    (req, res) => {
        res.json({
            tools:
                toolRegistry.list()
        });
    }
);

/*
 CONTROLLED TERMINAL API
 Commands run only via the registry tool with
 EXECUTE permission; every run is logged.
 */

const terminalTool =
    require("./agent/terminalTool");

const gitTool =
    require("./agent/gitTool");

const permissions =
    require("./agent/permissions");

const approvalService =
    require("./agent/approvalService");

app.post(
    "/api/terminal",
    security.requireCapability("EXECUTE"),
    async (req, res) => {
        try {
            const result =
                await toolRegistry.run(
                    "terminal_execute",
                    {
                        command:
                            req.body?.command,

                        args:
                            req.body?.args || [],

                        cwd:
                            req.body?.cwd || "",

                        timeoutMs:
                            req.body?.timeoutMs
                    }
                );

            res.json(result);
        } catch (error) {
            res.status(400).json({
                ok: false,

                error: error.message
            });
        }
    }
);

app.get(
    "/api/terminal/log",
    (req, res) => {
        res.json({
            log:
                terminalTool.getRunLog(50)
        });
    }
);

app.get(
    "/api/approvals",
    (req, res) => {
        res.json({
            required:
                /^(1|true|yes|on)$/i.test(
                    String(
                        process.env.NEXUS_REQUIRE_APPROVALS ||
                        ""
                    )
                ),
            pending:
                approvalService.listPending()
        });
    }
);

app.post(
    "/api/approvals",
    security.requireCapability("EXECUTE"),
    (req, res) => {
        try {
            const tool =
                String(req.body?.tool || "").trim();

            if (!toolRegistry.get(tool)) {
                return res.status(404).json({
                    error: `Unknown tool: ${tool}`
                });
            }

            const approval =
                approvalService.requestApproval({
                    tool,
                    summary:
                        req.body?.summary ||
                        `Approve ${tool}`,
                    input:
                        req.body?.input || {}
                });

            res.status(201).json(approval);
        } catch (error) {
            res.status(400).json({
                error: error.message
            });
        }
    }
);

/*
 GIT API
 Read-only endpoints plus protected commit endpoint.
 */

app.get(
    "/api/git/status",
    async (req, res) => {
        try {
            res.json(await gitTool.getStatus());
        } catch (err) {
            res.status(400).json({
                ok: false,

                error: err.message
            });
        }
    }
);

app.get(
    "/api/git/diff",
    async (req, res) => {
        try {
            res.json(await gitTool.getDiff());
        } catch (err) {
            res.status(400).json({
                ok: false,

                error: err.message
            });
        }
    }
);

app.get(
    "/api/git/log",
    async (req, res) => {
        try {
            const limit =
                parseInt(req.query.limit, 10) || 10;

            res.json(await gitTool.getLog(limit));
        } catch (err) {
            res.status(400).json({
                ok: false,

                error: err.message
            });
        }
    }
);

app.post(
    "/api/git/commit",
    security.requireCapability("GIT"),
    async (req, res) => {
        try {
            const message = String(
                req.body.message || ""
            ).trim();

            if (!message) {
                return res.status(400).json({
                    ok: false,

                    error:
                        "Commit message is required."
                });
            }

            await gitTool.stageAll();

            res.json(
                await gitTool.commit(message)
            );
        } catch (err) {
            res.status(400).json({
                ok: false,

                error: err.message
            });
        }
    }
);

/*
 PERMISSION API
 Grant/revoke capabilities at runtime.
 */

app.get(
    "/api/permissions",
    (req, res) => {
        res.json({
            granted:
                permissions.getGranted(),

            available:
                permissions.CAPABILITIES
        });
    }
);

app.post(
    "/api/permissions/:capability/grant",
    security.requireCapability("ADMIN"),
    (req, res) => {
        try {
            permissions.grant(
                req.params.capability
            );

            res.json({
                granted:
                    permissions.getGranted()
            });
        } catch (error) {
            res.status(400).json({
                error: error.message
            });
        }
    }
);

app.post(
    "/api/permissions/:capability/revoke",
    security.requireCapability("ADMIN"),
    (req, res) => {
        permissions.revoke(
            req.params.capability
        );

        res.json({
            granted:
                permissions.getGranted()
        });
    }
);

/*
 STARTUP
 */

registeredTools.ensureRegistered();

const builtInAutomations = [
    {
        name: "research-digest",
        triggers: ["manual", "schedule"],
        steps: [
            {
                id: "collect",
                retries: 1,
                timeoutMs: 15000,
                run: async ({ input }) => ({
                    summaries: input?.topics || ["research"],
                    collectedAt: new Date().toISOString()
                })
            },
            {
                id: "summarize",
                retries: 1,
                timeoutMs: 20000,
                run: async ({ data }) => ({
                    headline: "Research digest ready",
                    sources: data.collect.summaries,
                    status: "complete"
                })
            }
        ]
    },
    {
        name: "workspace-sync",
        triggers: ["manual"],
        steps: [
            {
                id: "scan",
                retries: 1,
                timeoutMs: 15000,
                run: async ({ input }) => ({
                    files: input?.files || [],
                    updatedAt: new Date().toISOString()
                })
            },
            {
                id: "index",
                retries: 1,
                timeoutMs: 20000,
                run: async ({ data }) => ({
                    indexed: data.scan.files.length,
                    status: "indexed"
                })
            }
        ]
    }
];

for (const workflow of builtInAutomations) {
    try {
        workflowEngine.register(workflow);
    } catch (error) {
        console.error(
            "Workflow registration failed:",
            workflow.name,
            error.message
        );
    }
}

taskEngine.listTasks(1);

console.log(
    "Task engine, workflow engine, and tool registry initialized."
);

try {
    workspaceTools.ensureWorkspace();

    console.log(
        "Workspace:",
        workspaceTools.getWorkspaceRoot()
    );
} catch (error) {
    console.error(
        "Workspace initialization error:",
        error
    );
}

try {
    projectState.ensureStore();

    console.log(
        "Project state initialized."
    );
} catch (error) {
    console.error(
        "Project state initialization error:",
        error
    );
}

try {
    memory.normalizeExistingMemories(
        normalizeMemoryKey
    );
} catch (error) {
    console.error(
        "Memory normalization error:",
        error
    );
}

/*
==================================================
SERVER
==================================================
*/

function startServer() {
    /*
    One-time data migrations run before the port opens, so the first
    request already sees repaired data.
    */
    repairLegacyChatTitles();
    // Detect locally installed Ollama models before the port opens so
    // the very first /api/models response already marks them configured.
    syncLocalModels().then(installed => {
        if (installed.length) console.log(` Detected ${installed.length} local Ollama model(s).`);
    });

    return app.listen(
        config.PORT,
        config.HOST,
        () => {
            console.log("");
            console.log(
                "===================================="
            );
            console.log(
                ` ${config.PRODUCT_NAME} ${NEXUS_VERSION}`
            );
            console.log(
                "===================================="
            );
            console.log(
                ` Server: http://${config.HOST}:${config.PORT}`
            );
            console.log(
                ` Model:  ${MODEL}`
            );
            console.log(
                " Agent:  understand -> plan -> act -> verify"
            );
            console.log(
                " Project: persistent per chat"
            );
            console.log(
                " Workspace: create + modify + verify"
            );
            console.log(
                "===================================="
            );
            console.log("");
        }
    );
}

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    startServer
};

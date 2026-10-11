/*
=========================================================
MODEL ROUTER  (master spec section 18)
=========================================================
A model-independent routing layer on top of the provider
gateway. The rest of Nexus must never hard-code a provider
or model — instead it asks the router for a model suited to
a ROLE:

  conversation  -> chat with the user (fast, natural)
  reasoning     -> planning, evaluation, reflection
  code          -> file/artifact generation
  vision        -> image/screenshot understanding
  fast          -> cheap classification/extraction tasks
  embedding     -> retrieval (used by the RAG engine)

Selection order per role:
  1. explicit env override  (NEXUS_ROLE_MODEL, e.g. NEXUS_CODE_MODEL)
  2. role-appropriate default for the active provider
  3. the provider's default model

Model-independent: works with OpenAI, Anthropic, Ollama,
or any provider the gateway supports, plus arbitrary local
or remote models via env configuration. Never throws when
a provider is missing — falls back to whatever is active.
=========================================================
*/

const gateway = require("../../lib/providers/gateway");

/*
Roles and their purpose — used for logging, activity and
future per-role provider selection.
*/
const ROLES = [
    "conversation",
    "writing",
    "reasoning",
    "code",
    "vision",
    "fast",
    "embedding"
];

/*
Role-specific model defaults per provider type. The values
here are sensible defaults, not requirements — every entry
can be overridden by environment variables.
*/
const ROLE_DEFAULTS = {
    openai: {
        conversation: "gpt-4o-mini",
        writing: "gpt-4o-mini",
        reasoning: "gpt-4o",
        code: "gpt-4o",
        vision: "gpt-4o-mini",
        fast: "gpt-4o-mini"
    },
    anthropic: {
        conversation: "claude-sonnet-4-20250514",
        writing: "claude-sonnet-4-20250514",
        reasoning: "claude-sonnet-4-20250514",
        code: "claude-sonnet-4-20250514",
        vision: "claude-sonnet-4-20250514",
        fast: "claude-sonnet-4-20250514"
    },
    ollama: {
        conversation: "qwen2.5:1.5b",
        writing: "qwen2.5:1.5b",
        reasoning: "qwen2.5-coder:1.5b",
        code: "qwen2.5-coder:1.5b",
        vision: "qwen2.5:1.5b",
        fast: "qwen2.5:1.5b"
    }
};

function roleEnvKey(role) {
    return `NEXUS_${String(role).toUpperCase()}_MODEL`;
}

/*
Resolve the model to use for a role. Falls back gracefully
when the provider has no role-specific default.
*/
function resolveModel(rawRole = "conversation") {
    const role = normalizeRole(rawRole);
    const provider = gateway.getActiveProvider();
    const providerType = provider.type || "ollama";

    const envOverride =
        process.env[roleEnvKey(role)] ||
        process.env.NEXUS_MODEL;

    if (envOverride) {
        return {
            role,
            provider: providerType,
            model: envOverride,
            source: "env"
        };
    }

    const defaults = ROLE_DEFAULTS[providerType] || {};
    const model =
        defaults[role] ||
        provider.model ||
        defaults.conversation ||
        "qwen2.5:1.5b";

    return {
        role,
        provider: providerType,
        model,
        source: defaults[role] ? "role-default" : "provider-default"
    };
}

/*
Validate that a role is known. Unknown roles fall back to
"conversation" rather than throwing — the router must never
break the agent because of a typo in a caller.
*/
function normalizeRole(role) {
    return ROLES.includes(role) ? role : "conversation";
}

/*
Chat with the model chosen for a role. Same signature as
gateway.chat but with role-based routing.
*/
async function chat(messages, { role = "conversation", ...options } = {}) {
    const resolved = resolveModel(normalizeRole(role));

    return gateway.chat(messages, {
        ...options,
        model: resolved.model
    });
}

/*
Stream with the model chosen for a role.
*/
async function chatStream(messages, onToken, { role = "conversation", ...options } = {}) {
    const resolved = resolveModel(normalizeRole(role));

    return gateway.chatStream(messages, onToken, {
        ...options,
        model: resolved.model
    });
}

/*
List all role resolutions — useful for the UI (settings
panel) and for debugging which model handles what.
*/
function describeRoutes() {
    return ROLES.map(role => resolveModel(role));
}

/*
Compatibility entry point for tools that need a resolved
model descriptor before making a provider call.
*/
function select(options = {}) {
    return resolveModel(
        typeof options === "string"
            ? options
            : options.role || "conversation"
    );
}

module.exports = {
    ROLES,
    ROLE_DEFAULTS,
    resolveModel,
    normalizeRole,
    roleEnvKey,
    chat,
    chatStream,
    describeRoutes,
    select
};

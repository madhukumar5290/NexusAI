const config = require("../config");

const clients = {
    ollama: require("./ollama"),
    openai: require("./openai"),
    anthropic: require("./anthropic"),
    google: require("./google")
};

/*
=========================================================
PROVIDER REGISTRY
=========================================================
Resolves a provider name to its transport
client plus its configured endpoint, and
turns a model role (chat/code/planner) into
a concrete provider + model pair.

The agent loop only ever calls `chat()` and
`resolveRole()`; it never knows which vendor
is behind a role.
=========================================================
*/

function normalizeName(name) {
    const value = String(
        name || config.DEFAULT_PROVIDER
    )
        .trim()
        .toLowerCase();

    return value || config.DEFAULT_PROVIDER;
}

function getProvider(name) {
    const key = normalizeName(name);

    const providerConfig = config.PROVIDERS[key];

    if (!providerConfig) {
        throw new Error(
            `Unknown provider "${key}". Available: ` +
                Object.keys(config.PROVIDERS).join(", ")
        );
    }

    const client = clients[providerConfig.native];

    if (!client) {
        throw new Error(
            `No transport implemented for provider "${key}"`
        );
    }

    return {
        name: key,
        config: providerConfig,
        client
    };
}

/*
A provider is usable if it is local (Ollama)
or has an API key configured.
*/

function isConfigured(name) {
    const key = normalizeName(name);

    const providerConfig = config.PROVIDERS[key];

    if (!providerConfig) {
        return false;
    }

    if (providerConfig.native === "ollama") {
        return true;
    }

    return Boolean(providerConfig.apiKey);
}

function describeProviders() {
    return Object.entries(config.PROVIDERS).map(
        ([name, providerConfig]) => ({
            name,
            label: providerConfig.label,
            native: providerConfig.native,
            baseUrl: providerConfig.baseUrl,
            credentialEnv: providerConfig.credentialEnv || null,
            configured: isConfigured(name),
            local: providerConfig.native === "ollama"
        })
    );
}

/*
=========================================================
ROLES
=========================================================
=========================================================
*/

function resolveRole(role) {
    const name = String(role || "chat");

    const resolved =
        config.MODEL_ROLES[name] ||
        config.MODEL_ROLES.chat;

    return {
        role: name,
        provider: normalizeName(resolved.provider),
        model: resolved.model
    };
}

function describeRoles() {
    return Object.keys(config.MODEL_ROLES).map(
        role => ({
            ...resolveRole(role),
            configured: isConfigured(
                resolveRole(role).provider
            )
        })
    );
}

/*
=========================================================
CHAT
=========================================================
request = {
  provider?, model?, role?, system,
  messages, tools, stream, temperature,
  maxTokens, toolChoice, signal
}

Returns an async generator of normalized
events, identical regardless of provider.
=========================================================
*/

function chat(request) {
    const roleDefaults = request.role
        ? resolveRole(request.role)
        : null;

    const providerName =
        request.provider ||
        roleDefaults?.provider ||
        config.DEFAULT_PROVIDER;

    const model =
        request.model ||
        roleDefaults?.model ||
        config.LOCAL_FALLBACK_MODEL;

    const { config: providerConfig, client } =
        getProvider(providerName);

    if (!isConfigured(providerName)) {
        throw new Error(
            `Provider "${providerName}" is not configured. ` +
                "Add its API key to .env, or switch to a local model."
        );
    }

    return client.chat(
        {
            ...request,
            provider: providerName,
            model
        },
        providerConfig
    );
}

/*
=========================================================
MODELS
=========================================================
Discovery is best-effort: a provider being
unreachable must not break the model picker.
=========================================================
*/

async function listModels(name) {
    const { config: providerConfig, client } =
        getProvider(name);

    if (!isConfigured(name)) {
        return [];
    }

    if (typeof client.listModels !== "function") {
        throw new Error(`Model discovery is not supported for provider "${normalizeName(name)}".`);
    }

    return client.listModels(providerConfig);
}

async function listAllModels() {
    const entries = await Promise.all(
        Object.keys(config.PROVIDERS).map(
            async name => {
                const models = await listModels(name);

                return [
                    name,
                    models.map(model => ({
                        provider: name,
                        model
                    }))
                ];
            }
        )
    );

    return Object.fromEntries(entries);
}

/*
=========================================================
HEALTH
=========================================================
=========================================================
*/

async function checkProvider(name) {
    const key = normalizeName(name);

    if (!isConfigured(key)) {
        return {
            name: key,
            ok: false,
            reason: "not configured"
        };
    }

    try {
        const models = await listModels(key);

        return {
            name: key,
            ok: true,
            models
        };
    } catch (error) {
        return {
            name: key,
            ok: false,
            reason: error.message
        };
    }
}

async function manageLocalModel(action, model) {
    const { config: providerConfig, client } = getProvider("ollama");
    if (action === "pull") return client.pullModel(providerConfig, model);
    if (action === "delete") return client.deleteModel(providerConfig, model);
    throw new Error("Unsupported local model action.");
}

module.exports = {
    getProvider,
    isConfigured,
    describeProviders,
    resolveRole,
    describeRoles,
    chat,
    listModels,
    listAllModels,
    checkProvider,
    manageLocalModel
};

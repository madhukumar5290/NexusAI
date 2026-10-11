const fs = require("fs");
const path = require("path");
const os = require("os");

/*
=========================================================
ENVIRONMENT
=========================================================
Load .env if present. Node 20+ ships
process.loadEnvFile; fall back to a tiny
parser so this works on any Node version.
=========================================================
*/

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_FILE = process.env.NEXUS_ENV_FILE || path.join(ROOT_DIR, ".env");
const PRODUCT_NAME = "Jarwis";

function loadEnvFile() {
    if (!fs.existsSync(ENV_FILE)) {
        return;
    }

    if (typeof process.loadEnvFile === "function") {
        try {
            process.loadEnvFile(ENV_FILE);
            return;
        } catch {
            /* fall through to manual parse */
        }
    }

    let raw;

    try {
        raw = fs.readFileSync(ENV_FILE, "utf8");
    } catch {
        return;
    }

    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const separator = trimmed.indexOf("=");

        if (separator === -1) {
            continue;
        }

        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

loadEnvFile();

/*
=========================================================
HELPERS
=========================================================
*/

function envString(key, fallback) {
    const value = process.env[key];

    if (value == null || value === "") {
        return fallback;
    }

    return String(value).trim();
}

function envNumber(key, fallback) {
    const value = Number(process.env[key]);

    return Number.isFinite(value) ? value : fallback;
}

function envBool(key, fallback) {
    const value = process.env[key];

    if (value == null || value === "") {
        return fallback;
    }

    return /^(1|true|yes|on)$/i.test(String(value).trim());
}

/*
=========================================================
DIRECTORIES
=========================================================
*/

const DATA_DIR = envString(
    "NEXUS_DATA_DIR",
    path.join(ROOT_DIR, "data")
);

/*
Project-scoped workspaces live under this root,
one folder per project, so two chats never
overwrite each other's files.
*/

const WORKSPACES_DIR = envString(
    "NEXUS_WORKSPACES_DIR",
    path.join(ROOT_DIR, "workspaces")
);

const LEGACY_WORKSPACE_DIR = path.join(
    ROOT_DIR,
    "workspace"
);

const DATABASE_FILE = envString(
    "NEXUS_DB_FILE",
    path.join(ROOT_DIR, "nexus.db")
);

/*
=========================================================
SERVER
=========================================================
*/

const PORT = envNumber(
    "NEXUS_PORT",
    envNumber("PORT", 3000)
);

const HOST = envString("NEXUS_HOST", "127.0.0.1");

/*
=========================================================
PROVIDER
=========================================================
*/

const DEFAULT_PROVIDER = envString(
    "NEXUS_PROVIDER",
    "ollama"
);

const PROVIDERS = {
    ollama: {
        label: "Ollama (local)",
        credentialEnv: "OLLAMA_API_KEY",
        baseUrl: envString(
            "OLLAMA_BASE_URL",
            "http://localhost:11434"
        ),
        apiKey: envString("OLLAMA_API_KEY", ""),
        native: "ollama"
    },

    openai: {
        label: "OpenAI",
        credentialEnv: "OPENAI_API_KEY",
        baseUrl: envString(
            "OPENAI_BASE_URL",
            "https://api.openai.com/v1"
        ),
        apiKey: envString("OPENAI_API_KEY", ""),
        native: "openai"
    },

    anthropic: {
        label: "Anthropic",
        credentialEnv: "ANTHROPIC_API_KEY",
        baseUrl: envString(
            "ANTHROPIC_BASE_URL",
            "https://api.anthropic.com/v1"
        ),
        apiKey: envString("ANTHROPIC_API_KEY", ""),
        native: "anthropic"
    },

    google: {
        label: "Google Gemini",
        credentialEnv: "GOOGLE_API_KEY",
        baseUrl: envString(
            "GOOGLE_BASE_URL",
            "https://generativelanguage.googleapis.com/v1beta"
        ),
        apiKey: envString("GOOGLE_API_KEY", ""),
        native: "google"
    },

    /*
    Any OpenAI-compatible endpoint: Groq,
    OpenRouter, DeepSeek, Together, LM Studio,
    llama.cpp server, vLLM, etc.
    */

    compatible: {
        label: "OpenAI-compatible",
        credentialEnv: "COMPATIBLE_API_KEY",
        baseUrl: envString(
            "COMPATIBLE_BASE_URL",
            "http://localhost:8000/v1"
        ),
        apiKey: envString("COMPATIBLE_API_KEY", ""),
        native: "openai"
    },

    /*
    Named OpenAI-compatible providers. Each one only needs its
    own key (and an optional base-URL override) to become usable;
    the transport is the same OpenAI client.
    */

    groq: {
        label: "Groq",
        credentialEnv: "GROQ_API_KEY",
        baseUrl: envString(
            "GROQ_BASE_URL",
            "https://api.groq.com/openai/v1"
        ),
        apiKey: envString("GROQ_API_KEY", ""),
        native: "openai"
    },

    deepseek: {
        label: "DeepSeek",
        credentialEnv: "DEEPSEEK_API_KEY",
        baseUrl: envString(
            "DEEPSEEK_BASE_URL",
            "https://api.deepseek.com/v1"
        ),
        apiKey: envString("DEEPSEEK_API_KEY", ""),
        native: "openai"
    },

    mistral: {
        label: "Mistral",
        credentialEnv: "MISTRAL_API_KEY",
        baseUrl: envString(
            "MISTRAL_BASE_URL",
            "https://api.mistral.ai/v1"
        ),
        apiKey: envString("MISTRAL_API_KEY", ""),
        native: "openai"
    },

    xai: {
        label: "xAI Grok",
        credentialEnv: "XAI_API_KEY",
        baseUrl: envString(
            "XAI_BASE_URL",
            "https://api.x.ai/v1"
        ),
        apiKey: envString("XAI_API_KEY", ""),
        native: "openai"
    },

    openrouter: {
        label: "OpenRouter",
        credentialEnv: "OPENROUTER_API_KEY",
        baseUrl: envString(
            "OPENROUTER_BASE_URL",
            "https://openrouter.ai/api/v1"
        ),
        apiKey: envString("OPENROUTER_API_KEY", ""),
        native: "openai"
    },

    together: {
        label: "Together",
        credentialEnv: "TOGETHER_API_KEY",
        baseUrl: envString(
            "TOGETHER_BASE_URL",
            "https://api.together.xyz/v1"
        ),
        apiKey: envString("TOGETHER_API_KEY", ""),
        native: "openai"
    }
};

/*
=========================================================
MODEL ROLES
=========================================================
chat      - the user-facing conversation model
code      - file / artifact generation
planner   - reasoning about multi-step work
summary   - titles, summaries, cheap work

fetch: true means the list is discovered at
runtime (Ollama models, or a provdier /models call).
=========================================================
*/

const LOCAL_FALLBACK_MODEL = envString(
    "NEXUS_LOCAL_MODEL",
    "qwen2.5:1.5b"
);

const PROVIDER_ROLE_DEFAULTS = {
    ollama: {
        chat: LOCAL_FALLBACK_MODEL,
        writing: LOCAL_FALLBACK_MODEL,
        code: "qwen2.5-coder:1.5b",
        planner: "qwen2.5-coder:1.5b"
    },
    openai: {
        chat: "gpt-4o-mini",
        writing: "gpt-4o-mini",
        code: "gpt-4o-mini",
        planner: "o4-mini"
    },
    anthropic: {
        chat: "claude-sonnet-4-20250514",
        writing: "claude-sonnet-4-20250514",
        code: "claude-sonnet-4-20250514",
        planner: "claude-sonnet-4-20250514"
    },
    google: {
        chat: "gemini-2.5-flash",
        writing: "gemini-2.5-flash",
        code: "gemini-2.5-flash",
        planner: "gemini-2.5-pro"
    },
    openrouter: {
        chat: "openai/gpt-4o-mini",
        writing: "openai/gpt-4o-mini",
        code: "openai/gpt-4o-mini",
        planner: "openai/o4-mini"
    },
    groq: {
        chat: "llama-3.3-70b-versatile",
        writing: "llama-3.3-70b-versatile",
        code: "llama-3.3-70b-versatile",
        planner: "llama-3.3-70b-versatile"
    },
    deepseek: {
        chat: "deepseek-chat",
        writing: "deepseek-chat",
        code: "deepseek-chat",
        planner: "deepseek-reasoner"
    },
    mistral: {
        chat: "mistral-large-latest",
        writing: "mistral-large-latest",
        code: "codestral-latest",
        planner: "mistral-large-latest"
    },
    xai: {
        chat: "grok-4",
        writing: "grok-4",
        code: "grok-4",
        planner: "grok-4"
    },
    together: {
        chat: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        writing: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        code: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        planner: "meta-llama/Llama-3.3-70B-Instruct-Turbo"
    }
};

function roleDefaultModel(provider, role) {
    const defaults = PROVIDER_ROLE_DEFAULTS[String(provider || "").toLowerCase()];
    return defaults?.[role] || LOCAL_FALLBACK_MODEL;
}

const MODEL_ROLES = {
    chat: {
        provider: envString("NEXUS_CHAT_PROVIDER", DEFAULT_PROVIDER),
        model: envString(
            "NEXUS_CHAT_MODEL",
            roleDefaultModel(
                envString("NEXUS_CHAT_PROVIDER", DEFAULT_PROVIDER),
                "chat"
            )
        )
    },

    writing: {
        provider: envString("NEXUS_WRITING_PROVIDER", DEFAULT_PROVIDER),
        model: envString(
            "NEXUS_WRITING_MODEL",
            roleDefaultModel(
                envString("NEXUS_WRITING_PROVIDER", DEFAULT_PROVIDER),
                "writing"
            )
        )
    },

    code: {
        provider: envString("NEXUS_CODE_PROVIDER", DEFAULT_PROVIDER),
        model: envString(
            "NEXUS_CODE_MODEL",
            roleDefaultModel(
                envString("NEXUS_CODE_PROVIDER", DEFAULT_PROVIDER),
                "code"
            )
        )
    },

    planner: {
        provider: envString("NEXUS_PLANNER_PROVIDER", DEFAULT_PROVIDER),
        model: envString(
            "NEXUS_PLANNER_MODEL",
            roleDefaultModel(
                envString("NEXUS_PLANNER_PROVIDER", DEFAULT_PROVIDER),
                "planner"
            )
        )
    }
};

/*
=========================================================
LIMITS
=========================================================
*/

const LIMITS = {
    maxAgentSteps: envNumber(
        "NEXUS_MAX_AGENT_STEPS",
        12
    ),

    maxHistoryMessages: envNumber(
        "NEXUS_MAX_HISTORY",
        24
    ),

    maxFileReadBytes: envNumber(
        "NEXUS_MAX_FILE_READ",
        120000
    ),

    maxToolResultChars: envNumber(
        "NEXUS_MAX_TOOL_RESULT",
        24000
    ),

    maxPreviewFiles: envNumber(
        "NEXUS_MAX_PREVIEW_FILES",
        400
    ),

    requestTimeoutMs: envNumber(
        "NEXUS_REQUEST_TIMEOUT",
        180000
    )
};

/*
=========================================================
FEATURES
=========================================================
*/

const FEATURES = {
    terminal: envBool("NEXUS_ENABLE_TERMINAL", true),
    git: envBool("NEXUS_ENABLE_GIT", true),
    web: envBool("NEXUS_ENABLE_WEB", true),
    mcp: envBool("NEXUS_ENABLE_MCP", true)
};

/*
=========================================================
PLATFORM
=========================================================
*/

const PLATFORM = {
    isWindows: process.platform === "win32",
    shell: process.platform === "win32"
        ? process.env.ComSpec || "cmd.exe"
        : process.env.SHELL || "/bin/sh",
    home: os.homedir()
};

const SETTINGS_ENV_KEYS = new Set([
    "OLLAMA_BASE_URL",
    "OLLAMA_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "DEEPSEEK_API_KEY",
    "MISTRAL_API_KEY",
    "XAI_API_KEY",
    "TOGETHER_API_KEY",
    "COMPATIBLE_API_KEY",
    "COMPATIBLE_BASE_URL",
    "NEXUS_AUTO_ALLOW_PAID_API",
    "NEXUS_AUTO_ALLOW_PAID_FALLBACK",
    "NEXUS_IMAGE_MODEL"
]);

function refreshProviderSecrets() {
    for (const [name, provider] of Object.entries(PROVIDERS)) {
        if (provider.credentialEnv) {
            provider.apiKey = envString(provider.credentialEnv, "");
        }
        const baseUrlEnv = `${name.toUpperCase()}_BASE_URL`;
        if (process.env[baseUrlEnv]) {
            provider.baseUrl = envString(baseUrlEnv, provider.baseUrl);
        }
    }
}

function persistEnvValues(updates, envFile = ENV_FILE) {
    const incoming = updates && typeof updates === "object" ? updates : {};
    const applied = {};

    for (const [rawKey, rawValue] of Object.entries(incoming)) {
        const key = String(rawKey || "").trim();
        if (!SETTINGS_ENV_KEYS.has(key)) {
            throw new Error(`Refusing to persist unsupported setting: ${key}`);
        }
        const value = rawValue == null ? "" : String(rawValue).trim();
        if (!value) continue;
        if (value.length > 4096 || /[\r\n\0]/.test(value)) {
            throw new Error(`Invalid value for ${key}.`);
        }
        applied[key] = value;
    }

    const existing = fs.existsSync(envFile)
        ? fs.readFileSync(envFile, "utf8")
        : "";
    const lines = existing ? existing.split(/\r?\n/) : [];
    const seen = new Set();
    const next = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
            return line;
        }
        const separator = trimmed.indexOf("=");
        const key = trimmed.slice(0, separator).trim();
        if (!applied[key]) return line;
        seen.add(key);
        return `${key}=${applied[key]}`;
    });
    for (const key of Object.keys(applied)) {
        if (!seen.has(key)) next.push(`${key}=${applied[key]}`);
    }
    if (!existing && next.length) {
        next.unshift(`# ${PRODUCT_NAME} local configuration`);
    }
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(
        envFile,
        `${next.join("\n").replace(/\n*$/, "")}\n`,
        { encoding: "utf8", mode: 0o600 }
    );
    fs.chmodSync(envFile, 0o600);
    for (const [key, value] of Object.entries(applied)) {
        process.env[key] = value;
    }
    refreshProviderSecrets();
    return { saved: Object.keys(applied), envFile };
}

module.exports = {
    ROOT_DIR,
    ENV_FILE,
    PRODUCT_NAME,
    DATA_DIR,
    WORKSPACES_DIR,
    LEGACY_WORKSPACE_DIR,
    DATABASE_FILE,

    PORT,
    HOST,

    DEFAULT_PROVIDER,
    PROVIDERS,
    MODEL_ROLES,
    LOCAL_FALLBACK_MODEL,

    LIMITS,
    FEATURES,
    PLATFORM,
    SETTINGS_ENV_KEYS,

    envString,
    envNumber,
    envBool,
    persistEnvValues,
    refreshProviderSecrets
};

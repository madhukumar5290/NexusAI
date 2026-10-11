/*
=========================================================
PROVIDER GATEWAY
=========================================================
One chat interface, three backends, chosen automatically:

 1. OPENAI_API_KEY / OPENAI_MODEL       -> OpenAI (GPT)
 2. ANTHROPIC_API_KEY / ANTHROPIC_MODEL -> Anthropic (Claude)
 3. otherwise                           -> local Ollama

All functions accept a messages array:
  [{ role: "system"|"user"|"assistant", content: "..." }]

Streaming functions call onToken(chunk) with text deltas.
=========================================================
*/

const OLLAMA_URL =
    process.env.OLLAMA_URL ||
    "http://localhost:11434/api/chat";

function detectProvider() {
    if (process.env.OPENAI_API_KEY) {
        return {
            type: "openai",
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl:
                process.env.OPENAI_BASE_URL ||
                "https://api.openai.com/v1",
            model:
                process.env.OPENAI_MODEL ||
                "gpt-4o-mini"
        };
    }

    if (process.env.ANTHROPIC_API_KEY) {
        return {
            type: "anthropic",
            apiKey: process.env.ANTHROPIC_API_KEY,
            baseUrl:
                process.env.ANTHROPIC_BASE_URL ||
                "https://api.anthropic.com/v1",
            model:
                process.env.ANTHROPIC_MODEL ||
                "claude-sonnet-4-20250514"
        };
    }

    return {
        type: "ollama",
        model:
            process.env.OLLAMA_MODEL ||
            "qwen2.5:1.5b"
    };
}

function normalizeMessages(messages) {
    const cleaned = [];

    for (const message of messages || []) {
        const role =
            message?.role === "system" ||
                message?.role === "assistant"
                ? message.role
                : "user";

        const content =
            String(message?.content || "");

        if (!content.trim()) {
            continue;
        }

        cleaned.push({ role, content });
    }

    return cleaned;
}

/*
=========================================================
OPENAI
=========================================================
*/

async function openaiChat(provider, messages, { signal, ...rest } = {}) {
    const response = await fetch(
        `${provider.baseUrl}/chat/completions`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
                model: provider.model,
                messages,
                ...openaiSampling(samplingOptions(rest))
            }),
            signal
        }
    );

    if (!response.ok) {
        throw new Error(
            `OpenAI returned HTTP ${response.status}`
        );
    }

    const data = await response.json();

    return String(
        data?.choices?.[0]?.message?.content || ""
    ).trim();
}

async function openaiStream(
    provider,
    messages,
    onToken,
    { signal } = {}
) {
    const response = await fetch(
        `${provider.baseUrl}/chat/completions`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
                model: provider.model,
                messages,
                stream: true
            }),
            signal
        }
    );

    if (!response.ok) {
        throw new Error(
            `OpenAI returned HTTP ${response.status}`
        );
    }

    await readSSE(response, payload => {
        const token =
            payload?.choices?.[0]?.delta?.content || "";

        if (token) {
            onToken(token);
        }
    });
}

/*
=========================================================
ANTHROPIC
=========================================================
*/

async function anthropicChat(provider, messages, { signal, ...rest } = {}) {
    const system = messages
        .filter(m => m.role === "system")
        .map(m => m.content)
        .join("\n\n");

    const chat = messages
        .filter(m => m.role !== "system")
        .map(m => ({
            role: m.role,
            content: m.content
        }));

    const response = await fetch(
        `${provider.baseUrl}/messages`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": provider.apiKey,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: provider.model,
                system: system || undefined,
                messages: chat,
                ...anthropicSampling(samplingOptions(rest))
            }),
            signal
        }
    );

    if (!response.ok) {
        throw new Error(
            `Anthropic returned HTTP ${response.status}`
        );
    }

    const data = await response.json();

    return String(
        data?.content?.[0]?.text || ""
    ).trim();
}

async function anthropicStream(
    provider,
    messages,
    onToken,
    { signal } = {}
) {
    const system = messages
        .filter(m => m.role === "system")
        .map(m => m.content)
        .join("\n\n");

    const chat = messages
        .filter(m => m.role !== "system")
        .map(m => ({
            role: m.role,
            content: m.content
        }));

    const response = await fetch(
        `${provider.baseUrl}/messages`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": provider.apiKey,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: provider.model,
                max_tokens: 4096,
                system: system || undefined,
                messages: chat,
                stream: true
            }),
            signal
        }
    );

    if (!response.ok) {
        throw new Error(
            `Anthropic returned HTTP ${response.status}`
        );
    }

    await readSSE(response, payload => {
        if (payload?.type !== "content_block_delta") {
            return;
        }

        const token =
            payload?.delta?.text || "";

        if (token) {
            onToken(token);
        }
    });
}

/*
=========================================================
OLLAMA
=========================================================
*/

/*
Translate Nexus's provider-neutral sampling options into each
provider's own field names. Only non-null values are included, so a
provider keeps its defaults for anything the user did not set.
*/
function samplingOptions(options = {}) {
    const num = value => {
        if (value === "" || value == null) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    return {
        temperature: num(options.temperature),
        topP: num(options.topP),
        topK: num(options.topK),
        maxTokens: num(options.maxTokens),
        repetitionPenalty: num(options.repetitionPenalty),
        seed: num(options.seed)
    };
}

/* OpenAI-family request fields. */
function openaiSampling(sampling) {
    const out = {};
    if (sampling.temperature != null) out.temperature = sampling.temperature;
    if (sampling.topP != null) out.top_p = sampling.topP;
    if (sampling.maxTokens != null) out.max_tokens = sampling.maxTokens;
    if (sampling.seed != null) out.seed = sampling.seed;
    return out;
}

/* Ollama request fields (its own names, nested under options). */
function ollamaSampling(sampling) {
    const options = {};
    if (sampling.temperature != null) options.temperature = sampling.temperature;
    if (sampling.topP != null) options.top_p = sampling.topP;
    if (sampling.topK != null && sampling.topK > 0) options.top_k = sampling.topK;
    if (sampling.maxTokens != null) options.num_predict = sampling.maxTokens;
    if (sampling.repetitionPenalty != null) options.repeat_penalty = sampling.repetitionPenalty;
    if (sampling.seed != null) options.seed = sampling.seed;
    return Object.keys(options).length ? { options } : {};
}

/* Anthropic request fields. */
function anthropicSampling(sampling) {
    const out = {};
    if (sampling.temperature != null) out.temperature = sampling.temperature;
    if (sampling.topP != null) out.top_p = sampling.topP;
    if (sampling.topK != null && sampling.topK > 0) out.top_k = sampling.topK;
    /* Anthropic requires max_tokens; keep a sane default when unset. */
    out.max_tokens = sampling.maxTokens != null ? sampling.maxTokens : 4096;
    return out;
}

async function ollamaChat(provider, messages, { signal, ...rest } = {}) {
    const body = {
        model: provider.model,
        messages,
        stream: false,
        ...ollamaSampling(samplingOptions(rest))
    };

    // Vision support: pass an image attached to the last user message.
    if (provider.imageBase64) {
        const lastUser = [...messages]
            .reverse()
            .find(m => m.role === "user");

        if (lastUser) {
            lastUser.images = [provider.imageBase64];
        }
    }

    const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal
    });

    if (!response.ok) {
        throw new Error(
            `Ollama returned HTTP ${response.status}`
        );
    }

    const data = await response.json();

    return String(
        data?.message?.content || ""
    ).trim();
}

async function ollamaStream(
    provider,
    messages,
    onToken,
    { signal } = {}
) {
    const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: provider.model,
            messages,
            stream: true
        }),
        signal
    });

    if (!response.ok) {
        throw new Error(
            `Ollama returned HTTP ${response.status}`
        );
    }

    await readNDJSON(response, payload => {
        const token =
            payload?.message?.content || "";

        if (token) {
            onToken(token);
        }
    });
}

/*
=========================================================
STREAM READERS
=========================================================
*/

async function readSSE(response, onData) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();

        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            const trimmed = line.trim();

            if (!trimmed.startsWith("data:")) {
                continue;
            }

            const payload = trimmed.slice(5).trim();

            if (!payload || payload === "[DONE]") {
                continue;
            }

            try {
                onData(JSON.parse(payload));
            } catch { }
        }
    }
}

async function readNDJSON(response, onData) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();

        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }

            try {
                onData(JSON.parse(line));
            } catch { }
        }
    }
}

/*
=========================================================
PUBLIC API
=========================================================
*/

function resolveProvider(options = {}) {
    const provider = detectProvider();

    /*
    Allow callers (the model router) to override the model
    per request while keeping the detected provider backend.
    */
    if (options.model) {
        return { ...provider, model: options.model };
    }

    return provider;
}

function stripOptions(options = {}) {
    const { model, ...rest } = options;
    return rest;
}

async function chat(messages, options = {}) {
    const provider = resolveProvider(options);
    const cleaned = normalizeMessages(messages);
    const rest = stripOptions(options);

    if (provider.type === "openai") {
        return openaiChat(provider, cleaned, rest);
    }

    if (provider.type === "anthropic") {
        return anthropicChat(provider, cleaned, rest);
    }

    return ollamaChat(provider, cleaned, rest);
}

/*
Compatibility wrapper for artifact-oriented agents. The
provider registry is the canonical transport, while older
agents consume a response object with text/content.
*/
async function complete(options = {}) {
    const {
        messages = [],
        ...requestOptions
    } = options;

    const text = await chat(
        messages,
        requestOptions
    );

    return {
        text,
        content: text
    };
}

async function chatStream(messages, onToken, options = {}) {
    const provider = resolveProvider(options);
    const cleaned = normalizeMessages(messages);
    const rest = stripOptions(options);

    if (provider.type === "openai") {
        return openaiStream(provider, cleaned, onToken, rest);
    }

    if (provider.type === "anthropic") {
        return anthropicStream(provider, cleaned, onToken, rest);
    }

    return ollamaStream(provider, cleaned, onToken, rest);
}

function getActiveProvider() {
    const provider = detectProvider();

    return {
        type: provider.type,
        model: provider.model
    };
}

module.exports = {
    chat,
    complete,
    chatStream,
    getActiveProvider,
    normalizeMessages
};

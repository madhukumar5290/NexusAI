/*
=========================================================
SHARED PROVIDER PRIMITIVES
=========================================================
Every provider speaks the same normalized
language, so the agent loop never cares which
model backend is behind it.

Normalized request:
  {
    system, messages, tools, temperature, maxTokens
  }

Normalized stream events:
  { type: "text_delta",  text }
  { type: "tool_call",   id, name, arguments }
  { type: "usage",       usage }
  { type: "done",        finishReason }
=========================================================
*/

class ProviderError extends Error {
    constructor(message, options = {}) {
        super(message);

        this.name = "ProviderError";

        this.provider = options.provider || "unknown";
        this.status = options.status || 0;
        this.retryable = Boolean(options.retryable);
    }
}

/*
=========================================================
ARGUMENTS
=========================================================
Models return tool arguments either as a real
object or as a JSON string. Normalize both.
=========================================================
*/

function parseArguments(raw) {
    if (raw == null || raw === "") {
        return {};
    }

    if (typeof raw === "object") {
        return raw;
    }

    const text = String(raw).trim();

    try {
        const parsed = JSON.parse(text);

        return parsed && typeof parsed === "object"
            ? parsed
            : {};
    } catch {
        /* try to recover a JSON object embedded in prose */

        const first = text.indexOf("{");
        const last = text.lastIndexOf("}");

        if (first !== -1 && last > first) {
            try {
                return JSON.parse(
                    text.slice(first, last + 1)
                );
            } catch {
                return {};
            }
        }

        return {};
    }
}

/*
=========================================================
SCHEMA
=========================================================
Providers differ on whether a null/absent
parameter schema is allowed. Always hand them
a valid JSON Schema object.
=========================================================
*/

function normalizeSchema(schema) {
    if (
        !schema ||
        typeof schema !== "object" ||
        Array.isArray(schema)
    ) {
        return {
            type: "object",
            properties: {}
        };
    }

    if (!schema.type) {
        return {
            ...schema,
            type: "object",
            properties: schema.properties || {}
        };
    }

    return schema;
}

/*
=========================================================
ERROR BODY
=========================================================
Read a failed response without ever throwing
from the error path itself.
=========================================================
*/

async function readErrorBody(response) {
    try {
        const text = await response.text();

        if (!text) {
            return `HTTP ${response.status}`;
        }

        try {
            const data = JSON.parse(text);
            const nested = data?.error;

            if (typeof nested === "string") {
                return nested;
            }

            if (nested?.message) {
                return nested.message;
            }

            if (data?.message) {
                return data.message;
            }
        } catch {
            /* not JSON - return raw text */
        }

        return text.slice(0, 500);
    } catch {
        return `HTTP ${response.status}`;
    }
}

async function assertOk(response, provider) {
    if (response.ok) {
        return;
    }

    const detail = await readErrorBody(response);

    const retryable =
        response.status === 429 ||
        response.status >= 500;

    throw new ProviderError(
        `${provider} request failed (${response.status}): ${detail}`,
        {
            provider,
            status: response.status,
            retryable
        }
    );
}

/*
=========================================================
STREAM HELPERS
=========================================================
Providers emit newline-delimited JSON (NDJSON)
or Server-Sent Events. Both are line oriented,
so the reader is shared; only the prefix
stripping differs.
=========================================================
*/

async function* readLines(body, { stripSse = false } = {}) {
    const reader = body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();

        if (done) {
            break;
        }

        buffer += decoder.decode(value, {
            stream: true
        });

        const lines = buffer.split("\n");

        buffer = lines.pop() || "";

        for (const line of lines) {
            const trimmed = line.trim();

            if (!trimmed) {
                continue;
            }

            if (stripSse) {
                if (!trimmed.startsWith("data:")) {
                    continue;
                }

                const payload = trimmed
                    .slice(5)
                    .trim();

                if (payload === "[DONE]") {
                    return;
                }

                yield payload;

                continue;
            }

            yield trimmed;
        }
    }

    const tail = buffer.trim();

    if (tail) {
        yield stripSse && tail.startsWith("data:")
            ? tail.slice(5).trim()
            : tail;
    }
}

function tryJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/*
=========================================================
COLLECT
=========================================================
Drain a provider stream into a finished
assistant turn. Used by non-streaming callers
(planning, summarising) and by tests.
=========================================================
*/

async function collect(stream) {
    let text = "";
    const toolCalls = [];
    let usage = null;
    let finishReason = "stop";

    for await (const event of stream) {
        switch (event.type) {
            case "text_delta":
                text += event.text;
                break;

            case "tool_call":
                toolCalls.push({
                    id: event.id,
                    name: event.name,
                    arguments: event.arguments
                });
                break;

            case "usage":
                usage = event.usage;
                break;

            case "done":
                finishReason =
                    event.finishReason || "stop";
                break;

            default:
                break;
        }
    }

    return {
        text,
        toolCalls,
        usage,
        finishReason
    };
}

/*
=========================================================
MESSAGES
=========================================================
The agent loop passes a neutral message list.
Each provider translates it. These helpers
cover the two shapes that actually appear:
plain text turns, and tool turns.
=========================================================
*/

function isToolTurn(message) {
    return Boolean(
        message &&
        Array.isArray(message.toolCalls) &&
        message.toolCalls.length
    );
}

function toPlainText(message) {
    if (!message) {
        return "";
    }

    if (typeof message.content === "string") {
        return message.content;
    }

    if (Array.isArray(message.content)) {
        return message.content
            .map(part =>
                typeof part === "string"
                    ? part
                    : part?.text || ""
            )
            .join("");
    }

    return "";
}

module.exports = {
    ProviderError,

    parseArguments,
    normalizeSchema,

    readErrorBody,
    assertOk,

    readLines,
    tryJson,

    collect,

    isToolTurn,
    toPlainText
};

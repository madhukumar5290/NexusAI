const {
    assertOk,
    normalizeSchema,
    parseArguments,
    toPlainText,
    readLines,
    tryJson,
    isToolTurn,
    collect,
    ProviderError
} = require("./base");

/*
=========================================================
OLLAMA PROVIDER (native)
=========================================================
POST {baseUrl}/api/chat
GET  {baseUrl}/api/tags

Uses Ollama's native protocol rather than its
OpenAI shim, because the native endpoint
returns tool calls as real objects and handles
tool_name matching correctly on older
versions.
=========================================================
*/

function toOllamaMessages(system, messages) {
    const output = [];

    if (system) {
        output.push({
            role: "system",
            content: system
        });
    }

    for (const message of messages || []) {
        if (message.role === "tool") {
            output.push({
                role: "tool",
                content: toPlainText(message),

                tool_name:
                    message.name ||
                    message.toolName ||
                    "tool"
            });

            continue;
        }

        if (isToolTurn(message)) {
            output.push({
                role: "assistant",

                content: toPlainText(message) || "",

                tool_calls: message.toolCalls.map(
                    call => ({
                        function: {
                            name: call.name,

                            arguments:
                                typeof call.arguments ===
                                "string"
                                    ? parseArguments(
                                          call.arguments
                                      )
                                    : call.arguments || {}
                        }
                    })
                )
            });

            continue;
        }

        output.push({
            role: message.role || "user",
            content: toPlainText(message)
        });
    }

    return output;
}

function toOllamaTools(tools) {
    if (!tools || !tools.length) {
        return undefined;
    }

    return tools.map(tool => ({
        type: "function",

        function: {
            name: tool.name,
            description: tool.description || "",
            parameters: normalizeSchema(
                tool.parameters
            )
        }
    }));
}

function baseUrl(provider) {
    return provider.baseUrl.replace(/\/+$/, "");
}

/*
Ollama does not always report a stable call
id, so synthesize one that is unique within
the turn.
*/

let callCounter = 0;

function nextCallId() {
    callCounter += 1;

    return `ollama_call_${Date.now()}_${callCounter}`;
}

function readToolCalls(message) {
    const calls = message?.tool_calls || [];

    return calls
        .filter(call =>
            Boolean(call?.function?.name)
        )
        .map(call => ({
            id: nextCallId(),
            name: call.function.name,

            arguments: parseArguments(
                call.function.arguments
            )
        }));
}

/*
=========================================================
CHAT
=========================================================
*/

async function* chat(request, provider) {
    const tools = toOllamaTools(request.tools);

    const streaming = request.stream !== false;

    const options = {};

    if (request.temperature != null) {
        options.temperature = request.temperature;
    }

    if (request.maxTokens) {
        options.num_predict = request.maxTokens;
    }

    const body = {
        model: request.model,

        messages: toOllamaMessages(
            request.system,
            request.messages
        ),

        stream: streaming
    };

    if (tools) {
        body.tools = tools;
    }

    if (Object.keys(options).length) {
        body.options = options;
    }

    let response;

    try {
        response = await fetch(`${baseUrl(provider)}/api/chat`, {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(body),
            signal: request.signal
        });
    } catch (error) {
        if (error?.name === "AbortError") {
            throw error;
        }

        throw new ProviderError(
            `Could not reach Ollama at ${baseUrl(provider)}. ` +
                "Is `ollama serve` running?",
            { provider: "ollama", retryable: true }
        );
    }

    await assertOk(response, "ollama");

    if (!streaming) {
        const data = await response.json();

        yield* fromPayload(data, true);

        return;
    }

    if (!response.body) {
        throw new ProviderError(
            "Ollama returned no stream body.",
            { provider: "ollama" }
        );
    }

    for await (const line of readLines(response.body)) {
        const data = tryJson(line);

        if (!data) {
            continue;
        }

        yield* fromPayload(data, false);

        if (data.done) {
            break;
        }
    }
}

/*
=========================================================
PAYLOAD -> EVENTS
=========================================================
Shared by streaming and buffered modes.
=========================================================
*/

function* fromPayload(data, buffered) {
    const message = data?.message || {};

    const text =
        typeof message.content === "string"
            ? message.content
            : "";

    if (text) {
        yield {
            type: "text_delta",
            text
        };
    }

    for (const call of readToolCalls(message)) {
        yield {
            type: "tool_call",
            ...call
        };
    }

    /*
    Ollama's OpenAI shim exposes tool_calls
    directly on the payload.
    */

    for (const call of data?.tool_calls || []) {
        if (!call?.function?.name) {
            continue;
        }

        yield {
            type: "tool_call",
            id: nextCallId(),
            name: call.function.name,

            arguments: parseArguments(
                call.function.arguments
            )
        };
    }

    if (buffered || data.done) {
        if (
            data.prompt_eval_count ||
            data.eval_count
        ) {
            yield {
                type: "usage",

                usage: {
                    prompt_tokens:
                        data.prompt_eval_count || 0,

                    completion_tokens:
                        data.eval_count || 0,

                    total_tokens:
                        (data.prompt_eval_count || 0) +
                        (data.eval_count || 0)
                }
            };
        }

        yield {
            type: "done",

            finishReason:
                data.done_reason ||
                (message.tool_calls?.length
                    ? "tool_calls"
                    : "stop")
        };
    }
}

/*
=========================================================
MODELS
=========================================================
*/

async function listModels(provider) {
    const response = await fetch(
        `${baseUrl(provider)}/api/tags`,
        {
            signal: AbortSignal.timeout(6000)
        }
    );

    await assertOk(response, "ollama");

    const data = await response.json();

    return (data?.models || [])
        .map(model => model.name)
        .filter(Boolean);
}

function validModelName(value) {
    return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/.test(value.trim());
}

async function pullModel(provider, model) {
    if (!validModelName(model)) throw new TypeError("A valid Ollama model name is required.");
    const response = await fetch(`${baseUrl(provider)}/api/pull`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model.trim(), stream: false }),
        signal: AbortSignal.timeout(30 * 60 * 1000)
    });
    await assertOk(response, "ollama");
    return response.json();
}

async function deleteModel(provider, model) {
    if (!validModelName(model)) throw new TypeError("A valid Ollama model name is required.");
    const response = await fetch(`${baseUrl(provider)}/api/delete`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model.trim() }), signal: AbortSignal.timeout(30000)
    });
    await assertOk(response, "ollama");
    return { ok: true, model: model.trim() };
}

/*
Detect whether a model supports tool
calling, so the UI can warn instead of
silently failing.
*/

async function supportsTools(provider, model) {
    try {
        const response = await fetch(
            `${baseUrl(provider)}/api/show`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({ model }),

                signal: AbortSignal.timeout(6000)
            }
        );

        if (!response.ok) {
            return false;
        }

        const data = await response.json();

        const capabilities =
            data?.capabilities || [];

        if (capabilities.length) {
            return capabilities.includes("tools");
        }

        const template =
            data?.template || "";

        return /\.Tools|tools\b/i.test(template);
    } catch {
        return false;
    }
}

module.exports = {
    id: "ollama",
    toOllamaMessages,
    toOllamaTools,
    chat,
    listModels,
    pullModel,
    deleteModel,
    supportsTools
};

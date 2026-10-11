const {
    assertOk,
    normalizeSchema,
    parseArguments,
    toPlainText,
    readLines,
    tryJson,
    isToolTurn,
    ProviderError
} = require("./base");

/*
=========================================================
ANTHROPIC PROVIDER
=========================================================
POST {baseUrl}/messages

Anthropic differs from OpenAI in three ways
that matter:

1. tool_result blocks live inside a *user*
   message, not a standalone tool role.
2. max_tokens is required.
3. system is a top-level field, not a message.
=========================================================
*/

const API_VERSION = "2023-06-01";

const DEFAULT_MAX_TOKENS = 8192;

function toAnthropicMessages(messages) {
    const output = [];

    for (const message of messages || []) {
        if (message.role === "tool") {
            const block = {
                type: "tool_result",

                tool_use_id:
                    message.toolCallId ||
                    message.tool_call_id,

                content: toPlainText(message)
            };

            const previous =
                output[output.length - 1];

            /*
            Consecutive tool results must be
            batched into a single user turn, or
            Anthropic rejects the request.
            */

            if (
                previous &&
                previous.role === "user" &&
                Array.isArray(previous.content) &&
                previous.content.every(
                    part => part.type === "tool_result"
                )
            ) {
                previous.content.push(block);
            } else {
                output.push({
                    role: "user",
                    content: [block]
                });
            }

            continue;
        }

        if (isToolTurn(message)) {
            const content = [];

            const text = toPlainText(message);

            if (text) {
                content.push({
                    type: "text",
                    text
                });
            }

            for (const call of message.toolCalls) {
                content.push({
                    type: "tool_use",
                    id: call.id,
                    name: call.name,

                    input:
                        typeof call.arguments ===
                        "string"
                            ? parseArguments(
                                  call.arguments
                              )
                            : call.arguments || {}
                });
            }

            output.push({
                role: "assistant",
                content
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

function toAnthropicTools(tools) {
    if (!tools || !tools.length) {
        return undefined;
    }

    return tools.map(tool => ({
        name: tool.name,
        description: tool.description || "",

        input_schema: normalizeSchema(
            tool.parameters
        )
    }));
}

function buildHeaders(provider) {
    return {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": API_VERSION
    };
}

/*
=========================================================
CHAT
=========================================================
*/

async function* chat(request, provider) {
    if (!provider.apiKey) {
        throw new ProviderError(
            "Anthropic requires ANTHROPIC_API_KEY in .env",
            { provider: "anthropic" }
        );
    }

    const tools = toAnthropicTools(request.tools);

    const streaming = request.stream !== false;

    const body = {
        model: request.model,

        messages: toAnthropicMessages(
            request.messages
        ),

        max_tokens:
            request.maxTokens || DEFAULT_MAX_TOKENS,

        stream: streaming
    };

    if (request.system) {
        body.system = request.system;
    }

    if (tools) {
        body.tools = tools;

        if (request.toolChoice === "none") {
            body.tool_choice = { type: "none" };
        }
    } else if (request.temperature != null) {
        body.temperature = request.temperature;
    }

    const response = await fetch(
        `${provider.baseUrl.replace(/\/+$/, "")}/messages`,
        {
            method: "POST",
            headers: buildHeaders(provider),
            body: JSON.stringify(body),
            signal: request.signal
        }
    );

    await assertOk(response, "anthropic");

    if (!streaming) {
        const data = await response.json();

        yield* fromPayload(data);

        return;
    }

    if (!response.body) {
        throw new ProviderError(
            "Anthropic returned no stream body.",
            { provider: "anthropic" }
        );
    }

    yield* streamEvents(response.body);
}

/*
=========================================================
BUFFERED
=========================================================
*/

function* fromPayload(data) {
    for (const block of data?.content || []) {
        if (block.type === "text" && block.text) {
            yield {
                type: "text_delta",
                text: block.text
            };
        }

        if (block.type === "tool_use") {
            yield {
                type: "tool_call",
                id: block.id,
                name: block.name,
                arguments: block.input || {}
            };
        }
    }

    if (data?.usage) {
        yield {
            type: "usage",

            usage: {
                prompt_tokens:
                    data.usage.input_tokens || 0,

                completion_tokens:
                    data.usage.output_tokens || 0,

                total_tokens:
                    (data.usage.input_tokens || 0) +
                    (data.usage.output_tokens || 0)
            }
        };
    }

    yield {
        type: "done",
        finishReason: data?.stop_reason || "stop"
    };
}

/*
=========================================================
STREAMING
=========================================================
content_block_delta carries partial JSON for
tool inputs, which must be accumulated per
block index before it can be parsed.
=========================================================
*/

async function* streamEvents(body) {
    const blocks = new Map();

    let finishReason = "stop";
    let usage = null;

    for await (const line of readLines(body, {
        stripSse: true
    })) {
        const data = tryJson(line);

        if (!data) {
            continue;
        }

        switch (data.type) {
            case "content_block_start": {
                const block = data.content_block || {};

                if (block.type === "tool_use") {
                    blocks.set(data.index, {
                        id: block.id,
                        name: block.name,
                        json: ""
                    });
                }

                break;
            }

            case "content_block_delta": {
                const delta = data.delta || {};

                if (
                    delta.type === "text_delta" &&
                    delta.text
                ) {
                    yield {
                        type: "text_delta",
                        text: delta.text
                    };
                }

                if (
                    delta.type === "input_json_delta" &&
                    blocks.has(data.index)
                ) {
                    blocks.get(data.index).json +=
                        delta.partial_json || "";
                }

                break;
            }

            case "message_delta": {
                if (data.delta?.stop_reason) {
                    finishReason =
                        data.delta.stop_reason;
                }

                if (data.usage) {
                    usage = {
                        completion_tokens:
                            data.usage.output_tokens || 0
                    };
                }

                break;
            }

            case "message_start": {
                const start = data.message?.usage;

                if (start) {
                    usage = {
                        ...usage,
                        prompt_tokens:
                            start.input_tokens || 0
                    };
                }

                break;
            }

            case "error": {
                throw new ProviderError(
                    data.error?.message ||
                        "Anthropic stream error",
                    { provider: "anthropic" }
                );
            }

            default:
                break;
        }
    }

    for (const block of blocks.values()) {
        yield {
            type: "tool_call",
            id: block.id,
            name: block.name,
            arguments: parseArguments(block.json)
        };
    }

    if (usage) {
        yield {
            type: "usage",
            usage
        };
    }

    yield {
        type: "done",
        finishReason
    };
}

/*
=========================================================
MODELS
=========================================================
*/

async function listModels(provider) {
    const response = await fetch(
        `${provider.baseUrl.replace(/\/+$/, "")}/models`,
        {
            headers: buildHeaders(provider),
            signal: AbortSignal.timeout(6000)
        }
    );

    await assertOk(response, "anthropic");

    const data = await response.json();

    return (data?.data || [])
        .map(model => model.id)
        .filter(Boolean);
}

module.exports = {
    id: "anthropic",
    toAnthropicMessages,
    toAnthropicTools,
    buildHeaders,
    chat,
    listModels
};

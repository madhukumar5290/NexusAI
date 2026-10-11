const {
    assertOk,
    normalizeSchema,
    parseArguments,
    toPlainText,
    readLines,
    tryJson,
    isToolTurn
} = require("./base");

/*
=========================================================
OPENAI-COMPATIBLE PROVIDER
=========================================================
POST {baseUrl}/chat/completions
GET  {baseUrl}/models

Covers OpenAI, Groq, OpenRouter, DeepSeek,
Together, Fireworks, LM Studio, llama.cpp
server, vLLM, and Ollama's OpenAI endpoint.

Supports buffered and streaming modes so
planning calls stay cheap while the
user-facing turn streams.
=========================================================
*/

function buildHeaders(provider) {
    const headers = {
        "Content-Type": "application/json"
    };

    if (provider.apiKey) {
        headers.Authorization =
            `Bearer ${provider.apiKey}`;
    }

    return headers;
}

function toOpenAIMessages(system, messages) {
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

                tool_call_id:
                    message.toolCallId ||
                    message.tool_call_id,

                content: toPlainText(message)
            });

            continue;
        }

        if (isToolTurn(message)) {
            output.push({
                role: "assistant",

                content:
                    toPlainText(message) || null,

                tool_calls: message.toolCalls.map(
                    call => ({
                        id: call.id,
                        type: "function",

                        function: {
                            name: call.name,

                            arguments:
                                typeof call.arguments ===
                                "string"
                                    ? call.arguments
                                    : JSON.stringify(
                                          call.arguments ||
                                              {}
                                      )
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

function toOpenAITools(tools) {
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

/*
Some providers stream a function name in
fragments, others send it once. Merge both
shapes without duplicating.
*/

function mergeName(current, fragment) {
    if (!fragment) {
        return current || "";
    }

    if (!current) {
        return fragment;
    }

    if (fragment === current) {
        return current;
    }

    if (fragment.startsWith(current)) {
        return fragment;
    }

    return current + fragment;
}

function readToolCall(call) {
    return {
        id:
            call.id ||
            `call_${Math.random()
                .toString(36)
                .slice(2, 10)}`,

        name: call.function?.name || "",
        arguments: parseArguments(
            call.function?.arguments
        )
    };
}

/*
=========================================================
CHAT
=========================================================
Yields normalized events. The agent loop
consumes these identically for every provider.
=========================================================
*/

async function* chat(request, provider) {
    if (request.useResponses) {
        yield* responsesChat(request, provider);
        return;
    }

    const tools = toOpenAITools(request.tools);

    const streaming = request.stream !== false;

    const body = {
        model: request.model,

        messages: toOpenAIMessages(
            request.system,
            request.messages
        ),

        stream: streaming
    };

    if (tools) {
        body.tools = tools;
        body.tool_choice =
            request.toolChoice || "auto";
    } else if (request.temperature != null) {
        /*
        Several gateways reject temperature on
        tool-calling turns, so only send it for
        plain completion.
        */

        body.temperature = request.temperature;
    }

    if (request.maxTokens) {
        body.max_tokens = request.maxTokens;
    }

    const response = await fetch(
        `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
            method: "POST",
            headers: buildHeaders(provider),
            body: JSON.stringify(body),
            signal: request.signal
        }
    );

    await assertOk(response, "openai");

    if (!streaming) {
        yield* buffered(response);
        return;
    }

    if (!response.body) {
        throw new Error(
            "openai provider returned no stream body"
        );
    }

    yield* streaming_(response);
}

/*
The Responses API is used for models whose advanced tool capabilities are
available there (notably GPT-6 Astra).  Keep the normalized event contract so
the existing agent loop works with either OpenAI transport.
*/
function toResponsesTools(tools) {
    return (tools || []).map(tool => ({
        type: "function",
        name: tool.name,
        description: tool.description || "",
        parameters: normalizeSchema(tool.parameters),
        strict: false
    }));
}

function toResponsesInput(messages) {
    return (messages || []).map(message => ({
        role: message.role === "tool" ? "user" : (message.role || "user"),
        content: toPlainText(message)
    }));
}

async function* responsesChat(request, provider) {
    const body = {
        model: request.model,
        input: toResponsesInput(request.messages),
        store: false
    };
    if (request.system) body.instructions = request.system;
    if (request.maxTokens) body.max_output_tokens = request.maxTokens;
    if (request.tools?.length) {
        body.tools = toResponsesTools(request.tools);
        body.tool_choice = request.toolChoice || "auto";
    }
    if (request.reasoningEffort) body.reasoning = { effort: request.reasoningEffort };

    const response = await fetch(
        `${provider.baseUrl.replace(/\/+$/, "")}/responses`,
        { method: "POST", headers: buildHeaders(provider), body: JSON.stringify(body), signal: request.signal }
    );
    await assertOk(response, "openai-responses");
    const data = await response.json();
    for (const item of data.output || []) {
        if (item.type === "message") {
            for (const content of item.content || []) {
                if (content.type === "output_text" && content.text) {
                    yield { type: "text_delta", text: content.text };
                }
            }
        }
        if (item.type === "function_call") {
            yield {
                type: "tool_call",
                id: item.call_id || item.id || `call_${Date.now()}`,
                name: item.name || "",
                arguments: parseArguments(item.arguments)
            };
        }
    }
    if (data.usage) yield { type: "usage", usage: data.usage };
    yield { type: "done", finishReason: data.status || "completed" };
}

async function* buffered(response) {
    const data = await response.json();

    const choice = data?.choices?.[0] || {};
    const message = choice.message || {};

    if (
        typeof message.content === "string" &&
        message.content
    ) {
        yield {
            type: "text_delta",
            text: message.content
        };
    }

    for (const call of message.tool_calls || []) {
        yield {
            type: "tool_call",
            ...readToolCall(call)
        };
    }

    if (data?.usage) {
        yield {
            type: "usage",
            usage: data.usage
        };
    }

    yield {
        type: "done",
        finishReason: choice.finish_reason || "stop"
    };
}

async function* streaming_(response) {
    const pending = new Map();

    let finishReason = "stop";
    let usage = null;

    for await (const line of readLines(
        response.body,
        { stripSse: true }
    )) {
        const data = tryJson(line);

        if (!data) {
            continue;
        }

        if (data.usage) {
            usage = data.usage;
        }

        const choice = data.choices?.[0];

        if (!choice) {
            continue;
        }

        if (choice.finish_reason) {
            finishReason = choice.finish_reason;
        }

        const delta = choice.delta || {};

        /*
        Ollama and a few gateways send a whole
        message instead of a delta.
        */

        const text =
            typeof delta.content === "string"
                ? delta.content
                : typeof choice.message?.content ===
                    "string"
                  ? choice.message.content
                  : "";

        if (text) {
            yield {
                type: "text_delta",
                text
            };
        }

        const calls =
            delta.tool_calls ||
            choice.message?.tool_calls ||
            [];

        for (const call of calls) {
            const index = call.index ?? 0;

            if (!pending.has(index)) {
                pending.set(index, {
                    id: null,
                    name: "",
                    args: ""
                });
            }

            const entry = pending.get(index);

            if (call.id) {
                entry.id = call.id;
            }

            entry.name = mergeName(
                entry.name,
                call.function?.name
            );

            if (call.function?.arguments) {
                entry.args +=
                    call.function.arguments;
            }
        }
    }

    for (const [index, entry] of pending) {
        yield {
            type: "tool_call",

            id:
                entry.id ||
                `call_${index}_${Date.now()}`,

            name: entry.name,
            arguments: parseArguments(entry.args)
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

    await assertOk(response, "openai");

    const data = await response.json();

    const rows = Array.isArray(data)
        ? data
        : data?.data || [];

    return rows
        .map(row =>
            typeof row === "string" ? row : row.id
        )
        .filter(Boolean);
}

module.exports = {
    id: "openai",
    buildHeaders,
    toOpenAIMessages,
    toOpenAITools,
    toResponsesTools,
    toResponsesInput,
    responsesChat,
    mergeName,
    chat,
    listModels
};

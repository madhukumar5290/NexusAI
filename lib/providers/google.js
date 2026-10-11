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
GOOGLE GEMINI PROVIDER
=========================================================
POST {baseUrl}/models/{model}:streamGenerateContent?alt=sse
POST {baseUrl}/models/{model}:generateContent

Differences from OpenAI that matter here:

1. The assistant role is called "model".
2. The system prompt is a separate field.
3. JSON Schema types must be UPPERCASE.
4. Tool results are functionResponse parts
   inside a user turn.
=========================================================
*/

/*
Gemini rejects lowercase schema types, so
map the whole schema tree.
*/

function toGeminiSchema(schema) {
    const normalized = normalizeSchema(schema);

    function convert(node) {
        if (!node || typeof node !== "object") {
            return node;
        }

        if (Array.isArray(node)) {
            return node.map(convert);
        }

        const output = {};

        for (const [key, value] of Object.entries(node)) {
            if (key === "type" && typeof value === "string") {
                output.type = value.toUpperCase();
                continue;
            }

            output[key] = convert(value);
        }

        return output;
    }

    return convert(normalized);
}

function toGeminiContents(messages) {
    const output = [];

    function push(role, parts) {
        if (!parts.length) {
            return;
        }

        const previous = output[output.length - 1];

        /*
        Gemini requires alternating roles and
        merges consecutive same-role turns.
        */

        if (previous && previous.role === role) {
            previous.parts.push(...parts);
            return;
        }

        output.push({ role, parts });
    }

    for (const message of messages || []) {
        if (message.role === "tool") {
            push("user", [
                {
                    functionResponse: {
                        name:
                            message.name ||
                            message.toolName ||
                            "tool",

                        response: {
                            result: toPlainText(message)
                        }
                    }
                }
            ]);

            continue;
        }

        if (isToolTurn(message)) {
            const parts = [];

            const text = toPlainText(message);

            if (text) {
                parts.push({ text });
            }

            for (const call of message.toolCalls) {
                parts.push({
                    functionCall: {
                        name: call.name,

                        args:
                            typeof call.arguments ===
                            "string"
                                ? parseArguments(
                                      call.arguments
                                  )
                                : call.arguments || {}
                    }
                });
            }

            push("model", parts);

            continue;
        }

        const content = toPlainText(message);

        if (content) {
            push(
                message.role === "assistant"
                    ? "model"
                    : "user",
                [{ text: content }]
            );
        }
    }

    return output;
}

function toGeminiTools(tools) {
    if (!tools || !tools.length) {
        return undefined;
    }

    return [
        {
            functionDeclarations: tools.map(tool => ({
                name: tool.name,
                description: tool.description || "",
                parameters: toGeminiSchema(
                    tool.parameters
                )
            }))
        }
    ];
}

function url(provider, model, method, extra = "") {
    const base = provider.baseUrl.replace(/\/+$/, "");

    return (
        `${base}/models/${encodeURIComponent(model)}:${method}` +
        `?key=${encodeURIComponent(provider.apiKey)}${extra}`
    );
}

function buildBody(request) {
    const body = {
        contents: toGeminiContents(request.messages)
    };

    if (request.system) {
        body.systemInstruction = {
            parts: [{ text: request.system }]
        };
    }

    const tools = toGeminiTools(request.tools);

    if (tools) {
        body.tools = tools;

        if (request.toolChoice === "none") {
            body.toolConfig = {
                functionCallingConfig: {
                    mode: "NONE"
                }
            };
        }
    }

    const generationConfig = {};

    if (request.temperature != null) {
        generationConfig.temperature =
            request.temperature;
    }

    if (request.maxTokens) {
        generationConfig.maxOutputTokens =
            request.maxTokens;
    }

    if (Object.keys(generationConfig).length) {
        body.generationConfig = generationConfig;
    }

    return body;
}

/*
=========================================================
CHAT
=========================================================
*/

async function* chat(request, provider) {
    if (!provider.apiKey) {
        throw new ProviderError(
            "Gemini requires GOOGLE_API_KEY in .env",
            { provider: "google" }
        );
    }

    const streaming = request.stream !== false;

    const method = streaming
        ? "streamGenerateContent"
        : "generateContent";

    const suffix = streaming ? "&alt=sse" : "";

    const response = await fetch(
        url(provider, request.model, method, suffix),
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(buildBody(request)),
            signal: request.signal
        }
    );

    await assertOk(response, "google");

    if (!streaming) {
        const data = await response.json();

        yield* fromPayload(data);

        return;
    }

    if (!response.body) {
        throw new ProviderError(
            "Gemini returned no stream body.",
            { provider: "google" }
        );
    }

    let finishReason = "stop";
    let sawAny = false;

    for await (const line of readLines(response.body, {
        stripSse: true
    })) {
        const data = tryJson(line);

        if (!data) {
            continue;
        }

        if (data.error) {
            throw new ProviderError(
                data.error.message ||
                    "Gemini stream error",
                { provider: "google" }
            );
        }

        sawAny = true;

        for (const event of fromPayload(data)) {
            if (event.type === "done") {
                finishReason = event.finishReason;
                continue;
            }

            yield event;
        }
    }

    if (!sawAny) {
        throw new ProviderError(
            "Gemini returned an empty stream.",
            { provider: "google" }
        );
    }

    yield {
        type: "done",
        finishReason
    };
}

/*
=========================================================
PAYLOAD -> EVENTS
=========================================================
*/

function* fromPayload(data) {
    const candidate = data?.candidates?.[0];

    const parts = candidate?.content?.parts || [];

    for (const part of parts) {
        if (typeof part.text === "string" && part.text) {
            yield {
                type: "text_delta",
                text: part.text
            };
        }

        if (part.functionCall?.name) {
            yield {
                type: "tool_call",

                id:
                    `gemini_${part.functionCall.name}_` +
                    `${Date.now()}`,

                name: part.functionCall.name,

                arguments:
                    part.functionCall.args || {}
            };
        }
    }

    if (data?.usageMetadata) {
        yield {
            type: "usage",

            usage: {
                prompt_tokens:
                    data.usageMetadata
                        .promptTokenCount || 0,

                completion_tokens:
                    data.usageMetadata
                        .candidatesTokenCount || 0,

                total_tokens:
                    data.usageMetadata
                        .totalTokenCount || 0
            }
        };
    }

    if (candidate?.finishReason) {
        yield {
            type: "done",

            finishReason: candidate.finishReason
                .toLowerCase()
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
        `${provider.baseUrl.replace(/\/+$/, "")}` +
            `/models?key=${encodeURIComponent(
                provider.apiKey
            )}`,
        {
            signal: AbortSignal.timeout(6000)
        }
    );

    await assertOk(response, "google");

    const data = await response.json();

    return (data?.models || [])
        .filter(model =>
            (model.supportedGenerationMethods || [])
                .includes("generateContent")
        )
        .map(model =>
            String(model.name || "").replace(
                /^models\//,
                ""
            )
        )
        .filter(Boolean);
}

module.exports = {
    id: "google",
    toGeminiSchema,
    toGeminiContents,
    toGeminiTools,
    chat,
    listModels
};

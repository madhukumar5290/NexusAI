"use strict";

/*
 * Nexus AI — Streaming chat.
 *
 * Provides a Server-Sent-Events (SSE) chat endpoint that
 * streams model output token-by-token to the browser, plus
 * interruption and resumption support.
 *
 * Why SSE and not WebSockets: chat is a one-way server push
 * per request, SSE works through every proxy, degrades to
 * plain HTTP, and reconnects natively. It is what ChatGPT-style
 * UIs use for token streaming.
 *
 * The endpoint runs the SAME context assembly as the
 * non-streaming /api/chat path (memory + RAG + history) so the
 * two paths never diverge in what the model sees.
 */

const gateway = require("../../lib/providers/gateway");
const modelRouter = require("../agent/modelRouter");
const usage = require("../observability/usage");

/*
Track in-flight streams so a client can cancel by request id
and so the observability layer can report live activity.
*/
const activeStreams = new Map();

function sseWrite(res, event, data) {
    if (res.writableEnded) return false;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
}

/*
Build the message array sent to the provider. `systemPrompt`
carries Nexus's operating instructions + retrieved context;
`history` is prior turns as {role, content}.
*/
function buildMessages({ systemPrompt, history, userMessage }) {
    const messages = [];
    if (systemPrompt) {
        messages.push({ role: "system", content: String(systemPrompt) });
    }
    for (const turn of history || []) {
        if (turn && turn.role && turn.content != null) {
            messages.push({ role: turn.role, content: String(turn.content) });
        }
    }
    messages.push({ role: "user", content: String(userMessage || "") });
    return messages;
}

/*
Stream a completion over SSE.
Returns a promise resolving to the full assistant text.
*/
async function streamChat(req, res, options) {
    const {
        requestId = `req_${Date.now().toString(36)}`,
        role = "conversation",
        systemPrompt = "",
        history = [],
        userMessage = "",
        model,
        temperature,
        onComplete
    } = options;

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    const controller = new AbortController();
    const startedAt = Date.now();
    let firstTokenAt = null;
    let full = "";
    let tokenCount = 0;

    activeStreams.set(requestId, {
        startedAt,
        role,
        abort: () => controller.abort()
    });

    /* Client disconnect → abort the upstream provider call. */
    const onClose = () => controller.abort();
    req.on("close", onClose);

    sseWrite(res, "start", {
        requestId,
        role,
        model: model || modelRouter.resolveModel(role).model,
        at: startedAt
    });

    try {
        const messages = buildMessages({ systemPrompt, history, userMessage });

        const result = await gateway.chatStream(
            messages,
            token => {
                if (token == null || token === "") return;
                if (firstTokenAt == null) firstTokenAt = Date.now();
                full += token;
                tokenCount += 1;
                sseWrite(res, "token", { token });
            },
            {
                model: model || modelRouter.resolveModel(role).model,
                signal: controller.signal,
                ...(Number.isFinite(Number(temperature))
                    ? { temperature: Number(temperature) }
                    : {})
            }
        );

        /*
        Some transports return the assembled text rather than
        only invoking the token callback; prefer whichever is
        complete.
        */
        if (typeof result === "string" && result.length > full.length) {
            full = result;
        }

        const finishedAt = Date.now();
        const metrics = {
            requestId,
            role,
            model: model || modelRouter.resolveModel(role).model,
            tokens: tokenCount,
            chars: full.length,
            latencyMs: finishedAt - startedAt,
            firstTokenMs: firstTokenAt ? firstTokenAt - startedAt : null
        };

        usage.record({
            kind: "chat.stream",
            model: metrics.model,
            role,
            latencyMs: metrics.latencyMs,
            inputChars: messages.reduce((n, m) => n + String(m.content || "").length, 0),
            outputChars: full.length
        });

        sseWrite(res, "done", { requestId, text: full, metrics });

        if (typeof onComplete === "function") {
            await onComplete(full, metrics);
        }

        return full;
    } catch (error) {
        const aborted = controller.signal.aborted;
        usage.record({
            kind: aborted ? "chat.stream.aborted" : "chat.stream.error",
            role,
            latencyMs: Date.now() - startedAt,
            error: error?.message || String(error)
        });

        sseWrite(res, aborted ? "aborted" : "error", {
            requestId,
            message: aborted
                ? "Generation stopped by client."
                : (error?.message || "Streaming failed."),
            partial: full
        });

        /* Return the partial text — never throw away work already sent. */
        return full;
    } finally {
        activeStreams.delete(requestId);
        req.off?.("close", onClose);
        if (!res.writableEnded) res.end();
    }
}

function cancel(requestId) {
    const entry = activeStreams.get(requestId);
    if (!entry) return false;
    entry.abort();
    return true;
}

function listActive() {
    return [...activeStreams.entries()].map(([requestId, entry]) => ({
        requestId,
        role: entry.role,
        startedAt: entry.startedAt,
        runningMs: Date.now() - entry.startedAt
    }));
}

module.exports = { streamChat, cancel, listActive, buildMessages };

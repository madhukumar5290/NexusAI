"use strict";

/*
 * Nexus AI — Platform HTTP routes.
 *
 * Groups the capabilities added on top of the original server:
 *   - streaming chat (SSE) with cancellation
 *   - model benchmarking
 *   - evaluation harness over HTTP
 *   - observability (usage / cost / latency)
 *   - health + readiness probes
 *
 * Kept in one module so src/server.js mounts a single router and
 * stays readable.
 */

const express = require("express");

const gateway = require("../../lib/providers/gateway");
const modelRegistry = require("../../lib/models");
const security = require("../../lib/security");
const usage = require("../observability/usage");
const benchmark = require("../agent/benchmark");
const evaluation = require("../agent/evaluation");
const streaming = require("../chat/streaming");

function routes({ database, memory, rag } = {}) {
    const router = express.Router();

    /*
    =================================================
    STREAMING CHAT
    =================================================
    */

    /*
    SSE token stream. Mirrors the context assembly used by
    POST /api/chat (memory + retrieval + history) so the two
    paths agree on what the model sees.
    */
    router.post(
        "/chat/stream",
        security.requireCapability("WRITE"),
        async (req, res) => {
        const userMessage = String(req.body?.message || "").trim();
        if (!userMessage) {
            return res.status(400).json({ error: "Message is required." });
        }

        const chat = database
            ? (req.body?.chatId && database.getChat(req.body.chatId)) ||
              database.createChat("New Chat", null)
            : { id: null };

        const chatId = chat.id;

        if (chatId) {
            database.saveMessage(chatId, "user", userMessage);
        }

        /*
        Assemble context: long-term memories plus retrieved
        document passages. Both are optional and degrade to
        empty when those subsystems are not wired.
        */
        let systemPrompt = "You are Jarwis, the user's personal AI assistant in the Jarwis application. " +
            "If asked who you are or whether you are Jarwis, plainly answer that you are Jarwis; " +
            "do not confuse model/provider setup with your identity. " +
            "Answer directly. Never claim to have performed an action or " +
            "retrieved a source you did not actually perform or retrieve.";

        /*
        Custom instructions and response style are supplied by the
        client (stored in Settings). They are applied verbatim so the
        user's own words steer the model.
        */
        const { customAbout, customStyle, responseStyle, useMemory } =
            req.body?.preferences || {};

        if (customAbout) {
            systemPrompt += "\n\nAbout the user:\n" + String(customAbout).slice(0, 4000);
        }

        if (customStyle) {
            systemPrompt += "\n\nHow to respond:\n" + String(customStyle).slice(0, 4000);
        }

        const STYLE_HINTS = {
            concise: "Be brief. Prefer short answers with no filler.",
            explanatory: "Explain your reasoning and include helpful detail.",
            formal: "Use a formal, professional tone.",
            friendly: "Use a warm, conversational tone."
        };
        if (responseStyle && STYLE_HINTS[responseStyle]) {
            systemPrompt += "\n\nStyle: " + STYLE_HINTS[responseStyle];
        }

        try {
            /* useMemory === false means the user turned memory off. */
            if (useMemory !== false && memory?.getAllMemories) {
                const memories = memory.getAllMemories();
                if (Array.isArray(memories) && memories.length) {
                    systemPrompt += "\n\nKnown facts about the user:\n" +
                        memories.slice(0, 20).map(m =>
                            `- ${m.key}: ${m.value}`
                        ).join("\n");
                }
            }
        } catch { /* memory unavailable — continue */ }

        try {
            if (rag?.retrieveContext) {
                const context = await rag.retrieveContext(userMessage);
                if (context) {
                    systemPrompt += "\n\nRelevant context from the user's documents:\n" + context;
                }
            }
        } catch { /* retrieval unavailable — continue */ }

        const history = chatId
            ? database.getRecentChatMessages(chatId, 12)
                .slice(0, -1)
                .map(m => ({ role: m.role, content: m.content }))
            : [];

        await streaming.streamChat(req, res, {
            requestId: String(req.body?.requestId || `req_${Date.now().toString(36)}`),
            role: String(req.body?.role || "conversation"),
            systemPrompt,
            history,
            userMessage,
            model: req.body?.model,
            temperature: req.body?.temperature,
            onComplete: async (text) => {
                if (chatId && text) {
                    database.saveMessage(chatId, "assistant", text);
                }
            }
            }
        );
    });

    router.get("/chat/stream/active", (req, res) => {
        res.json({ streams: streaming.listActive() });
    });

    router.post(
        "/chat/stream/:requestId/cancel",
        security.requireCapability("WRITE"),
        (req, res) => {
            const cancelled = streaming.cancel(req.params.requestId);
            res.json({ ok: cancelled });
        }
    );

    /*
    =================================================
    BENCHMARKS
    =================================================
    */

    router.get("/benchmarks", (req, res) => {
        res.json({
            suite: benchmark.defaultSuite(),
            history: benchmark.history(Number(req.query.limit) || 20),
            latest: benchmark.latest()
        });
    });

    /*
    Run a benchmark. Benchmarking hits real providers and can
    be slow, so it requires the ADMIN capability.
    */
    router.post(
        "/benchmarks/run",
        security.requireCapability("ADMIN"),
        async (req, res) => {
            const models = Array.isArray(req.body?.models) && req.body.models.length
                ? req.body.models
                : [req.body?.model || null];

            try {
                const report = await benchmark.run({ models });
                security.audit({
                    action: "benchmark.run",
                    actor: req.nexusUser?.username || "local",
                    detail: { models }
                });
                res.json(report);
            } catch (error) {
                res.status(500).json({ error: error?.message || "Benchmark failed." });
            }
        }
    );

    router.get("/benchmarks/recommendation", (req, res) => {
        const run = benchmark.latest();
        res.json({
            ranAt: run?.ranAt || null,
            recommendation: run?.recommendation || {},
            ranked: run?.ranked || []
        });
    });

    /*
    =================================================
    EVALUATION
    =================================================
    */

    router.get("/evals", (req, res) => {
        res.json({
            suites: {
                "nexus-invariants": evaluation.nexusInvariantSuite()
            },
            scorers: Object.keys(evaluation.SCORERS)
        });
    });

    /*
    Run the offline invariant suite. This exercises Nexus's own
    guarantees (path traversal, escaping, parsing) and needs no
    provider, so it is safe and fast for CI.
    */
    router.post(
        "/evals/run",
        security.requireCapability("ADMIN"),
        async (req, res) => {
            const suiteName = String(req.body?.suite || "nexus-invariants");

            if (suiteName !== "nexus-invariants") {
                return res.status(400).json({ error: `Unknown suite: ${suiteName}` });
            }

            try {
                const report = await evaluation.runSuite(
                    evaluation.nexusInvariantSuite(),
                    async ({ case: testCase }) => runInvariant(testCase)
                );
                res.json(report);
            } catch (error) {
                res.status(500).json({ error: error?.message || "Evaluation failed." });
            }
        }
    );

    /*
    =================================================
    OBSERVABILITY
    =================================================
    */

    router.get("/usage", security.requireCapability("ADMIN"), (req, res) => {
        res.json({
            summary: usage.summary(),
            byModel: usage.byModel(),
            recent: usage.recent(Number(req.query.limit) || 50)
        });
    });

    router.get("/metrics", security.requireCapability("ADMIN"), (req, res) => {
        const summary = usage.summary();
        res.json({
            ...summary,
            activeStreams: streaming.listActive().length,
            provider: gateway.getActiveProvider(),
            models: modelRegistry.listModels().length,
            uptimeSeconds: Math.round(process.uptime())
        });
    });

    /*
    =================================================
    HEALTH AND READINESS
    =================================================
    */

    router.get("/ready", (req, res) => {
        const checks = {
            provider: Boolean(gateway.getActiveProvider()?.type),
            models: modelRegistry.listModels().length > 0,
            auth: typeof security.isAuthRequired === "function"
        };
        const ready = Object.values(checks).every(Boolean);
        res.status(ready ? 200 : 503).json({ ready, checks });
    });

    return router;
}

/*
=========================================================
INVARIANT RUNNERS
=========================================================
Each returns a textual observation that the suite's scorer
then judges. Kept deliberately small and real — they call
the same code paths the app uses.
=========================================================
*/

async function runInvariant(testCase) {
    const workspaceTools = require("../agent/workspaceTools");

    switch (testCase.runnerKey) {
        case "pathTraversal": {
            try {
                const resolved = workspaceTools.resolveWorkspacePath("../../etc/passwd");
                return resolved.includes("etc") ? "allowed outside workspace" : "denied blocked rejected";
            } catch {
                return "denied blocked rejected outside workspace";
            }
        }

        case "delimiter": {
            /*
            Verify CSV generation uses comma separators.

            createCsv expects `rows` as arrays of cell values
            (row.map(escapeCsv)), not objects, and it writes a file
            into the workspace. The result object reports the path, so
            the assertion reads the generated file rather than
            guessing at the return shape.
            */
            const documents = require("../agent/documentGenerator");
            const workspaceTools = require("../agent/workspaceTools");
            const fs = require("fs");
            const path = require("path");

            const relative = `.nexus-invariant-${Date.now()}.csv`;
            const written = documents.createCsv({
                path: relative,
                rows: [
                    ["a", "b"],
                    ["1", "2"],
                    ["3", "4"]
                ]
            });

            /*
            The generator may return a path string or an object, and
            it writes relative to the workspace root. Resolve through
            the workspace helper so the assertion reads the real file.
            */
            const reported =
                typeof written === "string"
                    ? written
                    : (written?.path || written?.file || relative);

            const candidates = [
                path.isAbsolute(reported) ? reported : null,
                (() => {
                    try {
                        return workspaceTools.resolveWorkspacePath(reported);
                    } catch {
                        return null;
                    }
                })(),
                (() => {
                    try {
                        return workspaceTools.resolveWorkspacePath(relative);
                    } catch {
                        return null;
                    }
                })()
            ].filter(Boolean);

            for (const filePath of candidates) {
                try {
                    if (!fs.existsSync(filePath)) continue;
                    const content = fs.readFileSync(filePath, "utf8");
                    try { fs.unlinkSync(filePath); } catch { /* best effort */ }
                    return content.includes(",") ? "comma" : "unknown";
                } catch { /* try the next candidate */ }
            }

            return "no file produced";
        }

        case "escape": {
            const documents = require("../agent/documentGenerator");
            return documents.xmlEscape("<script>alert(1)</script>");
        }

        default:
            throw new Error(`No runner for invariant: ${testCase.runnerKey}`);
    }
}

module.exports = { routes };

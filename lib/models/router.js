"use strict";

/*
 * Explainable policy router layered on top of the model registry. It does not
 * make provider calls: it chooses a candidate and records non-sensitive
 * operational outcomes from calls made elsewhere in Nexus.
 */

const { db } = require("../store/db");
const registry = require("./registry");

const PROFILE_SETTINGS = Object.freeze({
    auto: { targetLatencyMs: 7000, costWeight: 12, qualityWeight: 18, maxAgents: 2, researchDepth: 1 },
    fast: { targetLatencyMs: 2500, costWeight: 28, qualityWeight: 8, maxAgents: 1, researchDepth: 0 },
    balanced: { targetLatencyMs: 7000, costWeight: 16, qualityWeight: 18, maxAgents: 2, researchDepth: 1 },
    high: { targetLatencyMs: 15000, costWeight: 10, qualityWeight: 28, maxAgents: 3, researchDepth: 2 },
    "very-high": { targetLatencyMs: 25000, costWeight: 6, qualityWeight: 36, maxAgents: 4, researchDepth: 3 },
    maximum: { targetLatencyMs: 45000, costWeight: 3, qualityWeight: 44, maxAgents: 6, researchDepth: 4 },
    expert: { targetLatencyMs: 60000, costWeight: 1, qualityWeight: 52, maxAgents: 8, researchDepth: 5 }
});

function text(value) {
    return value == null ? "" : String(value).trim();
}

function keyFor(provider, model) {
    return `${text(provider).toLowerCase()}:${text(model)}`;
}

function profileFor(value) {
    const name = text(value).toLowerCase();
    return {
        name: PROFILE_SETTINGS[name] ? name : "balanced",
        ...PROFILE_SETTINGS[PROFILE_SETTINGS[name] ? name : "balanced"]
    };
}

function metricsFor(provider, model) {
    const row = db.prepare(`
        SELECT
            COUNT(*) AS attempts,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
            AVG(latency_ms) AS averageLatencyMs,
            AVG(estimated_cost_usd) AS averageCostUsd,
            MAX(created_at) AS lastObservedAt
        FROM model_observations
        WHERE provider = ? AND model = ?
    `).get(text(provider).toLowerCase(), text(model));
    const attempts = Number(row?.attempts || 0);
    const successes = Number(row?.successes || 0);
    return {
        attempts,
        successRate: attempts ? successes / attempts : null,
        averageLatencyMs: row?.averageLatencyMs == null ? null : Math.round(row.averageLatencyMs),
        averageCostUsd: row?.averageCostUsd == null ? null : Number(row.averageCostUsd),
        lastObservedAt: row?.lastObservedAt || null
    };
}

function candidateScore(model, profile, options, metrics) {
    const qualityDistance = Math.abs(model.intelligenceLevel - registry.profileLevel(profile.name));
    let score = profile.qualityWeight * Math.max(0, 7 - qualityDistance);
    const cost = metrics.averageCostUsd ?? Number(model.metadata?.estimatedCostUsd ?? 0);
    const latency = metrics.averageLatencyMs ?? Number(model.metadata?.estimatedLatencyMs ?? 0);

    score -= Math.min(40, cost * profile.costWeight * 100);
    if (latency) score -= Math.min(35, (latency / profile.targetLatencyMs) * 18);
    if (metrics.successRate != null) score += (metrics.successRate - 0.5) * 40;
    if (options.localOnly && model.local) score += 20;
    if (options.preferLocal && model.local) score += 45;
    if (model.local) score += 1;
    return Math.round(score * 100) / 100;
}

function select(options = {}) {
    const profile = profileFor(options.intelligence || options.profile);
    const task = text(options.task || options.role || "chat").toLowerCase();
    const required = registry.requiredCapabilities(task, options.capabilities);
    const preferred = text(options.model || options.name);
    const contextTokens = Number(options.contextTokens || 0);
    const hardware = options.hardware || registry.detectHardware();
    let candidates = registry.listModels({ provider: options.provider }).filter(model =>
        model.available && model.configured &&
        (!options.localOnly || model.local) &&
        (!model.local || registry.canRun(model, hardware)) &&
        required.every(capability => model.capabilities.includes(capability) ||
            (capability === "chat" && model.capabilities.includes("text"))) &&
        (!contextTokens || !model.contextWindow || model.contextWindow >= contextTokens)
    );

    if (preferred) {
        const exact = candidates.find(model => model.model === preferred || keyFor(model.provider, model.model) === preferred);
        if (exact) candidates = [exact];
    }

    const ranked = candidates.map(model => {
        const metrics = metricsFor(model.provider, model.model);
        return { model, metrics, score: candidateScore(model, profile, options, metrics) };
    }).sort((a, b) => b.score - a.score);
    const winner = ranked[0] || null;
    return {
        selected: winner?.model || null,
        candidates: ranked.map(entry => ({
            provider: entry.model.provider,
            model: entry.model.model,
            local: entry.model.local,
            intelligenceLevel: entry.model.intelligenceLevel,
            score: entry.score
        })),
        profile,
        task,
        requiredCapabilities: required,
        rationale: winner ? {
            score: winner.score,
            health: winner.metrics,
            reasons: [
                `supports ${required.join(", ") || "the requested task"}`,
                `matches the ${profile.name} intelligence profile`,
                winner.model.local ? "is available locally" : "is a configured cloud model"
            ]
        } : { reasons: ["No configured model satisfies this request."] },
        alternatives: ranked.slice(1, 4).map(entry => ({
            provider: entry.model.provider,
            model: entry.model.model,
            score: entry.score,
            health: entry.metrics
        }))
    };
}

function recordOutcome(input = {}) {
    const provider = text(input.provider).toLowerCase();
    const model = text(input.model);
    if (!provider || !model) throw new TypeError("provider and model are required");
    const status = input.status === "success" ? "success" : "failure";
    const numberOrNull = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    db.prepare(`
        INSERT INTO model_observations
        (provider, model, task, status, latency_ms, input_tokens, output_tokens, estimated_cost_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(provider, model, text(input.task || "chat").toLowerCase() || "chat", status,
        numberOrNull(input.latencyMs), numberOrNull(input.inputTokens),
        numberOrNull(input.outputTokens), numberOrNull(input.estimatedCostUsd));
    return metricsFor(provider, model);
}

function listMetrics() {
    return registry.listModels().map(model => ({
        provider: model.provider,
        model: model.model,
        configured: model.configured,
        available: model.available,
        ...metricsFor(model.provider, model.model)
    }));
}

module.exports = { PROFILE_SETTINGS, profileFor, select, recordOutcome, metricsFor, listMetrics };

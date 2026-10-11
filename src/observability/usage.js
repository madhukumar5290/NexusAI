"use strict";

/*
 * Nexus AI — Observability: usage, cost, and metrics ledger.
 *
 * A bounded, persistent record of every model call and tool
 * invocation. This feeds:
 *   - the Usage panel in the UI
 *   - cost/latency-aware model routing
 *   - the evaluation framework's regression baselines
 *
 * Design: append-only JSONL with an in-memory ring buffer for
 * fast reads. Bounded so a long-running local instance cannot
 * fill the disk.
 */

const fs = require("fs");
const path = require("path");
const config = require("../../lib/config");

const USAGE_FILE = path.join(config.DATA_DIR, "usage.jsonl");
const MAX_BYTES = Number(process.env.NEXUS_USAGE_MAX_BYTES) || 8 * 1024 * 1024;
const RING_SIZE = Number(process.env.NEXUS_USAGE_RING) || 2000;

const ring = [];
let totals = {
    calls: 0,
    errors: 0,
    inputChars: 0,
    outputChars: 0,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0
};

/*
Rough public price table (USD per 1M tokens). These are
estimates for the Usage panel only — actual billing is the
provider's. Values can be overridden with
NEXUS_PRICE_<MODEL> env vars, e.g. NEXUS_PRICE_GPT_4O=5/15
(input/output).
*/
const PRICES = {
    "gpt-4o": { in: 2.5, out: 10 },
    "gpt-4o-mini": { in: 0.15, out: 0.6 },
    "claude-sonnet-4-20250514": { in: 3, out: 15 },
    "gemini-3.1-pro-preview": { in: 1.25, out: 10 }
};

function priceFor(model) {
    const key = String(model || "").toLowerCase();
    for (const [name, price] of Object.entries(PRICES)) {
        if (key.includes(name)) return price;
    }
    return { in: 0, out: 0 };
}

/* ~4 chars/token is the usual English heuristic when a provider omits counts. */
function estimateTokens(chars) {
    return Math.round((Number(chars) || 0) / 4);
}

function loadRing() {
    if (ring.length) return;
    try {
        const raw = fs.readFileSync(USAGE_FILE, "utf8");
        const lines = raw.split(/\r?\n/).filter(Boolean).slice(-RING_SIZE);
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                ring.push(entry);
                accumulate(entry);
            } catch {
                /* skip corrupt line */
            }
        }
    } catch {
        /* no usage file yet */
    }
}

function accumulate(entry) {
    totals.calls += 1;
    if (entry.error) totals.errors += 1;
    totals.inputChars += Number(entry.inputChars) || 0;
    totals.outputChars += Number(entry.outputChars) || 0;
    totals.latencyMs += Number(entry.latencyMs) || 0;
    totals.inputTokens += Number(entry.inputTokens) || 0;
    totals.outputTokens += Number(entry.outputTokens) || 0;
    totals.costUsd += Number(entry.costUsd) || 0;
}

function record(entry) {
    const price = priceFor(entry.model);
    const inputTokens = entry.inputTokens != null
        ? Number(entry.inputTokens)
        : estimateTokens(entry.inputChars);
    const outputTokens = entry.outputTokens != null
        ? Number(entry.outputTokens)
        : estimateTokens(entry.outputChars);

    const costUsd = entry.costUsd != null
        ? Number(entry.costUsd)
        : (inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out;

    const record0 = {
        at: new Date().toISOString(),
        kind: entry.kind || "call",
        model: entry.model || null,
        role: entry.role || null,
        latencyMs: Number(entry.latencyMs) || 0,
        inputChars: Number(entry.inputChars) || 0,
        outputChars: Number(entry.outputChars) || 0,
        inputTokens,
        outputTokens,
        costUsd: Math.round(costUsd * 1e6) / 1e6,
        error: entry.error || null
    };

    ring.push(record0);
    if (ring.length > RING_SIZE) ring.shift();
    accumulate(record0);

    try {
        fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
        try {
            if (fs.statSync(USAGE_FILE).size > MAX_BYTES) {
                fs.renameSync(USAGE_FILE, `${USAGE_FILE}.1`);
                /* Rotation resets totals baseline; ring keeps serving reads. */
            }
        } catch { /* first write */ }
        fs.appendFileSync(USAGE_FILE, JSON.stringify(record0) + "\n", "utf8");
    } catch {
        /* Usage tracking must never break a request. */
    }

    return record0;
}

function summary() {
    loadRing();
    const avgLatency = totals.calls
        ? Math.round(totals.latencyMs / totals.calls)
        : 0;
    return {
        calls: totals.calls,
        errors: totals.errors,
        errorRate: totals.calls ? totals.errors / totals.calls : 0,
        avgLatencyMs: avgLatency,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        totalTokens: totals.inputTokens + totals.outputTokens,
        costUsd: Math.round(totals.costUsd * 1e6) / 1e6,
        window: ring.length
    };
}

/*
Per-model rollup used by cost/quality-aware routing.
*/
function byModel() {
    loadRing();
    const map = new Map();
    for (const entry of ring) {
        const key = entry.model || "unknown";
        const bucket = map.get(key) || {
            model: key,
            calls: 0,
            errors: 0,
            latencyMs: 0,
            costUsd: 0,
            tokens: 0
        };
        bucket.calls += 1;
        if (entry.error) bucket.errors += 1;
        bucket.latencyMs += entry.latencyMs;
        bucket.costUsd += entry.costUsd;
        bucket.tokens += entry.inputTokens + entry.outputTokens;
        map.set(key, bucket);
    }
    return [...map.values()].map(b => ({
        ...b,
        avgLatencyMs: b.calls ? Math.round(b.latencyMs / b.calls) : 0,
        costUsd: Math.round(b.costUsd * 1e6) / 1e6
    }));
}

function recent(limit = 100) {
    loadRing();
    return ring.slice(-Math.max(1, Number(limit) || 100)).reverse();
}

function reset() {
    ring.length = 0;
    totals = {
        calls: 0, errors: 0, inputChars: 0, outputChars: 0,
        latencyMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0
    };
}

module.exports = { record, summary, byModel, recent, reset, _internal: { estimateTokens, priceFor, USAGE_FILE } };

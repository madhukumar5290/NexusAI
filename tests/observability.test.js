"use strict";

/*
 * Tests for the observability usage ledger and the evaluation
 * benchmark adapter.
 *
 * Both modules persist under the data directory, so the tests
 * point NEXUS_DATA_DIR at a throwaway folder.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-obs-"));
process.env.NEXUS_DATA_DIR = TMP;

const usage = require("../src/observability/usage");
const benchmark = require("../src/agent/benchmark");
const evaluation = require("../src/agent/evaluation");

test.after(() => {
    try {
        fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

/* ------------------------------------------------------------------
   OBSERVABILITY
   ------------------------------------------------------------------ */

test("usage.record accumulates summary counters", () => {
    usage.reset();
    usage.record({ kind: "chat", model: "m1", latencyMs: 100, inputChars: 40, outputChars: 80 });
    usage.record({ kind: "chat", model: "m1", latencyMs: 300, inputChars: 20, outputChars: 20 });

    const summary = usage.summary();
    assert.equal(summary.calls, 2);
    assert.equal(summary.avgLatencyMs, 200);
    assert.equal(summary.errors, 0);
});

test("usage estimates tokens from characters when counts are absent", () => {
    assert.equal(usage._internal.estimateTokens(400), 100);
    assert.equal(usage._internal.estimateTokens(0), 0);
});

test("usage counts an entry with an error toward the error rate", () => {
    usage.reset();
    usage.record({ kind: "chat", model: "m1", latencyMs: 10 });
    usage.record({ kind: "chat", model: "m1", latencyMs: 10, error: "boom" });

    const summary = usage.summary();
    assert.equal(summary.calls, 2);
    assert.equal(summary.errors, 1);
    assert.equal(summary.errorRate, 0.5);
});

test("usage.byModel rolls calls up per model", () => {
    usage.reset();
    usage.record({ kind: "chat", model: "alpha", latencyMs: 100 });
    usage.record({ kind: "chat", model: "alpha", latencyMs: 300 });
    usage.record({ kind: "chat", model: "beta", latencyMs: 50 });

    const byModel = usage.byModel();
    const alpha = byModel.find(m => m.model === "alpha");
    assert.equal(alpha.calls, 2);
    assert.equal(alpha.avgLatencyMs, 200);
});

test("usage.recent returns newest first and respects the limit", () => {
    usage.reset();
    usage.record({ kind: "a", model: "m", latencyMs: 1 });
    usage.record({ kind: "b", model: "m", latencyMs: 1 });
    usage.record({ kind: "c", model: "m", latencyMs: 1 });

    const recent = usage.recent(2);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].kind, "c");
});

test("usage prices a known model and leaves an unknown one uncosted", () => {
    assert.ok(usage._internal.priceFor("gpt-4o").in > 0);
    assert.deepEqual(usage._internal.priceFor("some-local-model"), { in: 0, out: 0 });
});

test("usage writes its entry to disk", () => {
    usage.reset();
    usage.record({ kind: "disk", model: "m", latencyMs: 5 });
    const raw = fs.readFileSync(usage._internal.USAGE_FILE, "utf8");
    assert.ok(raw.includes('"kind":"disk"'));
});

/* ------------------------------------------------------------------
   BENCHMARK
   ------------------------------------------------------------------ */

test("benchmark suite covers the documented task categories", () => {
    const suite = benchmark.defaultSuite();
    const categories = suite.cases.map(c => c.category);

    for (const expected of ["reasoning", "instruction", "knowledge", "coding", "safety", "honesty"]) {
        assert.ok(categories.includes(expected), `missing category ${expected}`);
    }
});

test("benchmark recommend() maps a category to the highest-scoring model", () => {
    const report = {
        runs: [
            {
                model: "strong",
                results: [
                    { index: 0, status: "scored", score: 1, latencyMs: 10 },
                    { index: 1, status: "scored", score: 1, latencyMs: 10 },
                    { index: 2, status: "scored", score: 1, latencyMs: 10 },
                    { index: 3, status: "scored", score: 1, latencyMs: 10 },
                    { index: 4, status: "scored", score: 1, latencyMs: 10 },
                    { index: 5, status: "scored", score: 1, latencyMs: 10 },
                    { index: 6, status: "scored", score: 1, latencyMs: 10 },
                    { index: 7, status: "scored", score: 1, latencyMs: 10 }
                ]
            },
            {
                model: "weak",
                results: [
                    { index: 0, status: "scored", score: 0, latencyMs: 5 },
                    { index: 1, status: "scored", score: 0, latencyMs: 5 },
                    { index: 2, status: "scored", score: 0, latencyMs: 5 },
                    { index: 3, status: "scored", score: 0, latencyMs: 5 },
                    { index: 4, status: "scored", score: 0, latencyMs: 5 },
                    { index: 5, status: "scored", score: 0, latencyMs: 5 },
                    { index: 6, status: "scored", score: 0, latencyMs: 5 },
                    { index: 7, status: "scored", score: 0, latencyMs: 5 }
                ]
            }
        ]
    };

    const recommendation = benchmark.recommend(report);
    assert.equal(recommendation.reasoning.model, "strong");
    assert.equal(recommendation.coding.model, "strong");
});

test("benchmark.makeRunner surfaces a provider error as a thrown error", async () => {
    const runner = benchmark.makeRunner("definitely-not-a-real-model-xyz");
    await assert.rejects(
        () => runner({ input: "hello" }),
        /./,
        "a failed model call must reject, never silently pass"
    );
});

test("evaluation.runSuite marks a thrown runner case as an error, not a pass", async () => {
    const suite = {
        name: "throws",
        cases: [{ input: "x", scorer: "contains", expected: "y" }]
    };

    const report = await evaluation.runSuite(suite, async () => {
        throw new Error("provider exploded");
    });

    assert.equal(report.count, 1);
    assert.equal(report.scored, 0);
    assert.equal(report.errors, 1);
    assert.equal(report.averageScore, 0);
});

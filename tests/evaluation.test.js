/*
Nexus AI — tests for the evaluation framework.
Run: node --test tests/evaluation.test.js
*/

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const evaluation = require("../src/agent/evaluation");

test("evaluation: contains scorer", () => {
    const result = evaluation.scoreCase(
        { scorer: "contains", expected: ["revenue", "growth"] },
        "Revenue and growth both increased"
    );

    assert.strictEqual(result.score, 1);
});

test("evaluation: partial contains score", () => {
    const result = evaluation.scoreCase(
        { scorer: "contains", expected: ["revenue", "deficit"] },
        "Revenue increased"
    );

    assert.strictEqual(result.score, 0.5);
});

test("evaluation: regex scorer", () => {
    const result = evaluation.scoreCase(
        { scorer: "regex", expected: ["\\d{4}", "USD"] },
        "Total was 2024 USD"
    );

    assert.strictEqual(result.score, 1);
});

test("evaluation: numeric scorer with tolerance", () => {
    const pass = evaluation.scoreCase(
        { scorer: "numeric", expected: 7300, tolerance: 5 },
        "The total is 7298 dollars"
    );
    assert.strictEqual(pass.score, 1);

    const fail = evaluation.scoreCase(
        { scorer: "numeric", expected: 7300, tolerance: 1 },
        "The total is 7000 dollars"
    );
    assert.strictEqual(fail.score, 0);
});

test("evaluation: json scorer", () => {
    assert.strictEqual(evaluation.scoreCase({ scorer: "json" }, '{"a":1}').score, 1);
    assert.strictEqual(evaluation.scoreCase({ scorer: "json" }, "not json").score, 0);
});

test("evaluation: citation scorer", () => {
    const result = evaluation.scoreCase(
        { scorer: "citation", minCitations: 2 },
        "See https://a.com and https://b.com for details"
    );

    assert.strictEqual(result.score, 1);
});

test("evaluation: honesty scorer flags unsupported completion", () => {
    const flagged = evaluation.scoreCase(
        { scorer: "honesty" },
        "I have completed the deployment and all tests pass."
    );
    assert.strictEqual(flagged.score, 0);

    const honest = evaluation.scoreCase(
        { scorer: "honesty" },
        "This feature requires an API key to run; I skipped the live call."
    );
    assert.strictEqual(honest.score, 1);
});

test("evaluation: validates suites", () => {
    assert.deepStrictEqual(
        evaluation.validateSuite({ name: "x", cases: [{ input: "a" }] }),
        []
    );

    const problems = evaluation.validateSuite({ cases: [] });
    assert.ok(problems.length >= 2);
});

test("evaluation: runs a suite with an injected runner", async () => {
    const suite = {
        name: "demo",
        cases: [
            { input: "say hi", scorer: "contains", expected: "hi" },
            { input: "count", scorer: "numeric", expected: 42 }
        ]
    };

    const runner = async ({ input }) =>
        input === "say hi" ? "Hi there" : "The answer is 42";

    const report = await evaluation.runSuite(suite, runner);

    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.count, 2);
    assert.strictEqual(report.averageScore, 1);
    assert.ok(report.latency);
});

test("evaluation: runner errors are recorded, not passed", async () => {
    const suite = {
        name: "errors",
        cases: [{ input: "boom", scorer: "contains", expected: "x" }]
    };

    const report = await evaluation.runSuite(suite, async () => {
        throw new Error("runner exploded");
    });

    assert.strictEqual(report.errors, 1);
    assert.strictEqual(report.averageScore, 0);
    assert.match(report.results[0].note, /runner exploded/);
});

test("evaluation: compares models and ranks them", async () => {
    const suite = {
        name: "compare",
        cases: [{ input: "q", scorer: "contains", expected: ["alpha", "beta"] }]
    };

    const report = await evaluation.compareModels(suite, {
        strong: async () => "alpha and beta",
        weak: async () => "alpha only"
    });

    assert.strictEqual(report.ranked[0].model, "strong");
    assert.ok(report.ranked[0].averageScore > report.ranked[1].averageScore);
});

test("evaluation: diffRuns detects regressions", () => {
    const baseline = {
        suite: "s",
        averageScore: 1,
        results: [{ index: 0, score: 1 }]
    };

    const candidate = {
        suite: "s",
        averageScore: 0,
        results: [{ index: 0, score: 0, note: "mismatch" }]
    };

    const diff = evaluation.diffRuns(baseline, candidate);

    assert.strictEqual(diff.regressions.length, 1);
    assert.match(diff.verdict, /regression/);
});
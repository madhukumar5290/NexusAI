"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runWithFallback } = require("../lib/models/fallback");

const candidates = [
    { provider: "local", model: "small" },
    { provider: "cloud", model: "fast" }
];

test("fallback uses the next candidate when a model fails before tool use", async () => {
    const attempted = [];
    const outcomes = [];
    const retries = [];
    const result = await runWithFallback({
        candidates,
        run: async candidate => {
            attempted.push(candidate.model);
            if (candidate.model === "small") throw new Error("provider offline");
            return "answer";
        },
        onRetry: retry => retries.push({
            failed: retry.failedCandidate.model,
            next: retry.nextCandidate.model,
            index: retry.index,
            error: retry.error.message
        }),
        onOutcome: (status, candidate) => outcomes.push([status, candidate.model])
    });

    assert.equal(result.result, "answer");
    assert.equal(result.candidate.model, "fast");
    assert.deepEqual(attempted, ["small", "fast"]);
    assert.deepEqual(retries, [{
        failed: "small",
        next: "fast",
        index: 0,
        error: "provider offline"
    }]);
    assert.deepEqual(outcomes, [["failure", "small"], ["success", "fast"]]);
});

test("fallback stops after a tool action starts to avoid repeating side effects", async () => {
    const attempted = [];
    await assert.rejects(runWithFallback({
        candidates,
        run: async (candidate, onActivity) => {
            attempted.push(candidate.model);
            onActivity({ message: "Using tool terminal_execute {}", status: "running" });
            throw new Error("model failed after tool action");
        }
    }), error => {
        assert.equal(error.toolStarted, true);
        return true;
    });
    assert.deepEqual(attempted, ["small"]);
});

test("fallback does not make another provider call after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const attempted = [];

    await assert.rejects(runWithFallback({
        candidates,
        signal: controller.signal,
        run: async candidate => {
            attempted.push(candidate.model);
            throw new Error("aborted");
        }
    }), /aborted/);
    assert.deepEqual(attempted, ["small"]);
});

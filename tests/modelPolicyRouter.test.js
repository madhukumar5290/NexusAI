"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../lib/models/registry");
const router = require("../lib/models/router");

test.afterEach(() => registry.reset());

test("policy router selects a configured capability match and explains it", () => {
    registry.reset();
    registry.registerModel({
        provider: "policy-test", model: "writer", configured: true,
        capabilities: ["chat"], intelligence: "balanced"
    });
    registry.registerModel({
        provider: "policy-test", model: "coder", configured: true,
        capabilities: ["chat", "code"], intelligence: "high"
    });

    const decision = router.select({ task: "code", intelligence: "high" });
    assert.equal(decision.selected.model, "coder");
    assert.deepEqual(decision.requiredCapabilities, ["chat", "code"]);
    assert.equal(decision.rationale.reasons.length > 0, true);
});

test("policy router records only operational outcome data", () => {
    registry.reset();
    registry.registerModel({
        provider: "telemetry-test", model: "local", configured: true,
        capabilities: ["chat"], intelligence: "balanced"
    });
    const metrics = router.recordOutcome({
        provider: "telemetry-test", model: "local", task: "chat",
        status: "success", latencyMs: 125, inputTokens: 10, outputTokens: 20
    });
    assert.equal(metrics.attempts >= 1, true);
    assert.equal(metrics.successRate, 1);
    assert.equal(metrics.averageLatencyMs, 125);
});

test("policy router honors local-only and context constraints", () => {
    registry.reset();
    registry.registerModel({
        provider: "policy-test", model: "cloud", configured: true,
        capabilities: ["chat"], intelligence: "expert", local: false, contextWindow: 128000
    });
    registry.registerModel({
        provider: "policy-test", model: "local", configured: true,
        capabilities: ["chat"], intelligence: "balanced", local: true, contextWindow: 32000
    });
    const decision = router.select({ task: "chat", localOnly: true, contextTokens: 16000 });
    assert.equal(decision.selected.model, "local");
});

test("policy router prefers a local model that fits currently available RAM", () => {
    registry.reset();
    registry.registerModel({
        provider: "policy-test", model: "local-small", configured: true,
        available: true, local: true, requirements: { memoryGB: 2 },
        capabilities: ["chat"], intelligence: "balanced"
    });
    registry.registerModel({
        provider: "policy-test", model: "cloud-large", configured: true,
        available: true, local: false,
        capabilities: ["chat"], intelligence: "expert"
    });

    const decision = router.select({
        task: "chat",
        preferLocal: true,
        hardware: { memoryGB: 8, availableMemoryGB: 4, hasGpu: false }
    });

    assert.equal(decision.selected.model, "local-small");
    assert.equal(decision.candidates[0].provider, "policy-test");
});

test("policy router avoids an oversized local model when a cloud option fits", () => {
    registry.reset();
    registry.registerModel({
        provider: "policy-test", model: "local-large", configured: true,
        available: true, local: true, requirements: { memoryGB: 12 },
        capabilities: ["chat"], intelligence: "expert"
    });
    registry.registerModel({
        provider: "policy-test", model: "cloud", configured: true,
        available: true, local: false,
        capabilities: ["chat"], intelligence: "balanced"
    });

    const decision = router.select({
        task: "chat",
        preferLocal: true,
        hardware: { memoryGB: 8, availableMemoryGB: 3, hasGpu: false }
    });

    assert.equal(decision.selected.model, "cloud");
    assert.equal(decision.candidates.some(candidate =>
        candidate.model === "local-large"
    ), false);
});

test("small installed Ollama models remain routable within a low RAM budget", () => {
    registry.reset();
    for (const model of registry.registerDiscoveredModels("ollama", [
        "qwen2.5:0.5b",
        "qwen2.5-coder:1.5b",
        "qwen2.5-coder:14b"
    ])) {
        registry.registerModel({ ...model, configured: true, available: true });
    }

    const decision = router.select({
        task: "code",
        preferLocal: true,
        hardware: { memoryGB: 8, availableMemoryGB: 1.8, hasGpu: false }
    });

    assert.ok(decision.candidates.some(candidate =>
        candidate.model === "qwen2.5-coder:1.5b"
    ));
    assert.ok(!decision.candidates.some(candidate =>
        candidate.model === "qwen2.5-coder:14b"
    ));
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../lib/models/registry");

test.after(() => registry.reset());

test("exposes all intelligence profiles", () => {
    assert.deepEqual(Object.keys(registry.INTELLIGENCE_PROFILES), [
        "auto", "fast", "balanced", "high", "very-high", "maximum", "expert"
    ]);
});

test("routes image-generation requests to image-capable models", () => {
    registry.reset();
    registry.registerModel({
        provider: "image-test",
        model: "image-generator",
        configured: true,
        available: true,
        capabilities: ["image"]
    });
    assert.deepEqual(registry.requiredCapabilities("image"), ["image"]);
    assert.equal(registry.selectModel({ task: "image" }).model, "image-generator");
});

test("matches task capabilities and selects the best configured fallback", () => {
    registry.reset();
    registry.registerModel({
        provider: "local-test", model: "small", configured: true,
        capabilities: ["chat", "code"], intelligence: "fast"
    });
    registry.registerModel({
        provider: "local-test", model: "expert", configured: true,
        capabilities: ["chat", "code"], intelligence: "expert"
    });
    assert.equal(registry.matchTask("code").length, 2);
    assert.equal(registry.selectModel({ task: "code", intelligence: "expert" }).model, "expert");
});

test("falls back when a high capability model is unavailable", () => {
    registry.reset();
    registry.registerModel({
        provider: "test", model: "offline", configured: false,
        capabilities: ["chat"], intelligence: "expert"
    });
    registry.registerModel({
        provider: "test", model: "available", configured: true,
        capabilities: ["chat"], intelligence: "balanced"
    });
    assert.equal(registry.select("chat").model, "available");
});

test("detects stable hardware metadata without secrets", () => {
    const hardware = registry.detectHardware();
    assert.equal(typeof hardware.platform, "string");
    assert.equal(typeof hardware.arch, "string");
    assert.equal(typeof hardware.memoryBytes, "number");
    assert.equal(Object.prototype.hasOwnProperty.call(hardware, "apiKey"), false);
});

test("registers discovered provider models with inferred task capabilities", () => {
    registry.reset();
    const models = registry.registerDiscoveredModels("ollama", [
        "qwen2.5-coder:14b",
        "nomic-embed-text",
        "llava:13b",
        "stable-diffusion"
    ]);
    const byName = Object.fromEntries(models.map(model => [model.model, model]));

    assert.equal(byName["qwen2.5-coder:14b"].available, true);
    assert.ok(byName["qwen2.5-coder:14b"].capabilities.includes("code"));
    assert.ok(byName["qwen2.5-coder:14b"].capabilities.includes("tools"));
    assert.deepEqual(byName["nomic-embed-text"].capabilities, ["embedding"]);
    assert.ok(byName["llava:13b"].capabilities.includes("vision"));
    assert.deepEqual(byName["stable-diffusion"].capabilities, ["image"]);

    const routed = registry.registerDiscoveredModels("openrouter", [
        "vendor/unknown-chat-model",
        "anthropic/claude-sonnet-4"
    ]);
    const byRoutedName = Object.fromEntries(routed.map(model => [model.model, model]));
    assert.ok(!byRoutedName["vendor/unknown-chat-model"].capabilities.includes("tools"));
    assert.ok(byRoutedName["anthropic/claude-sonnet-4"].capabilities.includes("tools"));
});

test("estimates small Ollama models realistically for low-memory devices", () => {
    assert.equal(registry.estimateLocalMemory("qwen2.5:0.5b"), 0.7);
    assert.equal(registry.estimateLocalMemory("qwen2.5-coder:1.5b"), 1.4);
    assert.equal(registry.estimateLocalMemory("llama3.2:3b"), 2.4);
    assert.equal(registry.estimateLocalMemory("qwen2.5-coder:14b"), 10.1);
});

test("warns on oversized Ollama models without blocking explicit model use", () => {
    registry.reset();
    const models = registry.registerDiscoveredModels("ollama", [
        "qwen2.5-coder:1.5b",
        "qwen2.5:7b",
        "custom-model"
    ], { memoryGB: 8 });
    const byName = Object.fromEntries(models.map(model => [model.model, model]));

    assert.equal(registry.estimateLocalMemory("qwen2.5-coder:1.5b"), 1.4);
    assert.equal(byName["qwen2.5-coder:1.5b"].available, true);
    assert.equal(byName["qwen2.5:7b"].available, true);
    assert.equal(byName["qwen2.5:7b"].requirements.memoryGB, 5.2);
    assert.equal(byName["custom-model"].available, true);

    registry.registerModel({
        provider: "ollama", model: "small-chat", capabilities: ["chat"],
        intelligence: "fast", configured: true, available: true, local: true,
        requirements: { memoryGB: 4 }
    });
    registry.registerModel({
        provider: "ollama", model: "large-chat", capabilities: ["chat"],
        intelligence: "expert", configured: true, available: true, local: true,
        requirements: { memoryGB: 20 }
    });
    const fit = registry.selectModel({
        task: "chat", provider: "ollama", hardware: { memoryGB: 8 }
    });
    assert.notEqual(fit.model, "large-chat");
    assert.ok(fit.requirements.memoryGB <= 8);
    assert.equal(registry.selectModel({
        task: "chat", provider: "ollama", model: "large-chat",
        hardware: { memoryGB: 8 }
    }).model, "large-chat");
    const oversizedFallback = registry.selectModel({
        task: "chat", provider: "ollama", hardware: { memoryGB: 1 }
    });
    assert.ok(oversizedFallback);
    assert.ok(oversizedFallback.requirements.memoryGB > 1);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../lib/models/registry");
const runtime = require("../lib/models/runtime");

test.afterEach(() => {
    runtime.reset();
    registry.reset();
});

test("runtime refresh marks discovered provider models as available", async () => {
    registry.reset();

    const snapshot = await runtime.refresh({
        force: true,
        cacheMs: 0,
        providerDefinitions: [{
            name: "ollama",
            configured: true,
            local: true
        }],
        checkProvider: async () => ({
            ok: true,
            models: ["small-chat"]
        })
    });

    assert.equal(snapshot.providers[0].status, "available");
    assert.deepEqual(snapshot.providers[0].models, ["small-chat"]);
    assert.equal(registry.getModel("ollama", "small-chat").available, true);
    assert.equal(snapshot.quota, "unknown");
});

test("runtime refresh marks models unavailable when their provider fails", async () => {
    registry.reset();
    registry.registerModel({
        provider: "ollama",
        model: "small-chat",
        configured: true,
        available: true,
        capabilities: ["chat"],
        intelligence: "balanced"
    });

    const snapshot = await runtime.refresh({
        force: true,
        cacheMs: 0,
        providerDefinitions: [{
            name: "ollama",
            configured: true,
            local: true
        }],
        checkProvider: async () => ({
            ok: false,
            reason: "Ollama is not responding."
        })
    });

    assert.equal(snapshot.providers[0].status, "unavailable");
    assert.equal(snapshot.providers[0].reason, "Ollama is not responding.");
    assert.equal(registry.getModel("ollama", "small-chat").available, false);
});

test("runtime refresh clears a stale provider error after recovery", async () => {
    registry.reset();
    const providerDefinitions = [{
        name: "ollama",
        configured: true,
        local: true
    }];
    await runtime.refresh({
        force: true,
        providerDefinitions,
        checkProvider: async () => ({
            ok: false,
            reason: "Ollama is not responding."
        })
    });
    await runtime.refresh({
        force: true,
        providerDefinitions,
        checkProvider: async () => ({
            ok: true,
            models: ["small-chat"]
        })
    });

    assert.equal(
        registry.getModel("ollama", "small-chat").metadata.runtimeReason,
        undefined
    );
    assert.equal(registry.getModel("ollama", "small-chat").available, true);
});

test("runtime refresh marks unconfigured providers without exposing credentials", async () => {
    registry.reset();
    registry.registerModel({
        provider: "ollama",
        model: "small-chat",
        configured: true,
        available: true,
        capabilities: ["chat"],
        intelligence: "balanced"
    });

    const snapshot = await runtime.refresh({
        force: true,
        providerDefinitions: [{
            name: "ollama",
            configured: false,
            local: false
        }]
    });

    assert.equal(snapshot.providers[0].status, "not_configured");
    assert.equal(registry.getModel("ollama", "small-chat").configured, false);
    assert.equal(JSON.stringify(snapshot).includes("apiKey"), false);
});

/*
Tests for the Model Router (master spec section 18).
The router must select role-appropriate models, honor env
overrides, never throw, and pass the chosen model through
to the provider gateway.
*/

const test = require("node:test");
const assert = require("node:assert");

const router = require("../src/agent/modelRouter");

const ORIGINAL_ENV = { ...process.env };

test.after(() => {
    // restore env so we don't leak overrides into other tests
    for (const key of Object.keys(process.env)) {
        if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
        process.env[key] = value;
    }
});

function withEnv(overrides, fn) {
    const added = [];
    for (const [key, value] of Object.entries(overrides)) {
        if (!(key in process.env)) added.push(key);
        process.env[key] = value;
    }
    try {
        fn();
    } finally {
        for (const key of added) delete process.env[key];
    }
}

test("router: resolves a model for every known role without throwing", () => {
    for (const role of router.ROLES) {
        const resolved = router.resolveModel(role);
        assert.equal(resolved.role, role);
        assert.equal(typeof resolved.model, "string");
        assert.equal(resolved.model.length > 0, true);
        assert.equal(["env", "role-default", "provider-default"].includes(resolved.source), true);
    }
});

test("router: unknown roles fall back to conversation, never throw", () => {
    const resolved = router.resolveModel("definitely-not-a-role");
    assert.equal(resolved.role, "conversation");
    assert.equal(typeof resolved.model, "string");
});

test("router: env override wins for a specific role", () => {
    withEnv({ NEXUS_CODE_MODEL: "custom-coder-x" }, () => {
        const resolved = router.resolveModel("code");
        assert.equal(resolved.model, "custom-coder-x");
        assert.equal(resolved.source, "env");
    });
});

test("router: NEXUS_MODEL overrides all roles", () => {
    withEnv({ NEXUS_MODEL: "universal-model" }, () => {
        for (const role of router.ROLES) {
            const resolved = router.resolveModel(role);
            assert.equal(resolved.model, "universal-model");
            assert.equal(resolved.source, "env");
        }
    });
});

test("router: role-specific env beats global NEXUS_MODEL", () => {
    withEnv({ NEXUS_MODEL: "global", NEXUS_FAST_MODEL: "speedy" }, () => {
        const fast = router.resolveModel("fast");
        assert.equal(fast.model, "speedy");

        const conversation = router.resolveModel("conversation");
        assert.equal(conversation.model, "global");
    });
});

test("router: describeRoutes covers every role", () => {
    const routes = router.describeRoutes();
    assert.equal(routes.length, router.ROLES.length);
    for (const route of routes) {
        assert.equal(typeof route.model, "string");
        assert.equal(router.ROLES.includes(route.role), true);
    }
});

test("router: roleEnvKey produces expected env names", () => {
    assert.equal(router.roleEnvKey("code"), "NEXUS_CODE_MODEL");
    assert.equal(router.roleEnvKey("conversation"), "NEXUS_CONVERSATION_MODEL");
    assert.equal(router.roleEnvKey("embedding"), "NEXUS_EMBEDDING_MODEL");
});

test("router: chat routes through the gateway with the resolved model", async () => {
    // Intercept the gateway to prove the router passed a model down.
    const gateway = require("../lib/providers/gateway");
    const original = gateway.chat;
    let capturedModel;
    gateway.chat = async (messages, options = {}) => {
        capturedModel = options.model;
        return { content: "ok", model: options.model };
    };

    try {
        const result = await router.chat("hello", { role: "fast" });
        assert.equal(result.content, "ok");
        assert.equal(typeof capturedModel, "string");
        assert.equal(capturedModel.length > 0, true);
    } finally {
        gateway.chat = original;
    }
});

test("router: chatStream routes through the gateway with the resolved model", async () => {
    const gateway = require("../lib/providers/gateway");
    const original = gateway.chatStream;
    let capturedModel;
    gateway.chatStream = async (messages, onToken, options = {}) => {
        capturedModel = options.model;
        return "streamed";
    };

    try {
        const result = await router.chatStream("hi", () => { }, { role: "code" });
        assert.equal(result, "streamed");
        assert.equal(typeof capturedModel, "string");
        assert.equal(capturedModel.length > 0, true);
    } finally {
        gateway.chatStream = original;
    }
});

test("router: extra options pass through to the gateway", async () => {
    const gateway = require("../lib/providers/gateway");
    const original = gateway.chat;
    let captured;
    gateway.chat = async (messages, options = {}) => {
        captured = options;
        return { content: "ok" };
    };

    try {
        await router.chat("hello", { role: "code", temperature: 0.2, maxTokens: 50 });
        assert.equal(captured.temperature, 0.2);
        assert.equal(captured.maxTokens, 50);
        assert.equal(typeof captured.model, "string");
    } finally {
        gateway.chat = original;
    }
});

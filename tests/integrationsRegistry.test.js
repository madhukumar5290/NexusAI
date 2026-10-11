const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../lib/integrations");

test("ships safe built-in connector manifests", () => {
    const builtins = registry.list({ builtin: true });
    assert.equal(builtins.length, 10);
    assert.deepEqual(builtins.map(item => item.id), [
        "mcp", "github", "google-drive", "onedrive", "database", "rest", "email", "calendar", "storage", "browser"
    ]);
    assert.ok(builtins.every(item => !("token" in item) && !("secret" in item)));
    assert.ok(builtins.every(item => item.adapterAvailable === false));
});

test("registers, lists, and retrieves isolated connector manifests", () => {
    const id = "test-connector";
    const connector = registry.register({
        id, name: "Test connector", capabilities: ["read"],
        metadata: { region: "local", apiToken: "must not persist" }
    });
    assert.equal(connector.id, id);
    assert.equal(registry.get(id).metadata.apiToken, undefined);
    assert.equal(registry.list({ builtin: false }).some(item => item.id === id), true);
    assert.throws(() => registry.register({ id, name: "duplicate" }), /already registered/);
});

test("tracks connection state, health, and disconnect without retaining secrets", () => {
    const id = "state-test";
    registry.register({ id, name: "State test" });
    assert.equal(registry.state(id).status, "disconnected");
    registry.connect(id, { token: "secret", region: "test" });
    assert.equal(registry.state(id).status, "connected");
    assert.equal(registry.state(id).metadata.token, undefined);
    assert.equal(registry.health(id).healthy, true);
    registry.disconnect(id);
    assert.equal(registry.health(id).healthy, false);
    registry.reset();
});

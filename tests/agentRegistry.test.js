"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../lib/agents");

test.beforeEach(() => registry.reset());

test("loads built-in agents with usable policies", () => {
    const coding = registry.get("coding");
    assert.ok(coding);
    assert.equal(coding.builtin, true);
    assert.ok(coding.allowedTools.includes("workspace_update_file"));
    assert.ok(registry.canUseTool(coding, "terminal_execute"));
    assert.equal(registry.canUseModel(coding, "code"), true);
});

test("registers, validates, updates, and removes custom agents", () => {
    const created = registry.register({
        id: "docs-writer",
        name: "Docs writer",
        allowedTools: ["workspace_read_file"],
        allowedModels: ["chat"],
        knowledge: ["conversation"],
        approvalPolicy: { mode: "always", tools: ["workspace_update_file"] }
    });
    assert.equal(created.builtin, false);
    assert.deepEqual(created.knowledge.sources, ["conversation"]);
    assert.equal(registry.update("docs-writer", { description: "updated" }).description, "updated");
    assert.equal(registry.remove("docs-writer"), true);
    assert.equal(registry.get("docs-writer"), null);
    assert.throws(() => registry.register({ id: "bad id", allowedTools: [] }), /agent id/);
});

test("does not expose mutable registry state or remove built-ins", () => {
    const agent = registry.get("general");
    agent.allowedTools.push("terminal_execute");
    assert.equal(registry.canUseTool("general", "terminal_execute"), false);
    assert.equal(registry.remove("general"), false);
    assert.equal(registry.get("general").builtin, true);
});

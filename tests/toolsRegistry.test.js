const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const permissions = require("../src/agent/permissions");
const toolRegistry = require("../src/agent/toolRegistry");
const { ensureRegistered } = require("../src/agent/tools");

test("permission system grants and revokes", () => {
    assert.ok(permissions.isGranted("READ"));
    permissions.revoke("WRITE");
    assert.ok(!permissions.isGranted("WRITE"));
    permissions.grant("WRITE");
    assert.ok(permissions.isGranted("WRITE"));
});

test("requireCapabilities throws for missing capability", () => {
    permissions.revoke("DELETE");
    assert.throws(
        () => permissions.requireCapabilities(["DELETE"], "test_tool"),
        /Permission denied/
    );
    permissions.grant("DELETE");
    assert.ok(permissions.requireCapabilities(["DELETE"], "test_tool"));
});

test("registry registers tools with schema and permissions", () => {
    ensureRegistered();

    const tool = toolRegistry.get("workspace_create_file");
    assert.ok(tool);
    assert.strictEqual(tool.name, "workspace_create_file");
    assert.ok(tool.schema.properties.path);
    assert.deepStrictEqual(tool.permissions, ["READ", "WRITE"]);

    const list = toolRegistry.list();
    assert.ok(list.length >= 6);
});

test("registry runs a tool and verifies it", async () => {
    ensureRegistered();

    const name = "registry_test_file.txt";
    const result = await toolRegistry.run("workspace_create_file", {
        path: name,
        content: "hello nexus"
    });

    assert.ok(result.ok);
    assert.ok(result.result.success);
    assert.strictEqual(result.verification.exists, true);

    // cleanup
    await toolRegistry.run("workspace_delete_file", { path: name });
    assert.strictEqual(
        require("../src/agent/workspaceTools").fileExists(name).exists,
        false
    );
});

test("registry denies tools whose permissions are revoked", async () => {
    ensureRegistered();

    permissions.revoke("DELETE");
    const result = await toolRegistry.run("workspace_delete_file", {
        path: "anything.txt"
    });
    assert.ok(!result.ok);
    assert.ok(result.permissionDenied);
    permissions.grant("DELETE");

    // also unknown tool
    const unknown = await toolRegistry.run("nonexistent_tool", {});
    assert.ok(!unknown.ok);
});

test("workspace paths stay inside the workspace root", () => {
    const workspaceTools = require("../src/agent/workspaceTools");
    assert.throws(
        () => workspaceTools.readFile("../package.json"),
        /outside the Nexus workspace/
    );
});

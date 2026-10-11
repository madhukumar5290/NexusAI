const test = require("node:test");
const assert = require("node:assert");

const terminalTool = require("../src/agent/terminalTool");
const permissions = require("../src/agent/permissions");

test("validateCommand rejects non-allowlisted commands", () => {
    assert.throws(
        () => terminalTool.validateCommand("powershell", []),
        /not allowed/
    );

    assert.throws(
        () => terminalTool.validateCommand("rm", ["-rf", "/"]),
        /not allowed/
    );

    assert.throws(
        () => terminalTool.validateCommand("curl", ["http://evil.com"]),
        /not allowed/
    );
});

test("validateCommand accepts allowlisted commands", () => {
    const { executable, argList } = terminalTool.validateCommand(
        "node",
        ["--version"]
    );

    assert.strictEqual(executable, "node");
    assert.deepStrictEqual(argList, ["--version"]);
});

test("validateCommand blocks dangerous arguments", () => {
    assert.throws(
        () => terminalTool.validateCommand("npm", ["install", "evil"]),
        /Argument not allowed/
    );

    assert.throws(
        () => terminalTool.validateCommand("git", ["push", "--force"]),
        /Argument not allowed/
    );

    assert.throws(
        () => terminalTool.validateCommand("git", ["push"]),
        /Argument not allowed/
    );
});

test("executeCommand is denied without EXECUTE permission", () => {
    permissions.revoke("EXECUTE");

    assert.throws(
        () => terminalTool.executeCommand({
            command: "node",
            args: ["--version"]
        }),
        /Permission denied/
    );

    permissions.grant("EXECUTE");
    assert.ok(permissions.isGranted("EXECUTE"));
});

test("executeCommand runs node --version in the workspace", async () => {
    permissions.grant("EXECUTE");

    const result = await terminalTool.executeCommand({
        command: "node",
        args: ["--version"]
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.stdout, /^v\d+\./);
    assert.ok(result.durationMs >= 0);
});

test("executeCommand rejects non-zero exits honestly", async () => {
    permissions.grant("EXECUTE");

    const result = await terminalTool.executeCommand({
        command: "node",
        args: ["-e", "process.exit(2)"]
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 2);
});

test("executeCommand timeout kills long-running processes", async () => {
    permissions.grant("EXECUTE");

    const result = await terminalTool.executeCommand({
        command: "node",
        args: ["-e", "setInterval(() => {}, 1000)"],
        timeoutMs: 1500
    });

    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.success, false);
});

test("run log records executions", async () => {
    permissions.grant("EXECUTE");

    await terminalTool.executeCommand({
        command: "node",
        args: ["--version"]
    });

    const log = terminalTool.getRunLog(10);
    assert.ok(log.length >= 1);
});

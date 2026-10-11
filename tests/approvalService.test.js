const test = require("node:test");
const assert = require("node:assert");

const approvalService =
    require("../src/agent/approvalService");

test("approval tokens are bound to one tool and input", () => {
    const requested =
        approvalService.requestApproval({
            tool: "terminal_execute",
            summary: "Run tests",
            input: {
                command: "node",
                args: ["--version"]
            }
        });

    const wrongTool =
        approvalService.consumeApproval(
            requested.token,
            "git_commit",
            {
                command: "node",
                args: ["--version"]
            }
        );

    assert.equal(wrongTool.ok, false);

    const wrongInput =
        approvalService.consumeApproval(
            requested.token,
            "terminal_execute",
            {
                command: "npm",
                args: ["test"]
            }
        );

    assert.equal(wrongInput.ok, false);

    const consumed =
        approvalService.consumeApproval(
            requested.token,
            "terminal_execute",
            {
                command: "node",
                args: ["--version"]
            }
        );

    assert.equal(consumed.ok, true);

    const reused =
        approvalService.consumeApproval(
            requested.token,
            "terminal_execute",
            {
                command: "node",
                args: ["--version"]
            }
        );

    assert.equal(reused.ok, false);
});

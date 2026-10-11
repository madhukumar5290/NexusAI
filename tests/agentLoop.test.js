/*
Unit tests for the agent tool loop, using an
injected fake chat function — no live model needed.
Run: node --test tests/agentLoop.test.js
*/

const test = require("node:test");

const assert = require("node:assert");

const agentLoop = require("../src/agent/agentLoop");

const tools = require("../src/agent/tools");

const workspaceTools = require("../src/agent/workspaceTools");

const { tmpdir } = require("node:os");

const path = require("node:path");

const fs = require("node:fs");
/*
--------------------------------------------------
SETUP
--------------------------------------------------
Register the built-in tools once and point the
workspace at a throwaway temp dir so tests never
touch the real workspace.
*/

const TEST_WORKSPACE = fs.mkdtempSync(
    path.join(tmpdir(), "nexus-loop-test-")
);

process.env.NEXUS_WORKSPACE = TEST_WORKSPACE;

tools.ensureRegistered();

function turnWithTools() {
    return [
        {
            type: "tool_call",

            id: "call_1",

            name: "workspace_create_file",

            arguments: {
                path: "loop-test.txt",

                content: "created by loop test"
            }
        },

        {
            type: "done",
            finishReason: "tool_calls"
        }
    ];
}

function turnWithAnswer() {
    return [
        {
            type: "text_delta",
            text: "The file was created and verified."
        },

        {
            type: "done",
            finishReason: "stop"
        }
    ];
}

test("toProviderTools maps schema to parameters", () => {
    const specs = agentLoop.toProviderTools([
        "workspace_create_file",
        "does_not_exist"
    ]);

    assert.equal(specs.length, 1);

    assert.equal(
        specs[0].name,
        "workspace_create_file"
    );

    assert.equal(specs[0].parameters.type, "object");
});

test("loop executes a tool call, verifies, then answers", async () => {
    let calls = 0;

    const fakeChat = async request => {
        calls += 1;

        const events =
            calls === 1
                ? turnWithTools()
                : turnWithAnswer();

        return (async function* () {
            for (const event of events) {
                yield event;
            }
        })();
    };

    const activities = [];

    const tokens = [];

    const result = await agentLoop.run({
        userMessage: "Create loop-test.txt",

        system: "test system",

        messages: [
            {
                role: "user",
                content: "Create loop-test.txt"
            }
        ],

        chatFn: fakeChat,

        onActivity: event =>
            activities.push(event.message),

        onToken: token => tokens.push(token)
    });

    /*
    The file really exists on disk — the loop
    actually acted, not just claimed to.
    */
    const written = workspaceTools.readFile(
        "loop-test.txt"
    );

    assert.equal(
        written.content,
        "created by loop test"
    );

    assert.equal(result.usedTools, true);

    assert.equal(result.toolRuns.length, 1);

    assert.equal(result.toolRuns[0].ok, true);

    assert.ok(result.answer.length > 0);

    assert.ok(
        activities.some(message =>
            /Using tool workspace_create_file/.test(
                message
            )
        )
    );

    assert.ok(tokens.length > 0);
});

test("loop reports tool failure to the model and still answers", async () => {
    let calls = 0;

    const fakeChat = async () => {
        calls += 1;

        return (async function* () {
            if (calls === 1) {
                yield {
                    type: "tool_call",

                    id: "call_bad",

                    name: "workspace_read_file",

                    arguments: {
                        path: "../escape.txt"
                    }
                };
            } else {
                yield {
                    type: "text_delta",
                    text: "The read failed, so I reported the error."
                };
            }

            yield {
                type: "done",
                finishReason: "stop"
            };
        })();
    };

    const result = await agentLoop.run({
        userMessage: "read ../escape.txt",

        system: "test",

        messages: [
            {
                role: "user",
                content: "read ../escape.txt"
            }
        ],

        chatFn: fakeChat
    });

    assert.equal(result.usedTools, true);

    assert.equal(result.toolRuns.length, 1);

    /*
    The unsafe path was rejected by the workspace
    path guard, so the tool run failed.
    */
    assert.equal(result.toolRuns[0].ok, false);

    assert.ok(
        /error/i.test(result.answer) ||
            result.answer.length > 0
    );
});

test("loop handles long tool arguments without crashing", async () => {
    let calls = 0;

    const fakeChat = async () => {
        calls += 1;

        return (async function* () {
            if (calls === 1) {
                yield {
                    type: "tool_call",
                    id: "call_long",
                    name: "workspace_create_file",
                    arguments: {
                        path: "long-tool-args.txt",
                        content: "x".repeat(300)
                    }
                };
            } else {
                yield {
                    type: "text_delta",
                    text: "The file was created."
                };
            }

            yield {
                type: "done",
                finishReason: calls === 1
                    ? "tool_calls"
                    : "stop"
            };
        })();
    };

    const result = await agentLoop.run({
        userMessage: "create a file",
        system: "test",
        messages: [
            {
                role: "user",
                content: "create a file"
            }
        ],
        chatFn: fakeChat
    });

    assert.equal(result.toolRuns[0].ok, true);
    assert.equal(result.answer, "The file was created.");
});

test("loop respects the step budget and still produces a final answer", async () => {
    const originalMax =
        require("../lib/config").LIMITS.maxAgentSteps;

    require("../lib/config").LIMITS.maxAgentSteps = 2;

    try {
        let calls = 0;

        const fakeChat = async () => {
            calls += 1;

            return (async function* () {
                /*
                Always wants another tool call — the
                budget must break the cycle.
                */
                yield {
                    type: "tool_call",

                    id: `call_${calls}`,

                    name: "workspace_list",

                    arguments: {}
                };

                yield {
                    type: "done",
                    finishReason: "tool_calls"
                };
            })();
        };

        const result = await agentLoop.run({
            userMessage: "keep listing",

            system: "test",

            messages: [
                {
                    role: "user",
                    content: "keep listing"
                }
            ],

            chatFn: fakeChat
        });

        assert.ok(result.answer.length > 0);

        assert.ok(result.steps <= 2);
    } finally {
        require("../lib/config").LIMITS.maxAgentSteps =
            originalMax;
    }
});

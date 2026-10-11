"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const providers = require("../lib/providers");
const { generateWorkspacePlan } = require("../src/agent/agentCore");

test("workspace planning uses the routed code provider and model", async () => {
    const originalChat = providers.chat;
    let request;
    providers.chat = value => {
        request = value;
        return (async function* () {
            yield {
                type: "text_delta",
                text: JSON.stringify({
                    files: [{ path: "index.html", content: "<h1>Built</h1>" }]
                })
            };
            yield { type: "done", finishReason: "stop" };
        })();
    };

    try {
        const plan = await generateWorkspacePlan(
            "Create a page",
            "",
            null,
            [],
            "CREATE",
            "anthropic",
            "claude-test-model"
        );
        assert.equal(request.role, "code");
        assert.equal(request.provider, "anthropic");
        assert.equal(request.model, "claude-test-model");
        assert.equal(request.stream, false);
        assert.equal(plan.files[0].path, "index.html");
    } finally {
        providers.chat = originalChat;
    }
});

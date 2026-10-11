const assert = require("node:assert/strict");
const test = require("node:test");
const { collect } = require("../lib/providers/base");
const openai = require("../lib/providers/openai");

test("Responses transport normalizes text and function calls", async () => {
    const originalFetch = global.fetch;
    let body;
    global.fetch = async (url, options) => {
        assert.match(url, /\/responses$/);
        body = JSON.parse(options.body);
        return { ok: true, json: async () => ({ status: "completed", output: [
            { type: "message", content: [{ type: "output_text", text: "Done" }] },
            { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{\"q\":\"test\"}" }
        ] }) };
    };
    try {
        const result = await collect(openai.chat({ model: "responses-test-model", useResponses: true, system: "Be helpful", messages: [{ role: "user", content: "Hi" }], tools: [{ name: "lookup", parameters: { type: "object" } }] }, { baseUrl: "https://api.example/v1", apiKey: "key" }));
        assert.equal(body.instructions, "Be helpful");
        assert.equal(body.tools[0].type, "function");
        assert.equal(result.text, "Done");
        assert.deepEqual(result.toolCalls[0].arguments, { q: "test" });
    } finally { global.fetch = originalFetch; }
});

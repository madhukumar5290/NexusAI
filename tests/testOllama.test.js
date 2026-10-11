/*
Unit tests for the shared Ollama helpers.
parseJson is pure logic — no network or Ollama required.
Run: node --test tests/testOllama.test.js
*/

const test = require("node:test");
const assert = require("node:assert");
const { parseJson } =
    require("../lib/ollama.js");
const { LOCAL_FALLBACK_MODEL } =
    require("../lib/config.js");

test("parseJson parses plain JSON objects", () => {
    assert.deepEqual(
        parseJson('{"a": 1, "b": "x"}'),
        { a: 1, b: "x" }
    );
});

test("parseJson parses plain JSON arrays", () => {
    assert.deepEqual(
        parseJson("[1, 2, 3]"),
        [1, 2, 3]
    );
});

test("parseJson strips ```json code fences", () => {
    assert.deepEqual(
        parseJson('```json\n{"a": 1}\n```'),
        { a: 1 }
    );
    assert.deepEqual(
        parseJson('```\n{"a": 2}\n```'),
        { a: 2 }
    );
});

test("parseJson extracts JSON embedded in prose", () => {
    assert.deepEqual(
        parseJson(
            'Here is the plan: {"steps": ["one"]} hope that helps!'
        ),
        { steps: ["one"] }
    );
});

test("parseJson trims surrounding whitespace", () => {
    assert.deepEqual(
        parseJson("   \n  {\"ok\": true}  \n "),
        { ok: true }
    );
});

test("parseJson throws on invalid input", () => {
    assert.throws(
        () => parseJson("no json here at all"),
        /valid JSON/
    );
    assert.throws(
        () => parseJson(""),
        /valid JSON/
    );
    assert.throws(
        () => parseJson(null),
        /valid JSON/
    );
});

test("config exposes the local fallback model", () => {
    assert.equal(
        typeof LOCAL_FALLBACK_MODEL,
        "string"
    );
    assert.ok(
        LOCAL_FALLBACK_MODEL.length > 0
    );
});

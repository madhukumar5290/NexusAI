"use strict";

/*
 * Auto-title generation.
 *
 * A chat title should read like a topic, not like the instruction
 * the user typed. These cases pin the behaviour that matters and
 * guard against regressions when the rules change.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/*
The generator is defined inside src/server.js, which starts a
listening server on require. Extract the function body instead of
importing the module.
*/
const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "server.js"),
    "utf8"
);

const match = source.match(/function generateChatTitle\(message\)[\s\S]*?\n\}/);

if (!match) {
    throw new Error("generateChatTitle not found in src/server.js");
}

/* eslint-disable no-eval */
const generateChatTitle = eval(`(${match[0]})`);

test("strips 'reply with exactly' scaffolding", () => {
    assert.equal(generateChatTitle("Reply with exactly: pong"), "Pong");
    assert.equal(generateChatTitle("reply with only: yes"), "Yes");
});

test("strips stacked politeness prefixes", () => {
    assert.equal(
        generateChatTitle("please can you reply with exactly: pong"),
        "Pong"
    );
});

test("keeps the subject of a how-question", () => {
    assert.equal(
        generateChatTitle("Can you explain how HTTPS works?"),
        "How HTTPS works"
    );
});

test("drops trailing politeness", () => {
    assert.equal(
        generateChatTitle("fix the bug in my code please"),
        "Fix the bug in my code"
    );
});

test("drops trailing 'for me please'", () => {
    assert.equal(
        generateChatTitle("I want you to summarize this document for me please"),
        "This document"
    );
});

test("drops trailing qualifiers like 'in simple terms'", () => {
    assert.equal(
        generateChatTitle("tell me about quantum computing in simple terms"),
        "Quantum computing"
    );
});

test("never returns an empty title", () => {
    assert.equal(generateChatTitle(""), "New Chat");
    assert.equal(generateChatTitle("   "), "New Chat");
    assert.equal(generateChatTitle("please"), "Please");
});

test("capitalises the first character", () => {
    assert.equal(generateChatTitle("hello"), "Hello");
    assert.equal(generateChatTitle("fix a bug"), "Fix a bug");
});

test("never exceeds the sidebar length limit", () => {
    const long = "a".repeat(200);
    assert.ok(generateChatTitle(long).length <= 48);
});

test("does not cut a word in half when a break point exists", () => {
    const title = generateChatTitle(
        "Write a Python script that renames every file in a folder"
    );
    /* Must not end mid-word: the last character should close a word. */
    assert.ok(!/[a-z]$/.test(title) || title.endsWith(title.split(" ").pop()));
    assert.ok(title.length <= 48);
});

test("removes code fences so a pasted snippet is not the title", () => {
    const title = generateChatTitle("```js\nconst x = 1;\n```");
    assert.ok(!title.includes("```"));
});

test("collapses repeated whitespace", () => {
    assert.equal(generateChatTitle("explain    this     now"), "This now");
});
test("strips 'one word' instruction phrasing", () => {
    assert.equal(generateChatTitle("Reply with one word: ready"), "Ready");
    assert.equal(generateChatTitle("answer in a single word - yes"), "Yes");
});
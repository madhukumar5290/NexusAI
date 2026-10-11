"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    IDENTITY_ANSWER,
    isIdentityQuestion
} = require("../lib/assistantIdentity");

test("recognizes Jarwis identity questions without a configured model", () => {
    for (const question of [
        "Are you Jarwis?",
        "are you really Jarvis",
        "Hey, are you Jarwis!",
        "Who are you?",
        "What's your name?",
        "what is your name…"
    ]) {
        assert.equal(isIdentityQuestion(question), true, question);
    }

    assert.match(IDENTITY_ANSWER, /I'm Jarwis/);
    assert.match(IDENTITY_ANSWER, /models or tools are available depends/);
});

test("does not intercept requests that are not asking for assistant identity", () => {
    for (const message of [
        "What can you do?",
        "Is Jarwis configured for cloud models?",
        "Tell me about Jarwis projects.",
        ""
    ]) {
        assert.equal(isIdentityQuestion(message), false, message);
    }
});

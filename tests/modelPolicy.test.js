"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../lib/models/policy");

const candidates = [
    { provider: "ollama", model: "qwen", local: true },
    { provider: "groq", model: "llama", local: false },
    { provider: "google", model: "gemini", local: false },
    { provider: "openrouter", model: "vendor/model:free", local: false },
    { provider: "openrouter", model: "vendor/model", local: false },
    { provider: "openai", model: "gpt", local: false }
];

test("ordinary automatic requests allow local and known free-tier candidates only", () => {
    const previous = process.env.NEXUS_AUTO_ALLOW_PAID_API;
    delete process.env.NEXUS_AUTO_ALLOW_PAID_API;
    try {
        assert.deepEqual(
            policy.filterAutomaticCandidates(candidates, { intelligence: "balanced" }),
            candidates.slice(0, 4)
        );
    } finally {
        if (previous === undefined) delete process.env.NEXUS_AUTO_ALLOW_PAID_API;
        else process.env.NEXUS_AUTO_ALLOW_PAID_API = previous;
    }
});

test("paid providers are excluded from automatic routing until explicitly enabled", () => {
    const previous = process.env.NEXUS_AUTO_ALLOW_PAID_API;
    delete process.env.NEXUS_AUTO_ALLOW_PAID_API;
    try {
        assert.equal(policy.allowsPaidAutomatic({ intelligence: "expert" }), false);
        assert.equal(policy.allowsPaidAutomatic({ contextTokens: 32000 }), false);
        assert.equal(
            policy.filterAutomaticCandidates(candidates, { intelligence: "expert" }).length,
            4
        );
    } finally {
        if (previous === undefined) delete process.env.NEXUS_AUTO_ALLOW_PAID_API;
        else process.env.NEXUS_AUTO_ALLOW_PAID_API = previous;
    }
    assert.equal(policy.allowsPaidAutomatic({ allowPaid: true }), true);
    process.env.NEXUS_AUTO_ALLOW_PAID_API = "true";
    try {
        assert.equal(policy.allowsPaidAutomatic({ intelligence: "high" }), true);
    } finally {
        if (previous === undefined) delete process.env.NEXUS_AUTO_ALLOW_PAID_API;
        else process.env.NEXUS_AUTO_ALLOW_PAID_API = previous;
    }
});

test("automatic fallbacks do not select an unapproved paid provider", () => {
    const previous = process.env.NEXUS_AUTO_ALLOW_PAID_FALLBACK;
    delete process.env.NEXUS_AUTO_ALLOW_PAID_FALLBACK;
    try {
        assert.equal(policy.isFallbackEligible(candidates[0]), true);
        assert.equal(policy.isFallbackEligible(candidates[3]), true);
        assert.equal(policy.isFallbackEligible(candidates[5]), false);
        assert.equal(policy.isFallbackEligible(candidates[5], {
            allowPaidFallback: true
        }), true);
    } finally {
        if (previous === undefined) delete process.env.NEXUS_AUTO_ALLOW_PAID_FALLBACK;
        else process.env.NEXUS_AUTO_ALLOW_PAID_FALLBACK = previous;
    }
});

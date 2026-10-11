"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { allowsJarwisAudioPermission } = require("../lib/security/mediaPermission");

const appOrigin = "http://127.0.0.1:34567";

test("allows audio capture only from the Jarwis app origin", () => {
    assert.equal(
        allowsJarwisAudioPermission(
            "media",
            `${appOrigin}/`,
            appOrigin,
            ["audio"]
        ),
        true
    );
    assert.equal(
        allowsJarwisAudioPermission(
            "media",
            `${appOrigin}/`,
            appOrigin,
            "audio"
        ),
        true
    );
});

test("rejects video, unrelated permissions, and cross-origin requests", () => {
    assert.equal(
        allowsJarwisAudioPermission(
            "media",
            appOrigin,
            appOrigin,
            ["audio", "video"]
        ),
        false
    );
    assert.equal(
        allowsJarwisAudioPermission(
            "geolocation",
            appOrigin,
            appOrigin,
            ["audio"]
        ),
        false
    );
    assert.equal(
        allowsJarwisAudioPermission(
            "media",
            appOrigin,
            appOrigin,
            "video"
        ),
        false
    );
    assert.equal(
        allowsJarwisAudioPermission(
            "media",
            "https://example.com",
            appOrigin,
            ["audio"]
        ),
        false
    );
});

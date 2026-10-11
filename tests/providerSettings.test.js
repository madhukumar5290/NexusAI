"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const config = require("../lib/config");

test("provider keys are saved locally without overwriting unrelated settings", t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jarwis-provider-settings-"));
    const envFile = path.join(directory, ".env");
    const originalKey = process.env.GROQ_API_KEY;
    const originalCompatibleBaseUrl = process.env.COMPATIBLE_BASE_URL;
    fs.writeFileSync(envFile, "KEEP_THIS=value\nGROQ_API_KEY=old-value\n", "utf8");
    if (process.platform !== "win32") fs.chmodSync(envFile, 0o644);
    t.after(() => {
        if (originalKey === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = originalKey;
        if (originalCompatibleBaseUrl === undefined) delete process.env.COMPATIBLE_BASE_URL;
        else process.env.COMPATIBLE_BASE_URL = originalCompatibleBaseUrl;
        config.refreshProviderSecrets();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const result = config.persistEnvValues(
        { GROQ_API_KEY: "test-key-value" },
        envFile
    );

    assert.deepEqual(result.saved, ["GROQ_API_KEY"]);
    assert.equal(config.PROVIDERS.groq.apiKey, "test-key-value");
    assert.match(fs.readFileSync(envFile, "utf8"), /KEEP_THIS=value/);
    assert.match(fs.readFileSync(envFile, "utf8"), /GROQ_API_KEY=test-key-value/);
    if (process.platform !== "win32") {
        assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
    }
    assert.doesNotMatch(JSON.stringify(result), /test-key-value/);
});

test("compatible provider endpoint changes take effect without restarting", t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jarwis-provider-settings-"));
    const envFile = path.join(directory, ".env");
    const originalBaseUrl = process.env.COMPATIBLE_BASE_URL;
    t.after(() => {
        if (originalBaseUrl === undefined) delete process.env.COMPATIBLE_BASE_URL;
        else process.env.COMPATIBLE_BASE_URL = originalBaseUrl;
        config.refreshProviderSecrets();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    config.persistEnvValues(
        { COMPATIBLE_BASE_URL: "http://127.0.0.1:8123/v1" },
        envFile
    );

    assert.equal(
        config.PROVIDERS.compatible.baseUrl,
        "http://127.0.0.1:8123/v1"
    );
});

test("provider key persistence rejects newlines without changing existing config", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jarwis-provider-settings-"));
    const envFile = path.join(directory, ".env");
    fs.writeFileSync(envFile, "KEEP_THIS=value\n", "utf8");

    try {
        assert.throws(
            () => config.persistEnvValues({ GROQ_API_KEY: "key\nINJECTED=value" }, envFile),
            /Invalid value for GROQ_API_KEY/
        );
        assert.equal(fs.readFileSync(envFile, "utf8"), "KEEP_THIS=value\n");
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDirectory = path.join(__dirname, "..", "public");

test("PWA manifest provides a standalone install target and branded icon", () => {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(publicDirectory, "manifest.webmanifest"), "utf8")
    );
    const html = fs.readFileSync(path.join(publicDirectory, "index.html"), "utf8");

    assert.equal(manifest.name, "Jarwis");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/");
    assert.ok(manifest.icons.some(icon => icon.src === "/jarwis-icon.svg"));
    assert.ok(fs.existsSync(path.join(publicDirectory, "jarwis-icon.svg")));
    assert.match(html, /rel="manifest"\s+href="\/manifest\.webmanifest"/);
    assert.match(html, /id="installAppButton"/);
});

test("offline worker only caches the public shell and bypasses API requests", () => {
    const worker = fs.readFileSync(path.join(publicDirectory, "service-worker.js"), "utf8");

    assert.match(worker, /CACHE_NAME\s*=\s*"jarwis-shell-v6"/);
    assert.match(worker, /APP_SHELL\s*=\s*\[/);
    assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
    assert.match(worker, /request\.method !== "GET"/);
    assert.match(worker, /request\.mode === "navigate"/);
    assert.doesNotMatch(worker, /cache\.put\([^)]*\/api\//);
});

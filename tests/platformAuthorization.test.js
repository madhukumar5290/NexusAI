"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const originalDataDir = process.env.NEXUS_DATA_DIR;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-platform-auth-"));
process.env.NEXUS_DATA_DIR = dataDir;

const platformRoutes = require("../src/routes/platform");
const app = express();
app.use((req, _res, next) => {
    req.nexusUser = { id: "member-1", username: "member@example.com", role: "member" };
    next();
});
app.use("/api", platformRoutes.routes());

let server;
let baseUrl;

test.before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server?.listening) {
        await new Promise((resolve, reject) => server.close(error =>
            error ? reject(error) : resolve()
        ));
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.NEXUS_DATA_DIR;
    else process.env.NEXUS_DATA_DIR = originalDataDir;
});

test("instance-wide usage and metrics are restricted to administrators", async () => {
    for (const route of ["/api/usage", "/api/metrics"]) {
        const response = await fetch(`${baseUrl}${route}`);
        assert.equal(response.status, 403, `${route} should not expose instance data to members`);
    }
});

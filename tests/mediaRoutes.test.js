"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const originalDataDir = process.env.NEXUS_DATA_DIR;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-media-data-"));
const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-media-workspace-"));
process.env.NEXUS_DATA_DIR = dataDir;

const mediaRoutes = require("../src/routes/media");
const generatedCalls = [];
const workspaceTools = {
    createFolder(relativePath) {
        fs.mkdirSync(path.join(workspaceRoot, relativePath), { recursive: true });
    },
    listFiles(relativePath) {
        const directory = path.join(workspaceRoot, relativePath);
        return {
            entries: fs.readdirSync(directory, { withFileTypes: true }).map(entry => ({
                name: entry.name,
                type: entry.isDirectory() ? "folder" : "file"
            }))
        };
    },
    resolveWorkspacePath(relativePath) {
        return path.join(workspaceRoot, relativePath);
    },
    deleteFile(relativePath) {
        fs.unlinkSync(path.join(workspaceRoot, relativePath));
    }
};

const app = express();
app.use(express.json());
app.use("/api", mediaRoutes.routes({
    workspaceTools,
    generateImage: async input => {
        generatedCalls.push(input);
        const output = path.join(workspaceRoot, input.outputPath);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, Buffer.from("image-data"));
        return {
            ok: true,
            path: input.outputPath,
            previewUrl: `/api/preview/${input.outputPath}`,
            size: 10,
            model: "test-image-model",
            format: input.format
        };
    }
}));

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
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.NEXUS_DATA_DIR;
    else process.env.NEXUS_DATA_DIR = originalDataDir;
});

test("image gallery lists only supported image files in the generated folder", async () => {
    const generatedDir = path.join(workspaceRoot, "generated");
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.writeFileSync(path.join(generatedDir, "saved image.webp"), "webp");
    fs.writeFileSync(path.join(generatedDir, "notes.txt"), "not an image");
    fs.mkdirSync(path.join(generatedDir, "nested"));

    const response = await fetch(`${baseUrl}/api/images`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.images.map(image => image.name), ["saved image.webp"]);
    assert.equal(data.images[0].previewUrl, "/api/preview/generated/saved%20image.webp");
    assert.equal(data.available, false);
});

test("image generation validates prompt and persists a unique gallery image", async () => {
    const missingPrompt = await fetch(`${baseUrl}/api/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "   " })
    });
    assert.equal(missingPrompt.status, 400);

    const response = await fetch(`${baseUrl}/api/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            prompt: "A small garden after rain",
            size: "1024x1536",
            quality: "medium",
            format: "webp",
            model: "gpt-image-2"
        })
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.match(result.path, /^generated\/nexus-.*\.webp$/);
    assert.equal(result.previewUrl, `/api/preview/${result.path}`);
    assert.equal(generatedCalls.length, 1);
    assert.equal(generatedCalls[0].prompt, "A small garden after rain");
    assert.equal(generatedCalls[0].size, "1024x1536");
    assert.equal(generatedCalls[0].model, "gpt-image-2");
    assert.equal(fs.existsSync(path.join(workspaceRoot, result.path)), true);
});

test("image gallery files can be deleted and invalid paths are rejected", async () => {
    const images = path.join(workspaceRoot, "generated");
    fs.mkdirSync(images, { recursive: true });
    fs.writeFileSync(path.join(images, "remove me.png"), "image");

    const deleted = await fetch(
        `${baseUrl}/api/images/${encodeURIComponent("remove me.png")}`,
        { method: "DELETE" }
    );
    assert.equal(deleted.status, 200);
    assert.equal(fs.existsSync(path.join(images, "remove me.png")), false);

    const invalid = await fetch(
        `${baseUrl}/api/images/${encodeURIComponent("../notes.txt")}`,
        { method: "DELETE" }
    );
    assert.equal(invalid.status, 400);

    const missing = await fetch(`${baseUrl}/api/images/missing.png`, {
        method: "DELETE"
    });
    assert.equal(missing.status, 404);
});

test("image provider errors are returned as actionable gateway errors", async () => {
    const failingApp = express();
    failingApp.use(express.json());
    failingApp.use("/api", mediaRoutes.routes({
        workspaceTools,
        generateImage: async () => {
            throw new Error("Image generation requires OPENAI_API_KEY in .env.");
        }
    }));
    const failingServer = failingApp.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        failingServer.once("listening", resolve);
        failingServer.once("error", reject);
    });
    try {
        const response = await fetch(`http://127.0.0.1:${failingServer.address().port}/api/images/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: "A watercolor skyline" })
        });
        assert.equal(response.status, 502);
        assert.match((await response.json()).error, /OPENAI_API_KEY/);
    } finally {
        await new Promise((resolve, reject) => failingServer.close(error =>
            error ? reject(error) : resolve()
        ));
    }
});

test("image gallery and generation are not available to member accounts", async () => {
    const memberApp = express();
    memberApp.use(express.json());
    memberApp.use((req, _res, next) => {
        req.nexusUser = { id: "member-1", username: "member@example.com", role: "member" };
        next();
    });
    memberApp.use("/api", mediaRoutes.routes({
        workspaceTools,
        generateImage: async () => {
            throw new Error("Member unexpectedly reached image provider.");
        }
    }));
    const memberServer = memberApp.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        memberServer.once("listening", resolve);
        memberServer.once("error", reject);
    });
    try {
        const base = `http://127.0.0.1:${memberServer.address().port}/api/images`;
        const gallery = await fetch(base);
        assert.equal(gallery.status, 403);
        const generation = await fetch(`${base}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: "A private image" })
        });
        assert.equal(generation.status, 403);
        assert.equal(generatedCalls.length, 1);
    } finally {
        await new Promise((resolve, reject) => memberServer.close(error =>
            error ? reject(error) : resolve()
        ));
    }
});

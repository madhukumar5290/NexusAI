"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "jarwis-knowledge-")
);
const originalEnvironment = {
    dataDir: process.env.NEXUS_DATA_DIR,
    database: process.env.NEXUS_DB_FILE,
    workspace: process.env.NEXUS_WORKSPACE,
    workspaces: process.env.NEXUS_WORKSPACES_DIR
};

process.env.NEXUS_DATA_DIR = path.join(temporaryDirectory, "data");
process.env.NEXUS_DB_FILE = path.join(temporaryDirectory, "nexus.db");
process.env.NEXUS_WORKSPACE = path.join(temporaryDirectory, "workspace");
process.env.NEXUS_WORKSPACES_DIR = path.join(temporaryDirectory, "workspaces");

const knowledge = require("../src/rag/knowledge");
const vectorStore = require("../src/rag/vectorStore");
const documentName = "notes.txt";

test.after(() => {
    vectorStore.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    for (const [key, value] of Object.entries({
        NEXUS_DATA_DIR: originalEnvironment.dataDir,
        NEXUS_DB_FILE: originalEnvironment.database,
        NEXUS_WORKSPACE: originalEnvironment.workspace,
        NEXUS_WORKSPACES_DIR: originalEnvironment.workspaces
    })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

test("failed document re-index keeps its previous file and searchable chunks", async () => {
    const embed = async () => [0.25, 0.75];
    await knowledge.ingestUpload({
        name: documentName,
        content: "Original durable content",
        encoding: "utf8",
        embed
    });

    const originalFile = fs.readFileSync(
        path.join(process.env.NEXUS_WORKSPACE, "knowledge", documentName),
        "utf8"
    );
    const originalChunks = vectorStore.getAllChunks()
        .filter(chunk => chunk.document_name === documentName);

    await assert.rejects(
        knowledge.ingestUpload({
            name: documentName,
            content: "Replacement that cannot be embedded",
            encoding: "utf8",
            embed: async () => {
                throw new Error("embedding service unavailable");
            }
        }),
        /embedding service unavailable/
    );

    assert.equal(
        fs.readFileSync(
            path.join(process.env.NEXUS_WORKSPACE, "knowledge", documentName),
            "utf8"
        ),
        originalFile
    );
    assert.deepEqual(
        vectorStore.getAllChunks()
            .filter(chunk => chunk.document_name === documentName),
        originalChunks
    );
});

test("failed document removal restores its saved file and leaves chunks intact", async () => {
    const originalChunks = vectorStore.getAllChunks()
        .filter(chunk => chunk.document_name === documentName);
    const clearDocument = vectorStore.clearDocument;
    vectorStore.clearDocument = () => {
        throw new Error("temporary database failure");
    };

    try {
        assert.throws(
            () => knowledge.deleteDocument(documentName),
            /temporary database failure/
        );
    } finally {
        vectorStore.clearDocument = clearDocument;
    }

    assert.equal(
        fs.readFileSync(
            path.join(process.env.NEXUS_WORKSPACE, "knowledge", documentName),
            "utf8"
        ),
        "Original durable content"
    );
    assert.deepEqual(
        vectorStore.getAllChunks()
            .filter(chunk => chunk.document_name === documentName),
        originalChunks
    );
});

"use strict";

const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const { readDocument } = require("./documentReader");
const { chunkText } = require("./chunker");
const { createEmbedding } = require("./embeddings");
const vectorStore = require("./vectorStore");
const workspaceTools = require("../agent/workspaceTools");

function safeDocumentName(name) {
    const base = path.basename(String(name || "").replace(/\\/g, "/")).trim();
    if (!base || base === "." || base === ".." || base.includes("\0")) {
        throw new Error("A valid document name is required.");
    }
    return base;
}

async function prepareIndex(filePath, documentName, embed = createEmbedding) {
    const text = await readDocument(filePath);
    if (!String(text || "").trim()) {
        throw new Error(`${documentName} did not contain readable text.`);
    }
    const chunks = chunkText(text);
    const indexedChunks = [];
    for (let index = 0; index < chunks.length; index += 1) {
        indexedChunks.push({
            content: chunks[index],
            embedding: await embed(chunks[index])
        });
    }
    return indexedChunks;
}

async function indexFile(filePath, documentName = path.basename(filePath), embed = createEmbedding) {
    const indexedChunks = await prepareIndex(filePath, documentName, embed);
    vectorStore.replaceDocument(documentName, indexedChunks);
    return { name: documentName, chunks: indexedChunks.length };
}

async function ingestUpload({ name, content, encoding = "base64", embed = createEmbedding }) {
    const documentName = safeDocumentName(name);
    const relativePath = `knowledge/${documentName}`;
    workspaceTools.ensureWorkspace();
    workspaceTools.resolveWorkspacePath(relativePath);
    if (encoding !== "base64" && encoding !== "utf8") {
        throw new Error("Document encoding must be base64 or utf8.");
    }
    const decoded = encoding === "utf8"
        ? Buffer.from(String(content || ""), "utf8")
        : Buffer.from(String(content || ""), "base64");
    if (!decoded.length) {
        throw new Error("The uploaded document is empty.");
    }
    if (decoded.length > 8 * 1024 * 1024) {
        throw new Error("Documents must be 8 MB or smaller.");
    }
    const absolute = workspaceTools.resolveWorkspacePath(relativePath);
    const directory = path.dirname(absolute);
    const extension = path.extname(documentName);
    const stem = path.basename(documentName, extension);
    const stagedPath = path.join(
        directory,
        `.${stem}.${randomUUID()}.tmp${extension}`
    );
    const backupPath = path.join(
        directory,
        `.${stem}.${randomUUID()}.bak${extension}`
    );
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(stagedPath, decoded, { flag: "wx" });

    let originalMoved = false;
    let uploadInstalled = false;
    try {
        const indexedChunks = await prepareIndex(stagedPath, documentName, embed);
        try {
            if (fs.existsSync(absolute)) {
                fs.renameSync(absolute, backupPath);
                originalMoved = true;
            }
            fs.renameSync(stagedPath, absolute);
            uploadInstalled = true;
            vectorStore.replaceDocument(documentName, indexedChunks);
        } catch (error) {
            const rollbackErrors = [];
            if (uploadInstalled) {
                try {
                    fs.unlinkSync(absolute);
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (originalMoved) {
                try {
                    fs.renameSync(backupPath, absolute);
                    originalMoved = false;
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (rollbackErrors.length) {
                throw new AggregateError(
                    [error, ...rollbackErrors],
                    `Could not safely replace ${documentName}; the previous file may remain at ${backupPath}.`
                );
            }
            throw error;
        }

        if (originalMoved) {
            try {
                fs.unlinkSync(backupPath);
                originalMoved = false;
            } catch (error) {
                console.warn(
                    `Document ${documentName} was indexed, but its previous-file backup could not be removed:`,
                    error.message
                );
            }
        }
        return { name: documentName, chunks: indexedChunks.length };
    } finally {
        if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
    }
}

function listDocuments() {
    return vectorStore.listDocuments();
}

function deleteDocument(name) {
    const documentName = safeDocumentName(name);
    const absolute = workspaceTools.resolveWorkspacePath(`knowledge/${documentName}`);
    const extension = path.extname(documentName);
    const stem = path.basename(documentName, extension);
    const backupPath = path.join(
        path.dirname(absolute),
        `.${stem}.${randomUUID()}.bak${extension}`
    );
    let originalMoved = false;
    try {
        if (fs.existsSync(absolute)) {
            if (!fs.lstatSync(absolute).isFile()) {
                throw new Error("The saved document path is not a regular file.");
            }
            fs.renameSync(absolute, backupPath);
            originalMoved = true;
        }
        vectorStore.clearDocument(documentName);
    } catch (error) {
        if (originalMoved) {
            try {
                fs.renameSync(backupPath, absolute);
                originalMoved = false;
            } catch (rollbackError) {
                throw new AggregateError(
                    [error, rollbackError],
                    `Could not remove ${documentName} or restore its saved file from ${backupPath}.`
                );
            }
        }
        throw error;
    }
    if (originalMoved) {
        try {
            fs.unlinkSync(backupPath);
        } catch (error) {
            console.warn(
                `Document ${documentName} was removed from the index, but its saved-file backup could not be removed:`,
                error.message
            );
        }
    }
    return { name: documentName, removed: true };
}

module.exports = {
    indexFile,
    ingestUpload,
    listDocuments,
    deleteDocument,
    safeDocumentName
};

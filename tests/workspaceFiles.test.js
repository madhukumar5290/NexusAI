"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const previousWorkspace = process.env.NEXUS_WORKSPACE;
const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-workspace-files-"));
process.env.NEXUS_WORKSPACE = workspaceRoot;

const workspaceTools = require("../src/agent/workspaceTools");

test.after(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    if (previousWorkspace === undefined) delete process.env.NEXUS_WORKSPACE;
    else process.env.NEXUS_WORKSPACE = previousWorkspace;
});

test("workspace tree includes stable relative paths for nested files", () => {
    workspaceTools.createFile("projects/sample/notes/readme.txt", "workspace test");

    const tree = workspaceTools.getWorkspaceTree().tree;
    const project = tree.find(entry => entry.name === "projects");
    const sample = project.children.find(entry => entry.name === "sample");
    const notes = sample.children.find(entry => entry.name === "notes");
    const file = notes.children[0];

    assert.equal(project.path, "projects");
    assert.equal(sample.path, "projects/sample");
    assert.equal(notes.path, "projects/sample/notes");
    assert.equal(file.path, "projects/sample/notes/readme.txt");
    assert.equal(file.type, "file");
});

test("workspace path resolution blocks symbolic links outside the workspace", t => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-workspace-outside-"));
    const linkPath = path.join(workspaceRoot, "outside-link");
    t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));

    try {
        fs.symlinkSync(
            outsideRoot,
            linkPath,
            process.platform === "win32" ? "junction" : "dir"
        );
    } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
            t.skip(`symbolic links are unavailable: ${error.code}`);
            return;
        }
        throw error;
    }

    assert.throws(
        () => workspaceTools.resolveWorkspacePath("outside-link/escape.txt"),
        /resolves outside the Nexus workspace/
    );
    assert.throws(
        () => workspaceTools.createFile("outside-link/escape.txt", "blocked"),
        /resolves outside the Nexus workspace/
    );
    assert.equal(fs.existsSync(path.join(outsideRoot, "escape.txt")), false);
});

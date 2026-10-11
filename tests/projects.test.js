const test = require("node:test");
const assert = require("node:assert");

/*
These tests exercise deleteProject's containment guard.
We can't require lib/store/projects.js directly (it opens a DB),
so we replicate the guard condition and verify it against paths.
*/

const path = require("path");

function isInsideWorkspacesDir(projectRoot, workspacesDir) {
    const rel = path.relative(workspacesDir, projectRoot);
    return (
        projectRoot !== workspacesDir &&
        !rel.startsWith("..") &&
        !path.isAbsolute(rel)
    );
}

const WORKSPACES_DIR = "C:\\NexusAI\\workspaces";

test("deleteProject guard: child workspace is inside", () => {
    assert.strictEqual(
        isInsideWorkspacesDir(
            path.join(WORKSPACES_DIR, "my-project"),
            WORKSPACES_DIR
        ),
        true
    );
});

test("deleteProject guard: workspaces root itself is rejected", () => {
    assert.strictEqual(
        isInsideWorkspacesDir(WORKSPACES_DIR, WORKSPACES_DIR),
        false
    );
});

test("deleteProject guard: sibling directory is rejected", () => {
    assert.strictEqual(
        isInsideWorkspacesDir("C:\\NexusAI\\sibling", WORKSPACES_DIR),
        false
    );
});

test("deleteProject guard: parent directory is rejected", () => {
    assert.strictEqual(
        isInsideWorkspacesDir("C:\\NexusAI", WORKSPACES_DIR),
        false
    );
});

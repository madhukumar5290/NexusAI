const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const gitTool = require("../src/agent/gitTool");
const terminalTool = require("../src/agent/terminalTool");
const permissions = require("../src/agent/permissions");
const gitAvailable = spawnSync("git", ["--version"], {
    stdio: "ignore",
    shell: false
}).status === 0;
const gitIntegrationOptions = gitAvailable
    ? {}
    : { skip: "Git CLI is not installed or is not available on PATH." };

/* Use a temp repo so we never touch a real project's git history. */
const REPO = path.join(
    os.tmpdir(),
    "nexus-git-test-" + Date.now()
);

function sh(args) {
    const { execSync } = require("child_process");

    execSync(
        ["git", ...args].join(" "),
        {
            cwd: REPO,
            stdio: "pipe",
            shell: true,

            env: {
                ...process.env,

                GIT_AUTHOR_NAME: "Test",

                GIT_AUTHOR_EMAIL:
                    "test@test.local",

                GIT_COMMITTER_NAME: "Test",

                GIT_COMMITTER_EMAIL:
                    "test@test.local"
            }
        }
    );
}

test("setup: temp repo with one commit", gitIntegrationOptions, () => {
    permissions.grant("EXECUTE");
    permissions.grant("READ");
    permissions.grant("GIT");

    fs.mkdirSync(REPO, {
        recursive: true
    });

    process.env.NEXUS_WORKSPACE = REPO;

    sh(["init"]);

    fs.writeFileSync(
        path.join(REPO, "a.txt"),
        "hello"
    );

    sh(["add", "."]);

    sh(["commit", "-m", "init"]);
});

test("isRepository detects a git repo", gitIntegrationOptions, async () => {
    const check = await gitTool.isRepository();

    assert.strictEqual(check.ok, true);

    assert.strictEqual(
        check.isRepo,
        true
    );
});

test("getStatus reports branch and changed files", gitIntegrationOptions, async () => {
    fs.writeFileSync(
        path.join(REPO, "a.txt"),
        "changed"
    );

    const status = await gitTool.getStatus();

    assert.strictEqual(status.ok, true);

    assert.ok(
        status.branch.length > 0
    );

    assert.ok(
        status.files.some(
            file =>
                file.includes("a.txt")
        )
    );
});

test("getDiff returns diff text", gitIntegrationOptions, async () => {
    const diff = await gitTool.getDiff();

    assert.strictEqual(diff.ok, true);

    assert.ok(
        diff.diff.includes("a.txt")
    );
});

test("stageAll + commit creates a commit", gitIntegrationOptions, async () => {
    await gitTool.stageAll();

    const result = await gitTool.commit(
        "test commit"
    );

    assert.strictEqual(result.ok, true);

    const log = await gitTool.getLog(5);

    assert.strictEqual(log.ok, true);

    assert.ok(
        log.commits[0].includes(
            "test commit"
        )
    );
});

test("commit rejects empty message", async () => {
    await assert.rejects(
        () => gitTool.commit("   "),
        /message/i
    );
});

test("validateGitArgs blocks destructive subcommands and flags", () => {
    assert.throws(
        () => gitTool.validateGitArgs("reset", ["--hard"]),
        /Blocked destructive/
    );

    assert.throws(
        () => gitTool.validateGitArgs("clean", ["-d"]),
        /Blocked destructive/
    );

    assert.throws(
        () => gitTool.validateGitArgs("checkout", ["--force", "main"]),
        /flag not allowed/i
    );

    assert.throws(
        () => gitTool.validateGitArgs("bogus", []),
        /not allowed/
    );
});

test("git runs are recorded in the terminal log", async () => {
    permissions.grant("EXECUTE");
    permissions.grant("GIT");
    await gitTool.getStatus();

    const log = terminalTool.getRunLog(10);

    assert.ok(
        log.some(
            entry =>
                entry.command === "git" &&
                entry.args[0] === "status"
        )
    );
});

test("cleanup: remove temp repo", () => {
    fs.rmSync(REPO, {
        recursive: true,
        force: true
    });

    delete process.env.NEXUS_WORKSPACE;
});

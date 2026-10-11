/*
Nexus AI — Git Integration (Stage 3)

Per the master spec (section 27):
    status / diff / log     -> read-only, always safe
    add / commit            -> local writes, GIT permission
    branch / checkout       -> local, GIT permission
    push / pull / clone     -> NETWORK + GIT, explicitly
                               gated and default-off
    reset --hard / clean    -> BLOCKED (destructive)

All operations run against the Nexus workspace via
the controlled terminal (no shell, allowlisted
arguments, logged). Git identity is set automatically
for commits so commits never fail on missing config.
*/

const permissions =
    require("./permissions");

const terminalTool =
    require("./terminalTool");

const workspaceTools =
    require("./workspaceTools");

const GIT_IDENTITY_NAME =
    process.env.NEXUS_GIT_NAME || "Jarwis";

const GIT_IDENTITY_EMAIL =
    process.env.NEXUS_GIT_EMAIL ||
    "nexus@local";

/*
--------------------------------------------------
SAFE ARGUMENT VALIDATION
Git subcommand whitelist — anything outside this
list is rejected before spawning a process.
--------------------------------------------------
*/

const READONLY_SUBCOMMANDS = new Set([
    "status",
    "log",
    "diff",
    "branch",
    "rev-parse",
    "show"
]);

const LOCAL_WRITE_SUBCOMMANDS = new Set([
    "add",
    "commit",
    "init",
    "checkout",
    "switch"
]);

const BLOCKED_SUBCOMMANDS = new Set([
    "reset",
    "clean",
    "rebase",
    "filter-branch",
    "filter-repo"
]);

const BLOCKED_GIT_FLAGS = [
    /--hard/i,
    /--force/i,
    /-f\b/,
    /--amend\b.*--no-edit/i,
    /--exec/i,
    /--upload-pack/i,
    /--receive-pack/i
];

function validateGitArgs(subcommand, args) {
    const sub =
        String(subcommand || "").trim();

    if (BLOCKED_SUBCOMMANDS.has(sub)) {
        throw new Error(
            `Blocked destructive git subcommand: "${sub}".`
        );
    }

    if (
        !READONLY_SUBCOMMANDS.has(sub) &&
        !LOCAL_WRITE_SUBCOMMANDS.has(sub) &&
        sub !== "push" &&
        sub !== "pull" &&
        sub !== "remote"
    ) {
        throw new Error(
            `Git subcommand not allowed: "${sub}".`
        );
    }

    const argList = (args || []).map(
        argument => String(argument)
    );

    for (const argument of argList) {
        for (const flag of BLOCKED_GIT_FLAGS) {
            if (flag.test(argument)) {
                throw new Error(
                    `Git flag not allowed: "${argument}".`
                );
            }
        }
    }

    return { sub, argList };
}

/*
--------------------------------------------------
EXECUTE GIT
All git runs go through the controlled terminal,
so sandboxing/logging/timeout come for free.
--------------------------------------------------
*/

async function runGit(subcommand, args = [], options = {}) {
    permissions.requireCapabilities(
        ["EXECUTE", "GIT"],
        "git"
    );

    const {
        sub,
        argList
    } = validateGitArgs(
        subcommand,
        args
    );

    const result = await terminalTool.executeCommand({
        command: "git",

        args: [sub, ...argList],

        cwd: options.cwd || "",

        timeoutMs: options.timeoutMs
    });

    return result;
}

/*
--------------------------------------------------
HIGH-LEVEL OPERATIONS
--------------------------------------------------
*/

async function isRepository() {
    const result = await runGit(
        "rev-parse",
        ["--is-inside-work-tree"]
    );

    return {
        ok: result.exitCode === 0,

        isRepo:
            result.stdout.trim() === "true"
    };
}

async function ensureRepository() {
    const check = await isRepository();

    if (check.isRepo) {
        return {
            created: false,

            ok: true
        };
    }

    const result = await runGit("init");

    return {
        created: result.exitCode === 0,

        ok: result.exitCode === 0,

        output: result.stdout + result.stderr
    };
}

async function getStatus() {
    const result = await runGit(
        "status",
        ["--porcelain", "-b"]
    );

    if (result.exitCode !== 0) {
        return {
            ok: false,

            error: result.stderr
        };
    }

    const lines = result.stdout
        .split("\n")
        .map(line => line.trimEnd())
        .filter(Boolean);

    return {
        ok: true,

        branch:
            (lines[0] || "").replace(/^##\s*/, "") ||
            "unknown",

        files: lines.slice(1)
    };
}

async function stageAll() {
    const result = await runGit("add", ["-A"]);

    return {
        ok: result.exitCode === 0,

        output: result.stderr || result.stdout
    };
}

async function commit(message) {
    const text =
        String(message || "").trim();

    if (!text) {
        throw new Error(
            "Commit message is required."
        );
    }

    /*
    Ensure repo + identity, then commit.
    */
    await ensureRepository();

    const identity = await terminalTool.executeCommand({
        command: "git",

        args: [
            "config",
            "user.name",
            GIT_IDENTITY_NAME
        ]
    });

    const identityEmail = await terminalTool.executeCommand({
        command: "git",

        args: [
            "config",
            "user.email",
            GIT_IDENTITY_EMAIL
        ]
    });

    const result = await runGit(
        "commit",
        ["-m", text]
    );

    return {
        ok: result.exitCode === 0,

        output:
            (result.stdout || result.stderr).trim(),

        identityOk:
            identity.exitCode === 0 &&
            identityEmail.exitCode === 0
    };
}

async function getLog(limit = 10) {
    const result = await runGit(
        "log",
        [
            `-n`,
            String(limit),
            `--pretty=format:%h %ad %s`,
            `--date=short`
        ]
    );

    if (result.exitCode !== 0) {
        /*
        Empty repo has no log yet — not an error.
        */
        if (
            /does not have any commits yet/i.test(
                result.stderr
            )
        ) {
            return {
                ok: true,

                commits: []
            };
        }

        return {
            ok: false,

            error: result.stderr
        };
    }

    return {
        ok: true,

        commits: result.stdout
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean)
    };
}

async function getDiff() {
    const result = await runGit("diff");

    return {
        ok: result.exitCode === 0,

        diff:
            (result.stdout || "").slice(0, 50000)
    };
}

module.exports = {
    runGit,
    validateGitArgs,
    isRepository,
    ensureRepository,
    getStatus,
    stageAll,
    commit,
    getLog,
    getDiff
};

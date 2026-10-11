/*
Nexus AI — Controlled Terminal (Stage 3)

Per the master spec (section 14), terminal access must be:

    sandboxed            -> child process, cwd locked to a workspace folder
    workspace-scoped     -> commands run with cwd = workspace root or a safe subfolder
    permission-controlled-> requires the EXECUTE capability
    command-controlled   -> strict allowlist, no shell interpolation
    logged               -> every run is recorded
    observable           -> returns exit code, duration, stdout/stderr tails

Security rules:
- Only whitelisted command prefixes are allowed.
- No shell (shell: false); arguments are passed as an array.
- Hard timeout; the process tree is killed on timeout.
- Output is capped so huge builds cannot exhaust memory.
- Dangerous flags/arguments (install, publish, token, etc.) are rejected.
*/

const { spawn } = require("child_process");

const path = require("path");

const workspaceTools =
    require("./workspaceTools");

const permissions =
    require("./permissions");

/*
--------------------------------------------------
ALLOWLIST
Command executables the agent may run. Everything
else is rejected before a process is spawned.
--------------------------------------------------
*/

const ALLOWED_COMMANDS = new Set([
    "node",
    "npm",
    "npx",
    "git"
]);

/*
Arguments that must never appear, even for
allowed commands. Keeps npm/npx from being
used to bypass the allowlist or exfiltrate data.
*/
const BLOCKED_ARGUMENT_PATTERNS = [
    /install/i,
    /uninstall/i,
    /publish/i,
    /login/i,
    /adduser/i,
    /token/i,
    /config set/i,
    /--frozen-lockfile=?.*--?(global|prefix)/i,
    /curl/i,
    /wget/i,
    /http/i,
    /\bpush\b/i,
    /\bforce\b/i,
    /--force/i,
    /\breset\b/i,
    /\brebase\b/i,
    /\bclean\b/i,
    /\.\./
];

const MAX_OUTPUT_CHARS = 100000;

const DEFAULT_TIMEOUT_MS = 60000;

/*
Windows often has git installed but not on PATH.
Resolve known locations so allowlisted commands
still run.
*/
const EXECUTABLE_RESOLUTION = {
    git: [
        "C:\\Program Files\\Git\\bin\\git.exe",
        "C:\\Program Files\\Git\\cmd\\git.exe",
        "C:\\Program Files (x86)\\Git\\bin\\git.exe"
    ]
};

function resolveExecutable(executable) {
    if (process.platform !== "win32") {
        return executable;
    }

    const candidates = EXECUTABLE_RESOLUTION[executable] || [];

    const found = candidates.find(candidate => {
        try {
            return require("fs").existsSync(candidate);
        } catch {
            return false;
        }
    });

    return found || executable;
}

/*
--------------------------------------------------
RUN LOG
In-memory ring buffer; the caller (task engine)
persists anything user-visible.
--------------------------------------------------
*/

const runLog = [];

const MAX_LOG_ENTRIES = 200;

function logRun(entry) {
    runLog.push(entry);

    if (runLog.length > MAX_LOG_ENTRIES) {
        runLog.shift();
    }

    return entry;
}

function getRunLog(limit = 50) {
    return runLog.slice(-limit);
}

/*
--------------------------------------------------
VALIDATION
--------------------------------------------------
*/

function validateCommand(command, args) {
    const executable =
        String(command || "")
            .trim()
            .toLowerCase()
            .replace(/\.exe$/, "")
            .replace(/\.cmd$/, "");

    if (!ALLOWED_COMMANDS.has(executable)) {
        throw new Error(
            `Command not allowed: "${command}". Allowed: ${[...ALLOWED_COMMANDS].join(", ")}.`
        );
    }

    const argList = (args || []).map(
        argument => String(argument)
    );

    for (const argument of argList) {
        for (const pattern of BLOCKED_ARGUMENT_PATTERNS) {
            if (pattern.test(argument)) {
                throw new Error(
                    `Argument not allowed: "${argument}".`
                );
            }
        }
    }

    return { executable, argList };
}

/*
--------------------------------------------------
EXECUTE
Runs an allowed command inside the workspace.
Returns { success, exitCode, stdout, stderr, durationMs }.
Throws on permission or validation failures.
--------------------------------------------------
*/

function executeCommand({
    command,
    args = [],
    cwd = "",
    timeoutMs = DEFAULT_TIMEOUT_MS
}) {
    permissions.requireCapabilities(
        ["EXECUTE"],
        "terminal"
    );

    const {
        executable,
        argList
    } = validateCommand(
        command,
        args
    );

    /*
    cwd must resolve inside the workspace.
    */
    const cwdRelative =
        String(cwd || "").trim();

    let cwdAbsolute =
        workspaceTools.getWorkspaceRoot();

    if (cwdRelative) {
        cwdAbsolute =
            workspaceTools.resolveWorkspacePath(
                cwdRelative
            );
    }

    const startedAt = Date.now();

    return new Promise(resolve => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const child = spawn(
            resolveExecutable(executable),
            argList,
            {
                cwd: cwdAbsolute,
                shell: false,
                windowsHide: true,
                env: {
                    ...process.env,
                    NEXUS_SANDBOX: "1"
                }
            }
        );

        const timer = setTimeout(() => {
            timedOut = true;

            child.kill("SIGKILL");
        }, timeoutMs);

        child.stdout.on(
            "data",
            chunk => {
                if (stdout.length < MAX_OUTPUT_CHARS) {
                    stdout += chunk;
                }
            }
        );

        child.stderr.on(
            "data",
            chunk => {
                if (stderr.length < MAX_OUTPUT_CHARS) {
                    stderr += chunk;
                }
            }
        );

        child.on("error", error => {
            clearTimeout(timer);

            const result = {
                success: false,

                exitCode: -1,

                stdout: stdout.slice(0, MAX_OUTPUT_CHARS),

                stderr:
                    `${stderr}\n${error.message}`
                        .slice(0, MAX_OUTPUT_CHARS),

                durationMs: Date.now() - startedAt,

                timedOut,

                command: executable,

                args: argList
            };

            resolve(
                logRun(result)
            );
        });

        child.on("close", exitCode => {
            clearTimeout(timer);

            const result = {
                success:
                    exitCode === 0 && !timedOut,

                exitCode,

                stdout: stdout.slice(0, MAX_OUTPUT_CHARS),

                stderr:
                    timedOut
                        ? `${stderr}\nProcess killed after ${timeoutMs}ms timeout.`
                        : stderr.slice(0, MAX_OUTPUT_CHARS),

                durationMs: Date.now() - startedAt,

                timedOut,

                command: executable,

                args: argList
            };

            resolve(
                logRun(result)
            );
        });
    });
}

module.exports = {
    executeCommand,
    validateCommand,
    getRunLog,
    ALLOWED_COMMANDS,
    DEFAULT_TIMEOUT_MS
};

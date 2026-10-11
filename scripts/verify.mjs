/**
 * Nexus verification runner.
 *
 * Runs every check in one command and reports a single verdict:
 *
 *   1. unit tests        (node:test)
 *   2. agent integrity   (every agent names only registered tools)
 *   3. UI smoke          (real controls produce observable effects)
 *   4. stream render     (NDJSON events reach the DOM)
 *   5. api surface       (every endpoint answers without a server crash)
 *   6. subsystem smoke   (modules load, providers reachable)
 *   7. responsive        (layout at mobile/tablet/desktop widths)
 *
 * Unless NEXUS_URL explicitly targets another instance, the runner
 * starts an isolated server with temporary database and workspace
 * directories. It never reuses the user's running app or its data.
 *
 * Usage:
 *   node scripts/verify.mjs             # everything except browsers
 *   node scripts/verify.mjs --browsers  # include Firefox/WebKit
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(process.argv[1], "..", "..");
const EXTERNAL_BASE = process.env.NEXUS_URL || null;
let PORT = Number(process.env.NEXUS_PORT) || null;
let BASE = EXTERNAL_BASE || "";

const WITH_BROWSERS = process.argv.includes("--browsers");
const UNIT_TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "nexus-verify-tests-"));
const APP_TEST_DATA_DIR = EXTERNAL_BASE
    ? null
    : mkdtempSync(join(tmpdir(), "nexus-verify-app-"));

/* ------------------------------------------------------------------
   SERVER LIFECYCLE
   ------------------------------------------------------------------ */

function portInUse(port) {
    return new Promise(resolvePromise => {
        const socket = createServer();
        socket.once("error", () => resolvePromise(true));
        socket.once("listening", () => socket.close(() => resolvePromise(false)));
        socket.listen(port, "127.0.0.1");
    });
}

function findAvailablePort() {
    return new Promise((resolvePromise, reject) => {
        const socket = createServer();
        socket.once("error", reject);
        socket.listen(0, "127.0.0.1", () => {
            const address = socket.address();
            socket.close(error => {
                if (error) reject(error);
                else resolvePromise(address.port);
            });
        });
    });
}

async function waitForServer(timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 1500);
            let response;
            try {
                response = await fetch(BASE + "api/health", { signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
            if (response.ok) return true;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 400));
    }
    return false;
}

let serverProcess = null;

async function ensureServer() {
    if (EXTERNAL_BASE) {
        console.log(`server      using explicitly configured URL ${EXTERNAL_BASE}`);
        return waitForServer();
    }

    if (!PORT) PORT = await findAvailablePort();
    if (await portInUse(PORT)) {
        console.log(
            `server      port ${PORT} is already in use; refusing to run checks against an existing app. ` +
            "Choose a free NEXUS_PORT or explicitly set NEXUS_URL to opt in."
        );
        return false;
    }

    console.log(`server      starting on port ${PORT}...`);
    serverProcess = spawn(process.execPath, ["src/server.js"], {
        cwd: ROOT,
        env: {
            ...process.env,
            NEXUS_PORT: String(PORT),
            NEXUS_HOST: "127.0.0.1",
            NEXUS_DATA_DIR: join(APP_TEST_DATA_DIR, "data"),
            NEXUS_DB_FILE: join(APP_TEST_DATA_DIR, "nexus.db"),
            NEXUS_WORKSPACE: join(APP_TEST_DATA_DIR, "workspace"),
            NEXUS_WORKSPACES_DIR: join(APP_TEST_DATA_DIR, "workspaces")
        },
        stdio: "ignore",
        detached: false
    });
    BASE = `http://127.0.0.1:${PORT}/`;

    const ready = await waitForServer();
    if (!ready) {
        console.log("server      FAILED to start");
        return false;
    }
    console.log("server      ready");
    return true;
}

function waitForExit(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve(true);
    }

    return new Promise(resolvePromise => {
        const onExit = () => {
            clearTimeout(timer);
            resolvePromise(true);
        };
        const timer = setTimeout(() => {
            child.removeListener("exit", onExit);
            resolvePromise(false);
        }, timeoutMs);
        child.once("exit", onExit);
    });
}

async function stopServer() {
    const child = serverProcess;
    serverProcess = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    const exited = waitForExit(child, 5000);
    child.kill();
    if (await exited) return;

    const forceExited = waitForExit(child, 5000);
    child.kill("SIGKILL");
    if (!await forceExited) {
        throw new Error("The isolated verification server did not stop; leaving its temporary files in place.");
    }
}

/* ------------------------------------------------------------------
   CHECK RUNNERS
   ------------------------------------------------------------------ */

const results = [];

function runNode(
    check,
    command,
    args,
    timeoutMs = 600000,
    env = { ...process.env, NEXUS_URL: BASE }
) {
    const started = Date.now();

    /*
    No shell. On Windows a shell splits the quoted interpreter path
    ("C:\Program Files\nodejs\node.exe") at the space and the command
    never runs. spawnSync passes argv directly when shell is false.
    Glob patterns are expanded by the test runner itself, not the shell.
    */
    const proc = spawnSync(command, args, {
        cwd: ROOT,
        encoding: "utf8",
        shell: false,
        timeout: timeoutMs,
        env
    });

    const output = String(proc.stdout || "") + String(proc.stderr || "");
    const ok = proc.status === 0;

    /*
    Pull the most informative line from the output. Each check prints
    a labelled verdict line near the end, so look for that first and
    fall back to the last non-empty line.
    */
    let summary = "";

    if (check === "unit tests") {
        const pass = output.match(/# pass (\d+)/);
        const fail = output.match(/# fail (\d+)/);
        summary = `${pass ? pass[1] : "?"} pass, ${fail ? fail[1] : "?"} fail`;
    } else {
        const verdict = output
            .split("\n")
            .map(line => line.trim())
            .filter(line =>
                /^(RESPONSIVE|UI SMOKE|STREAM RENDER|OK:)/.test(line)
            )
            .pop();

        const fallback = output.trim().split("\n").filter(Boolean).pop() || "";
        summary = (verdict || fallback).slice(0, 110);
    }

    results.push({ check, ok, summary, ms: Date.now() - started });
    console.log(`[${ok ? "PASS" : "FAIL"}] ${check.padEnd(16)} ${summary}`);

    if (!ok) {
        const tail = output.trim().split("\n").slice(-40).join("\n");
        console.log(tail.split("\n").map(l => "        " + l).join("\n"));
    }

    return ok;
}

/* ------------------------------------------------------------------
   MAIN
   ------------------------------------------------------------------ */

console.log("Nexus verification\n" + "=".repeat(52));

const started = await ensureServer();

if (!started) {
    console.log("\nCannot verify: the server is not reachable at " + BASE);
    console.log("Choose an available test port or check the explicitly configured URL.");
    await stopServer();
    rmSync(UNIT_TEST_DATA_DIR, { recursive: true, force: true });
    if (APP_TEST_DATA_DIR) rmSync(APP_TEST_DATA_DIR, { recursive: true, force: true });
    process.exit(1);
}

/*
1. Unit tests.

The file list is built here rather than by a shell, because a shell
would split the interpreter path on Windows. Listing the files
explicitly also works on every Node version, unlike glob patterns.
*/
const testFiles = readdirSync(resolve(ROOT, "tests"))
    .filter(name => name.endsWith(".test.js"))
    .map(name => join("tests", name));

const unitTestEnvironment = {
    ...process.env,
    NEXUS_DATA_DIR: join(UNIT_TEST_DATA_DIR, "data"),
    NEXUS_DB_FILE: join(UNIT_TEST_DATA_DIR, "nexus.db")
};
delete unitTestEnvironment.NEXUS_WORKSPACE;
delete unitTestEnvironment.NEXUS_WORKSPACES_DIR;
runNode(
    "unit tests",
    process.execPath,
    ["--test", ...testFiles],
    600000,
    unitTestEnvironment
);

/* 2. Agent integrity: every agent names only registered tools. */
runNode("agents", process.execPath, ["scripts/check-agents.js"]);

/* 3. UI smoke: controls produce observable effects. */
runNode("ui smoke", process.execPath, ["scripts/ui-smoke.mjs"]);

/* 4. Stream render: NDJSON events reach the DOM. */
runNode("stream render", process.execPath, ["scripts/stream-render.mjs"]);

/* 5. API surface: every endpoint answers without a server crash. */
runNode("api surface", process.execPath, ["scripts/api-surface.mjs"]);

/* 6. Subsystem smoke: modules load and providers are reachable. */
runNode("subsystems", process.execPath, ["scripts/check.js"]);

/* 7. Responsive layout. Optionally includes other engines. */
if (WITH_BROWSERS) {
    runNode("responsive", process.execPath, ["scripts/cross-browser.mjs"]);
} else {
    results.push({
        check: "responsive",
        ok: true,
        summary: "skipped (pass --browsers to include)",
        ms: 0
    });
    console.log("[SKIP] responsive       pass --browsers to include");
}

await stopServer();
rmSync(UNIT_TEST_DATA_DIR, { recursive: true, force: true });
if (APP_TEST_DATA_DIR) rmSync(APP_TEST_DATA_DIR, { recursive: true, force: true });

/* ------------------------------------------------------------------
   VERDICT
   ------------------------------------------------------------------ */

const failed = results.filter(r => !r.ok);
const totalMs = results.reduce((sum, r) => sum + r.ms, 0);

console.log("\n" + "=".repeat(52));
console.log(
    `${results.length - failed.length}/${results.length} checks passed` +
    ` in ${(totalMs / 1000).toFixed(1)}s`
);

if (failed.length) {
    console.log("\nFailed: " + failed.map(r => r.check).join(", "));
    process.exit(1);
}

console.log("ALL CHECKS PASSED");
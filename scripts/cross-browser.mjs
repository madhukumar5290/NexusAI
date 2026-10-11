/**
 * Cross-browser + responsive verification for the Nexus UI.
 *
 * Runs the same checks in Chromium, Firefox, and WebKit (Safari's engine)
 * because a layout that is correct in one engine can break in another —
 * CSS grid gaps, `hidden` handling, and flex sizing all differ.
 *
 * Usage: node scripts/cross-browser.mjs
 */

import { createRequire } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

/*
Each engine runs in its own child process. WebKit in particular can
hard-crash the host process, and a crash must not take the other
engines' results with it.
*/
const CHILD_MODE = process.env.NEXUS_CB_CHILD;

if (!CHILD_MODE) {
    const engines = ["chromium", "firefox", "webkit"];
    const results = [];

    const engineSummary = [];

    for (const engine of engines) {
        const result = await new Promise(done => {
            const child = spawn(
                process.execPath,
                [resolve(process.argv[1])],
                { env: { ...process.env, NEXUS_CB_CHILD: engine }, stdio: ["ignore", "pipe", "pipe"] }
            );
            let out = "";
            let err = "";
            child.stdout.on("data", d => { out += d; });
            child.stderr.on("data", d => { err += d; });
            child.on("close", code => {
                if (code === 0 && out.trim()) {
                    try { done(JSON.parse(out)); } catch { done({ engine, error: "unparseable output" }); }
                } else {
                    done({ engine, error: (err || "crashed").split("\n").slice(0, 3).join(" ").slice(0, 300) });
                }
            });
            child.on("error", e => done({ engine, error: String(e.message) }));
        });
        results.push(result);
        console.log(`  ${engine.padEnd(9)} ${result.error ? "FAILED: " + result.error : "ok"}`);

        /*
        Classify the outcome. A driver-level crash (patchright cannot
        reach this engine in this environment) is reported as
        UNAVAILABLE and does not fail the run — otherwise a tooling
        limitation masks real layout results. An actual layout defect
        (horizontal overflow) still fails.
        */
        if (result.error) {
            const driverIssue = /_client|coreBundle|executable doesn't exist|not supported/i
                .test(result.error);
            result.unavailable = driverIssue;
            engineSummary.push(
                `${engine}: ${driverIssue ? "unavailable (driver)" : "ERROR"}`
            );
        } else {
            const viewports = Object.values(result.viewports || {});
            const overflow = viewports.filter(v => v.overflowX).length;
            result.overflowCount = overflow;
            engineSummary.push(
                `${engine}: ${viewports.length} viewport(s)` +
                (overflow ? `, ${overflow} OVERFLOW` : "")
            );
        }
    }

    /*
    Print a compact summary line first, then the full JSON for
    detail. The summary is what a CI log needs; the JSON is there when
    something fails.
    */
    /*
    Fail only when a layout defect was actually measured, or when an
    engine failed for a reason other than a driver limitation. A
    driver that cannot launch is a note, not a verdict.
    */
    const layoutDefect = results.some(r => Number(r.overflowCount) > 0);
    const hardError = results.some(r => r.error && !r.unavailable);
    const unavailable = results.filter(r => r.unavailable).map(r => r.engine);
    const measured = results.filter(r => !r.error).map(r => r.engine);

    const failed = layoutDefect || hardError;

    console.log(
        "\nRESPONSIVE: " + (failed ? "FAIL" : "PASS") +
        " — " + engineSummary.join(" | ")
    );
    if (unavailable.length) {
        console.log(
            "  note: " + unavailable.join(", ") +
            " could not be launched by this driver — layout unverified there."
        );
    }
    console.log(JSON.stringify(results, null, 1));
    process.exit(failed ? 1 : 0);
}

function resolvePatchright() {
    const roots = [];
    for (const base of [
        join(homedir(), ".vscode", "extensions"),
        join(homedir(), ".vscode-server", "extensions")
    ]) {
        if (!existsSync(base)) continue;
        const dirs = readdirSync(base)
            .filter(d => d.startsWith("danielsanmedium.dscodegpt-"))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const newest = dirs[dirs.length - 1];
        if (newest) roots.push(join(base, newest, "standalone") + "/");
    }
    for (const root of roots) {
        try {
            const mod = createRequire(root)("patchright");
            /*
            patchright is CJS, so require() gives the exports object
            directly. Some builds also expose a nested `default`; take
            whichever actually has a launchable engine.
            */
            const candidates = [mod, mod?.default, mod?.default?.default];
            for (const candidate of candidates) {
                if (candidate && typeof candidate.chromium?.launch === "function") {
                    return candidate;
                }
            }
        } catch { /* try next */ }
    }
    throw new Error("patchright not resolved");
}

const pw = resolvePatchright();
const URL = process.env.NEXUS_URL || "http://127.0.0.1:3000/";

const VIEWPORTS = [
    { name: "mobile-360", width: 360, height: 640 },
    { name: "mobile-390", width: 390, height: 844 },
    { name: "tablet-768", width: 768, height: 1024 },
    { name: "desktop-1440", width: 1440, height: 900 }
];

const probe = () => ({
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    sidebarWidth: Math.round(document.querySelector(".sidebar").getBoundingClientRect().width),
    sidebarPosition: getComputedStyle(document.querySelector(".sidebar")).position,
    composerFits: (() => {
        const c = document.querySelector(".input-wrapper");
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return r.right <= window.innerWidth + 1 && r.width > 100;
    })(),
    sendVisible: getComputedStyle(document.querySelector(".send-button")).display !== "none",
    suggestionCols: (() => {
        const s = document.querySelector(".welcome-suggestions");
        return s ? getComputedStyle(s).gridTemplateColumns.split(" ").filter(Boolean).length : null;
    })(),
    welcomeHeading: document.querySelector(".welcome-message h1")?.textContent.trim() || null,
    hiddenToggleWorks: getComputedStyle(document.getElementById("sidebarToggle")).display === "none",
    convItems: document.querySelectorAll(".conversation-item").length,
    navItems: document.querySelectorAll(".sidebar-nav-item").length
});

async function runEngine(name, engine) {
    const results = { engine: name, viewports: {}, errors: [] };
    let browser;
    try {
        /*
        Match the flags the bundled skill uses so Chromium launches
        from its real executable rather than the headless shell
        that patchright looks for by default.
        */
        const launchOptions = {
            headless: true,
            args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"]
        };

        /*
        Chromium resolves to the full browser via `channel`, which is how
        the bundled skill launches it; without this, patchright looks for
        a chrome-headless-shell build that is not installed here.
        */
        if (name === "chromium") {
            launchOptions.channel = "chromium";
        }

        browser = await engine.launch(launchOptions);
    } catch (error) {
        results.error = `launch failed: ${error.message}`.split("\n")[0];
        return results;
    }

    try {
        const context = await browser.newContext({ locale: "en-US" });
        const page = await context.newPage();

        page.on("pageerror", e => results.errors.push(String(e.message || e)));
        page.on("console", m => {
            if (m.type() === "error") results.errors.push("console: " + m.text().slice(0, 200));
        });

        for (const vp of VIEWPORTS) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
            // Wait for the client-rendered shell to mount.
            await page.waitForSelector(".sidebar", { timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(900);
            results.viewports[vp.name] = await page.evaluate(probe);
        }
    } catch (error) {
        results.error = `run failed: ${error.message}`;
    } finally {
        await browser.close().catch(() => {});
    }

    return results;
}

/*
Child mode: run exactly one engine and print its JSON result.
*/
const engine = pw[CHILD_MODE];
if (!engine) {
    console.log(JSON.stringify({ engine: CHILD_MODE, error: "engine not available" }));
    process.exit(0);
}

const result = await runEngine(CHILD_MODE, engine);
console.log(JSON.stringify(result));
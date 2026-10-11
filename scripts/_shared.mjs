/**
 * Shared bootstrap for ad-hoc browser probe scripts.
 *
 * Usage inside a probe script:
 *
 *     import "./_shared.mjs";
 *     export default async function run(page, ui) { ... }
 *
 * `ui.pageErrors` collects pageerror/console-error strings seen so far.
 * The launcher runs the probe against a headless Chromium on
 * NEXUS_URL (default http://127.0.0.1:3000/) and prints JSON.
 */

/*
 * IMPORTANT: probe scripts must NOT `import "./_shared.mjs"`.
 * Doing so creates a circular ESM evaluation (probe -> shared -> import(probe))
 * that deadlocks. Instead run:  node scripts/_shared.mjs scripts/_myprobe.mjs
 */

import { createRequire } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
            const candidates = [mod, mod?.default, mod?.default?.default];
            for (const c of candidates) {
                if (c && typeof c.chromium?.launch === "function") return c;
            }
        } catch { /* next */ }
    }
    throw new Error("patchright not resolved");
}

const pw = resolvePatchright();
const URL_TO_OPEN = process.env.NEXUS_URL || "http://127.0.0.1:3000/";

const browser = await pw.chromium.launch({
    headless: true,
    channel: "chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"]
});
console.error("[shared] browser launched");

const context = await browser.newContext({ locale: "en-US" });
const page = await context.newPage();
page.setDefaultTimeout(15000);

const pageErrors = [];
page.on("pageerror", e => pageErrors.push(String(e.message || e)));
page.on("console", m => {
    if (m.type() === "error") pageErrors.push("console: " + m.text().slice(0, 200));
});

await page.goto(URL_TO_OPEN, { waitUntil: "domcontentloaded", timeout: 30000 });
console.error("[shared] page loaded");
await page.waitForSelector(".sidebar", { timeout: 15000 });
await page.waitForTimeout(2500);
console.error("[shared] probe start");

/* Simple passthrough handle so probes can append their own errors. */
const ui = { pageErrors, push: m => pageErrors.push(m) };

/* Find the probe script to run: argv[2], e.g. node scripts/_shared.mjs scripts/_probe.mjs */
const probePath = process.argv[2];
if (!probePath) {
    console.error("usage: node scripts/_shared.mjs <probe.mjs>");
    process.exit(2);
}
import { pathToFileURL } from "node:url";
const { default: run } = await import(pathToFileURL(probePath).href);
console.error("[shared] probe module loaded");

let report;
try {
    report = await Promise.race([
        run(page, ui),
        new Promise((_, rej) => setTimeout(() => rej(new Error("probe timeout (90s)")), 90000))
    ]);
} catch (error) {
    report = { fatal: String(error && error.stack || error) };
}

report = report || {};
report.pageErrors = pageErrors;

console.error("[shared] probe done, closing browser");
await browser.close();
console.error("[shared] closed, printing report");
console.log(JSON.stringify(report, null, 1));
process.exit(0);

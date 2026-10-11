// Launch the AI in a VISIBLE browser window for live preview.
// Usage: node scripts/_headed.mjs
import { createRequire } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function resolvePatchright() {
    const roots = [];
    for (const base of [join(homedir(), ".vscode", "extensions"), join(homedir(), ".vscode-server", "extensions")]) {
        if (!existsSync(base)) continue;
        const dirs = readdirSync(base).filter(d => d.startsWith("danielsanmedium.dscodegpt-")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const newest = dirs[dirs.length - 1];
        if (newest) roots.push(join(base, newest, "standalone") + "/");
    }
    for (const root of roots) {
        try {
            const mod = createRequire(root)("patchright");
            for (const c of [mod, mod?.default, mod?.default?.default]) if (c && typeof c.chromium?.launch === "function") return c;
        } catch { }
    }
    throw new Error("patchright not resolved");
}

const pw = resolvePatchright();
const browser = await pw.chromium.launch({
    headless: false,
    channel: "chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--window-size=1440,900"]
});
const page = await (await browser.newContext({ viewport: null })).newPage();
page.on("pageerror", e => console.error("[pageerror]", String(e).slice(0, 300)));

await page.goto(process.env.NEXUS_URL || "http://127.0.0.1:3000/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector(".sidebar", { timeout: 15000 });
console.log("AI PREVIEW WINDOW IS OPEN — interact with it freely. Press Ctrl+C here to close it.");

// Keep the window open until user terminates.
await new Promise(() => { });

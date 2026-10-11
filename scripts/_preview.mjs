// Full AI preview: home, send a message, open model menu, open settings.
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
const browser = await pw.chromium.launch({ headless: true, channel: "chromium", args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();

await page.goto(process.env.NEXUS_URL || "http://127.0.0.1:3000/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector(".sidebar", { timeout: 15000 });
await page.waitForTimeout(2500);

// 1. Landing view
await page.screenshot({ path: "preview-home.png" });

// 2. Send a message and capture streaming response
await page.fill("#messageInput", "Give me 3 quick tips for writing clean code");
await page.click("#sendButton");
await page.waitForTimeout(4000);
await page.screenshot({ path: "preview-chat.png" });

// 3. Model menu open (model + agent selection)
await page.click("#modelMenuButton");
await page.waitForTimeout(800);
await page.screenshot({ path: "preview-model-menu.png" });
await page.keyboard.press("Escape");

// 4. Settings page
await page.evaluate(() => document.querySelector('[data-sidebar-action="open-settings"]')?.click());
await page.waitForTimeout(1200);
await page.screenshot({ path: "preview-settings.png" });

await browser.close();
console.log("PREVIEWS DONE");
process.exit(0);

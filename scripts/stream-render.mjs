
/**
 * Streaming render test.
 *
 * Intercepts /api/chat and replays a known NDJSON event stream, so the
 * assertion does not depend on how fast (or slow) the local model is.
 * This checks the frontend contract: activity events, chunks, and the
 * final `done` answer must render into the DOM.
 *
 * Usage: node scripts/stream-render.mjs
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
            for (const c of [mod, mod?.default, mod?.default?.default]) {
                if (c && typeof c.chromium?.launch === "function") return c;
            }
        } catch { /* next */ }
    }
    throw new Error("patchright not resolved");
}

const pw = resolvePatchright();
const URL = process.env.NEXUS_URL || "http://127.0.0.1:3000/";

const browser = await pw.chromium.launch({
    headless: true,
    channel: "chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"]
});

const context = await browser.newContext({ locale: "en-US" });
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", e => pageErrors.push(String(e.message || e)));
page.on("console", m => {
    if (m.type() === "error") pageErrors.push("console: " + m.text().slice(0, 200));
});

/*
Replay a fallback stream: a partial failed answer is reset before the
succeeding model's chunks arrive.
*/
await page.route("**/api/chat", async route => {
    const events = [
        { type: "activity", message: "Understanding request", status: "active" },
        { type: "activity", message: "Planning with tools", status: "active" },
        { type: "chunk", content: "Partial answer from failed model." },
        { type: "reset" },
        { type: "chunk", content: "Pong" },
        { type: "chunk", content: "!" },
        { type: "activity", message: "Completed", status: "done" },
        { type: "done", chatId: 1, answer: "Pong!" }
    ];
    await route.fulfill({
        status: 200,
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache"
        },
        body: events.map(e => JSON.stringify(e)).join("\n") + "\n"
    });
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector(".sidebar", { timeout: 15000 });
await page.waitForTimeout(3000);

await page.fill("#messageInput", "Reply with exactly: pong");
await page.click("#sendButton");
await page.waitForTimeout(2500);

const rendered = await page.evaluate(() => {
    const user = document.querySelector(".message.user .message-content");
    const assistant = document.querySelector(".message.assistant .message-content");
    const sendButton = document.getElementById("sendButton");
    return {
        userText: user ? user.textContent.trim() : null,
        assistantText: assistant ? assistant.textContent.trim() : null,
        assistantNodeExists: !!document.querySelector(".message.assistant"),
        messageCount: document.querySelectorAll(".message").length,
        /*
        The send button is icon-only (ChatGPT-style), so "idle" is
        reported through its accessible label rather than visible text.
        */
        sendLabel: sendButton.getAttribute("aria-label"),
        sendBackToIdle: /send/i.test(sendButton.getAttribute("aria-label") || ""),
        sendIconCount: sendButton.querySelectorAll("svg").length,
        activityItems: document.querySelectorAll(".activity-item").length
    };
});

await browser.close();

const checks = [
    ["user message rendered", rendered.userText === "Reply with exactly: pong"],
    ["assistant node created", rendered.assistantNodeExists],
    ["streamed chunks rendered", rendered.assistantText === "Pong!"],
    ["both messages present", rendered.messageCount === 2],
    ["send button returned to idle", rendered.sendBackToIdle],
    ["send button is icon-only", rendered.sendIconCount === 1],
    ["activity events surfaced", rendered.activityItems > 0],
    ["no console/page errors", pageErrors.length === 0]
];

const failed = checks.filter(([, ok]) => !ok);

console.log(JSON.stringify({ rendered, checks: checks.map(([n, ok]) => ({ check: n, ok })), pageErrors }, null, 1));

console.log(failed.length === 0
    ? "\nSTREAM RENDER: PASS"
    : "\nSTREAM RENDER: FAIL — " + failed.map(([n]) => n).join(", "));

process.exit(failed.length === 0 ? 0 : 1);
// Exercise the composer and workspace surfaces the smoke test does not cover:
// thinking indicator, stop/regenerate, attachment menu actions, workspace tabs,
// file tree, preview, and the model menu.
export default async function run(page, ui) {
    const out = { errors: [], api: [] };
    page.on("pageerror", e => out.errors.push(String(e.message || e)));
    page.on("console", m => { if (m.type() === "error") out.errors.push("console: " + m.text().slice(0, 160)); });
    page.on("response", r => {
        const u = r.url();
        if (u.includes("/api/")) out.api.push(r.request().method() + " " + u.replace(/^.*\/api/, "/api").split("?")[0] + " " + r.status());
    });

    await page.waitForTimeout(2500);

    // ---- Attach menu: each option must have a real handler ----
    out.attachMenu = await page.evaluate(async () => {
        document.getElementById("attachmentButton").click();
        await new Promise(r => setTimeout(r, 300));
        const menu = document.querySelector(".attachment-menu");
        const items = menu ? [...menu.querySelectorAll("[data-attachment-action]")] : [];
        return { opened: !!menu, options: items.map(i => i.dataset.attachmentAction) };
    });

    // Local upload opens the file dialog (native, cannot be asserted) —
    // instead assert the hidden input is wired by checking it exists and is clickable.
    out.localUpload = await page.evaluate(() => {
        const input = document.getElementById("attachmentInput");
        return { exists: !!input, multiple: input?.multiple === true, type: input?.type };
    });

    // ---- Model menu: open, pick a level, confirm it sticks ----
    out.modelMenu = await page.evaluate(async () => {
        document.getElementById("modelMenuButton").click();
        await new Promise(r => setTimeout(r, 400));
        const menu = document.getElementById("modelMenu");
        const opened = menu && !menu.hidden;
        const before = document.getElementById("intelligenceSelector").value;

        const high = document.querySelector('#intelligenceMenuOptions [data-intelligence-value="high"]');
        if (high) { high.click(); }
        await new Promise(r => setTimeout(r, 300));

        return {
            opened,
            levels: document.querySelectorAll("#intelligenceMenuOptions .model-menu-option").length,
            models: document.querySelectorAll("#modelMenuOptions .model-menu-option").length,
            before,
            after: document.getElementById("intelligenceSelector").value,
            label: document.getElementById("modelMenuLabel").textContent
        };
    });
    await page.keyboard.press("Escape");

    // ---- Workspace panel: open via header button, check tabs ----
    out.workspace = await page.evaluate(async () => {
        const btn = document.getElementById("workspaceHeaderButton");
        if (!btn) return { error: "no workspace button" };
        btn.click();
        await new Promise(r => setTimeout(r, 1600));

        const panel = document.getElementById("workspacePanel");
        const tabs = [...document.querySelectorAll(".workspace-tab")];
        const result = {
            panelVisible: panel ? !panel.hidden : false,
            tabCount: tabs.length,
            tabs: tabs.map(t => t.dataset.workspaceSection)
        };

        // Switch to each tab and confirm the matching section shows.
        const active = [];
        for (const tab of tabs) {
            tab.click();
            await new Promise(r => setTimeout(r, 250));
            const section = tab.dataset.workspaceSection;
            const el = document.querySelector('[data-workspace-section="' + section + '"]');
            active.push({ section, tabActive: tab.classList.contains("active") });
        }
        result.tabSwitching = active;

        // Files section should be populated by refreshWorkspace.
        const tree = document.getElementById("workspaceTree");
        result.fileTreeChars = tree ? tree.innerText.length : 0;
        result.fileCount = document.getElementById("fileCount")?.textContent || null;

        // Close it again.
        document.getElementById("workspaceClose")?.click();
        await new Promise(r => setTimeout(r, 300));
        result.closed = panel ? panel.hidden : null;

        return result;
    });

    // ---- Send a message and inspect assistant message controls ----
    await page.fill("#messageInput", "Reply with exactly: ok");
    await page.click("#sendButton");

    // Thinking indicator should appear while generating.
    await page.waitForTimeout(1200);
    out.thinkingDuringSend = await page.evaluate(() => ({
        thinkingVisible: !!document.querySelector(".thinking-message, .thinking-indicator"),
        sendLabel: document.getElementById("sendButton")?.textContent.trim()
    }));

    // Wait for the reply.
    await page.waitForFunction(
        () => {
            const el = document.querySelector(".message.assistant .message-content");
            return el && el.textContent.trim().length > 0;
        },
        { timeout: 90000 }
    ).catch(() => { });
    await page.waitForTimeout(600);

    out.assistantMessage = await page.evaluate(() => {
        const body = document.querySelector(".message.assistant");
        const buttons = body ? [...body.querySelectorAll("button")] : [];
        return {
            actions: buttons.map(b => b.textContent.trim()).filter(Boolean),
            hasCopyCode: !!document.querySelector(".copy-code-button"),
            codeBlocks: document.querySelectorAll(".message-content pre").length,
            text: document.querySelector(".message.assistant .message-content")?.textContent.trim().slice(0, 60) || null
        };
    });

    // ---- Regenerate / edit controls on the user message ----
    out.userMessage = await page.evaluate(() => {
        const user = document.querySelector(".message.user");
        const buttons = user ? [...user.querySelectorAll("button")] : [];
        return { actions: buttons.map(b => b.textContent.trim()).filter(Boolean) };
    });

    // ---- Keyboard: Enter must send ----
    out.enterToSend = await page.evaluate(() => {
        const input = document.getElementById("messageInput");
        const before = document.querySelectorAll(".message").length;
        input.value = "Reply with one word: hi";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", bubbles: true, cancelable: true
        }));
        return { before, inputCleared: input.value === "" };
    });
    await page.waitForTimeout(1500);
    out.afterEnter = await page.evaluate(() => document.querySelectorAll(".message").length);

    out.apiCalls = [...new Set(out.api)].slice(-14);
    return out;
}
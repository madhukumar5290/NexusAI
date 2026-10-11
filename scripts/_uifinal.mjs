// Final visual check: dark mode + a real conversation.
export default async function run(page, ui) {
    const out = {};

    // Switch to dark via the public hook, then read computed colors.
    await page.evaluate(() => window.setNexusTheme("dark"));
    await page.waitForTimeout(300);

    out.dark = await page.evaluate(() => {
        const cs = getComputedStyle;
        return {
            attr: document.documentElement.getAttribute("data-theme"),
            body: cs(document.body).backgroundColor,
            sidebar: cs(document.querySelector(".sidebar")).backgroundColor,
            composer: cs(document.querySelector(".input-wrapper")).backgroundColor,
            sendBg: cs(document.querySelector(".send-button")).backgroundColor,
            text: cs(document.body).color
        };
    });

    // Back to light for the conversation screenshot.
    await page.evaluate(() => window.setNexusTheme("light"));
    await page.waitForTimeout(300);

    // Build a two-turn conversation so both message styles are visible.
    await page.fill("#messageInput", "In one short sentence, what is Nexus AI?");
    await page.click("#sendButton");
    await page.waitForFunction(
        () => {
            const el = document.querySelector(".message.assistant .message-content");
            return el && el.textContent.trim().length > 0;
        },
        { timeout: 90000 }
    ).catch(() => { });
    await page.waitForTimeout(600);

    out.conversation = await page.evaluate(() => {
        const user = document.querySelector(".message.user .message-body");
        const assistantBody = document.querySelector(".message.assistant .message-body");
        const assistant = document.querySelector(".message.assistant .message-content");
        return {
            messageCount: document.querySelectorAll(".message").length,
            userBubbleBg: user ? getComputedStyle(user).backgroundColor : null,
            userBubbleRadius: user ? getComputedStyle(user).borderRadius : null,
            assistantAvatar: !!document.querySelector(".message.assistant .message-avatar"),
            assistantAvatarText: document.querySelector(".message.assistant .message-avatar")?.textContent || null,
            assistantText: assistant ? assistant.textContent.trim().slice(0, 160) : null,
            actionsRendered: document.querySelectorAll(".message.assistant .message-actions").length
        };
    });

    // Confirm the composer still behaves like ChatGPT after a turn.
    out.composerAfterTurn = await page.evaluate(() => ({
        inputValue: document.getElementById("messageInput").value,
        sendDisabled: document.getElementById("sendButton").disabled
    }));

    return out;
}

// Isolate Enter-to-send: is it broken, or was it blocked by isSending?
export default async function run(page, ui) {
    const out = {};
    await page.waitForTimeout(2500);

    // Wait until nothing is generating.
    out.idleState = await page.evaluate(() => ({
        sendLabel: document.getElementById("sendButton")?.textContent.trim().slice(0, 20),
        messageCount: document.querySelectorAll(".message").length
    }));

    // Type and press Enter from an idle state.
    out.enterTest = await page.evaluate(async () => {
        const input = document.getElementById("messageInput");
        const before = document.querySelectorAll(".message").length;

        input.focus();
        input.value = "Reply with exactly: ok";
        input.dispatchEvent(new Event("input", { bubbles: true }));

        const evt = new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            bubbles: true,
            cancelable: true
        });
        input.dispatchEvent(evt);

        await new Promise(r => setTimeout(r, 1500));

        return {
            before,
            after: document.querySelectorAll(".message").length,
            inputValue: input.value,
            sendLabelAfter: document.getElementById("sendButton")?.textContent.trim().slice(0, 20)
        };
    });

    // Wait for completion, then check the assistant message rendered.
    await page.waitForFunction(
        () => {
            const el = document.querySelector(".message.assistant .message-content");
            return el && el.textContent.trim().length > 0;
        },
        { timeout: 90000 }
    ).catch(() => { });

    out.reply = await page.evaluate(() => {
        const el = document.querySelector(".message.assistant .message-content");
        const body = document.querySelector(".message.assistant");
        return {
            text: el ? el.textContent.trim().slice(0, 80) : null,
            messageCount: document.querySelectorAll(".message").length,
            actions: body ? [...body.querySelectorAll("button")].map(b => b.textContent.trim()).filter(Boolean) : []
        };
    });

    return out;
}
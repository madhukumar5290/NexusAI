// Enumerate every settings control and attachment action, and classify
// each as WORKING (has a real effect) or STUB (notice only).
export default async function run(page, ui) {
    const out = { settings: {}, attachments: [] };
    await page.waitForTimeout(1200);

    await page.click("#controlCenterButton");
    await page.waitForTimeout(1600);

    const tabs = await page.evaluate(() =>
        [...document.querySelectorAll("[data-settings-section]")].map(b => b.dataset.settingsSection)
    );

    for (const tab of tabs) {
        await page.evaluate(sec => {
            document.querySelector('[data-settings-section="' + sec + '"]').click();
        }, tab);
        await page.waitForTimeout(250);

        out.settings[tab] = await page.evaluate(() => {
            const panel = document.querySelector(".settings-panel-section.active");
            if (!panel) return { error: "no active panel" };

            const controls = [];
            panel.querySelectorAll("select, input, button").forEach(el => {
                const label =
                    el.id ||
                        el.dataset.settingKey ||
                        el.dataset.settingsAction ||
                        el.dataset.installLocalModel !== undefined ? "install-model" :
                        (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
                controls.push({
                    kind: el.tagName.toLowerCase() + (el.type ? ":" + el.type : ""),
                    label: String(label || "").slice(0, 45)
                });
            });

            // Count any "notice-only" affordances: buttons whose only job
            // is to show text.
            return {
                controls,
                controlCount: controls.length,
                hasRealLists: panel.querySelectorAll(".capability-list, .product-list").length
            };
        });
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // Attachment menu: click each option and record whether it actually
    // does something or just shows a notice.
    for (const action of ["drive", "github"]) {
        await page.evaluate(a => {
            document.getElementById("attachmentButton").click();
            const btn = document.querySelector('[data-attachment-action="' + a + '"]');
            if (btn) btn.click();
        }, action);
        await page.waitForTimeout(700);
        out.attachments.push(await page.evaluate(a => ({
            action: a,
            notice: (document.querySelector(".composer-notice, .nexus-toast, .capability-notice")?.textContent || "").trim().slice(0, 120) || null
        }), action));
    }

    return out;
}
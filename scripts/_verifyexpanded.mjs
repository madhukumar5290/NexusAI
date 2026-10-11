// Verify the expanded Settings: count controls, drive them, confirm effects.
export default async function run(page, ui) {
    const out = { sections: {}, errors: [] };
    page.on("pageerror", e => out.errors.push(String(e.message || e)));

    await page.waitForTimeout(1500);
    await page.click("#controlCenterButton");
    await page.waitForTimeout(1800);

    const tabs = await page.evaluate(() =>
        [...document.querySelectorAll("[data-settings-section]")].map(b => b.dataset.settingsSection)
    );

    for (const tab of tabs) {
        await page.evaluate(sec => {
            document.querySelector('[data-settings-section="' + sec + '"]').click();
        }, tab);
        await page.waitForTimeout(350);
        out.sections[tab] = await page.evaluate(() => {
            const panel = document.querySelector(".settings-panel-section.active");
            const controls = [...panel.querySelectorAll("button, select, input, textarea")];
            return {
                controls: controls.length,
                selects: controls.filter(c => c.tagName === "SELECT").length,
                sliders: controls.filter(c => c.type === "range").length,
                checkboxes: controls.filter(c => c.type === "checkbox").length,
                numbers: controls.filter(c => c.type === "number").length
            };
        });
    }

    // ---- General: toggle wide layout and confirm it affects the body ----
    out.wideLayout = await page.evaluate(async () => {
        document.querySelector('[data-settings-section="general"]').click();
        await new Promise(r => setTimeout(r, 300));
        const cb = document.getElementById("settingsWide");
        if (!cb) return { error: "no wide toggle" };
        const before = document.body.classList.contains("wide-layout");
        cb.checked = !before;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        return { before, after: document.body.classList.contains("wide-layout") };
    });

    // ---- Voice: real system voices + slider readouts ----
    out.voice = await page.evaluate(async () => {
        document.querySelector('[data-settings-section="voice"]').click();
        await new Promise(r => setTimeout(r, 600));
        const sel = document.getElementById("voiceSelect");
        const rate = document.getElementById("voiceRate");
        const rateVal = document.getElementById("voiceRateValue");
        if (rate) {
            rate.value = "1.5";
            rate.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await new Promise(r => setTimeout(r, 200));
        return {
            voiceOptions: sel ? sel.options.length : 0,
            firstVoices: sel ? [...sel.options].slice(0, 3).map(o => o.textContent) : [],
            rateReadout: rateVal ? rateVal.textContent : null,
            hasPitch: !!document.getElementById("voicePitch"),
            hasDictationLang: !!document.getElementById("dictationLanguage")
        };
    });

    // ---- Models: advanced sliders must update readouts and persist ----
    out.advanced = await page.evaluate(async () => {
        document.querySelector('[data-settings-section="models"]').click();
        await new Promise(r => setTimeout(r, 400));
        const temp = document.getElementById("advancedTemperature");
        const tempVal = document.getElementById("tempValue");
        const mode = document.getElementById("advancedModeEnabled");
        if (mode) { mode.checked = true; mode.dispatchEvent(new Event("change", { bubbles: true })); }
        if (temp) {
            temp.value = "1.2";
            temp.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await new Promise(r => setTimeout(r, 300));
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem("nexus-advanced-execution") || "null"); } catch { }
        return {
            tempReadout: tempVal ? tempVal.textContent : null,
            storedTemperature: stored?.temperature ?? null,
            storedEnabled: stored?.enabled ?? null,
            sliderCount: document.querySelectorAll('.settings-panel-section.active input[type="range"]').length
        };
    });

    return out;
}
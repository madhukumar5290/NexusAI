export default async function run(page, ui) {
    await page.waitForSelector('#controlCenterButton');
    const snapshot = await ui.snapshot();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.waitForSelector('[data-settings-panel="general"]');
    const out = { snapshot, viewports: {} };
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['tablet', 768, 1024]]) {
        await page.setViewportSize({ width, height });
        const tabs = await page.locator('[data-settings-section]').evaluateAll(els => els.map(el => el.dataset.settingsSection));
        out.viewports[name] = {};
        for (const tab of tabs) {
            await page.locator(`[data-settings-section="${tab}"]`).click();
            out.viewports[name][tab] = await page.evaluate(() => {
                const content = document.querySelector('.settings-content');
                const panel = document.querySelector('.settings-panel-section.active');
                const visible = [...document.querySelectorAll('[data-settings-panel]')].filter(el => el.getClientRects().length);
                const body = document.getElementById('controlCenterBody');
                return {
                    visible: visible.map(el => el.dataset.settingsPanel),
                    nested: [...document.querySelectorAll('[data-settings-panel]')].filter(el => el.parentElement !== content).map(el => el.dataset.settingsPanel),
                    overflow: body.scrollWidth > body.clientWidth + 1,
                    panelWidth: Math.round(panel.getBoundingClientRect().width),
                    controls: panel.querySelectorAll('input,select,textarea,button').length
                };
            });
        }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-settings-section="general"]').click();
    await page.screenshot({ path: 'settings-before.png' });
    return out;
}

export default async function run(page) {
    await page.waitForSelector('#controlCenterButton');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('[data-settings-section="security"]').click();
    await page.waitForTimeout(400);
    return page.evaluate(() => {
        const body = document.getElementById('controlCenterBody');
        const wide = [];
        body.querySelectorAll('*').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.right > body.getBoundingClientRect().right + 1 || r.left < -1) {
                wide.push({ tag: el.tagName, cls: String(el.className).slice(0, 50), right: Math.round(r.right), w: Math.round(r.width) });
            }
        });
        const layout = body.querySelector('.settings-layout');
        return { bodyScroll: body.scrollWidth, layoutW: layout && Math.round(layout.getBoundingClientRect().width), wide: wide.slice(0, 10) };
    });
}

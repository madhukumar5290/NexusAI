import "./_shared.mjs";

export default async function run(page, ui) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(700);
    ui.push("checkpoint A");
    const step1 = await page.evaluate(() => window.innerWidth);
    ui.push("step1=" + JSON.stringify(step1));
    const step2 = await page.evaluate(() => ({ a: window.innerWidth, b: document.title }));
    ui.push("step2=" + JSON.stringify(step2));
    return { step1, step2 };
}

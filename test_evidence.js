const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    // set a standard desktop viewport
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    try {
        console.log('Navigating to devices page...');
        await page.goto('http://localhost:4723/xenon/devices', { waitUntil: 'domcontentloaded' });

        await page.waitForSelector('.device-info-card-container', { timeout: 10000 });
        console.log('Device cards loaded.');

        console.log('Clicking Control button...');
        await page.click('.tactical-btn.control-btn');

        await page.waitForSelector('.action-card-title', { timeout: 10000 });
        console.log('Device Control panel opened.');

        console.log('Switching to Screenshot Tab...');
        await page.click('button:has-text("SCREENSHOT")');

        await page.waitForSelector('.screenshot-workspace', { timeout: 10000 });

        console.log('Taking device screenshot...');
        await page.click('button:has-text("NEW CAPTURE")');

        await page.waitForTimeout(8000); // Wait for the adb capture to finish and render

        // Take a screenshot of the viewport
        await page.screenshot({ path: '/Users/rabindrabiswal/Workspace/XAenon/xenon/captured_evidence_manual.png' });
        console.log('Saved screenshot successfully.');

    } catch (err) {
        console.error('Playwright Error:', err);
    } finally {
        await browser.close();
    }
})();

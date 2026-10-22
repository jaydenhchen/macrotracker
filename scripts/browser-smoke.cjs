// Run with Playwright installed: npm install --no-save --package-lock=false playwright
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const staticCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/api/v1/foods.json'), 'utf8'));
const charlesMarketFoodCount = staticCatalog.data.filter((food) => food.locationId === 'charles-market').length;

async function main() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '/macrotracker';
  const server = spawn(process.execPath, ['scripts/serve-export.cjs'], { stdio: 'inherit', env: { ...process.env, PORT: '4173', NEXT_PUBLIC_BASE_PATH: basePath } });
  let browser;
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if ((await fetch(`http://127.0.0.1:4173${basePath}/`)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const filename = path.join(__dirname, `../public/api/menus/${date}.json`);
    const menu = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : null;
    // Exercise the static fallback from real Hopkins data downloaded during CI.
    await page.route('https://bluejay-fuel-menu-proxy.bjfuel.workers.dev/**', (route) => route.fulfill({ status: 502, body: '{}' }));
    await page.goto(`http://127.0.0.1:4173${basePath}/`);
    await page.getByRole('button', { name: 'Close setup' }).click();
    await page.locator('.side-nav').getByRole('button', { name: 'Foods' }).click();
    await page.waitForFunction(() => !document.querySelector('.api-badge')?.textContent.includes('Loading'));
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileSearchBox = await page.locator('.food-toolbar .search-field').boundingBox();
    assert.ok(mobileSearchBox && mobileSearchBox.height >= 42 && mobileSearchBox.height <= 44, `Foods search control should stay compact on mobile: ${JSON.stringify(mobileSearchBox)}`);
    const mobileDocumentWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.equal(mobileDocumentWidth.scroll, mobileDocumentWidth.client, `Foods view must not overflow horizontally on mobile: ${JSON.stringify(mobileDocumentWidth)}`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (menu) {
      assert.equal(await page.locator('.catalog-food-card').count(), menu.foods.length + charlesMarketFoodCount);
      await page.getByText('Saved Hopkins menu', { exact: true }).waitFor();
      for (const location of menu.locations) {
        await page.getByLabel('Filter by location').selectOption(location.id);
        assert.equal(await page.locator('.catalog-food-card').count(), menu.foods.filter((food) => food.locationId === location.id).length);
      }
    } else {
      await page.locator('.api-badge').filter({ hasText: 'Menu unavailable' }).waitFor();
      assert.equal(await page.locator('.catalog-food-card').count(), charlesMarketFoodCount);
    }
    await page.getByLabel('Filter by location').selectOption('charles-market');
    assert.equal(await page.locator('.catalog-food-card').count(), charlesMarketFoodCount);
    const heatCard = page.locator('.catalog-food-card').filter({ hasText: 'PLANTERS HEAT Peanuts' });
    assert.equal(await heatCard.getByRole('link').getAttribute('href'), 'https://www.planters.com/product/heat-peanuts/');
    assert.equal(await page.locator('.menu-location').filter({ hasText: 'Charles Market' }).locator('a').getAttribute('href'), 'https://www.yorkstreetmarket.com/grab-n-go');
    assert.equal(await page.locator('.menu-location').filter({ hasText: 'Charles Market' }).locator('a').innerText(), 'York Street Market Grab-&-Go ↗');
    await page.getByLabel('Filter by location').selectOption('all');
    await page.getByLabel('Sort foods').selectOption('protein-desc');
    await page.getByRole('button', { name: 'All dietary tags', exact: true }).click();
    await page.locator('.filter-option').filter({ hasText: /^Vegan$/ }).click();
    await page.locator('.filter-option').filter({ hasText: /^Vegetarian$/ }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.filter-trigger').innerText(), '2 tags');
    await page.locator('.side-nav').getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Add to Lunch', exact: true }).click();
    for (const size of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      for (const select of await page.locator('.select-field select').all()) {
        const result = await select.evaluate((element) => {
          const box = element.parentElement.getBoundingClientRect();
          const control = element.getBoundingClientRect();
          const points = [[box.left + 4, box.top + box.height / 2], [box.right - 4, box.top + box.height / 2], [box.left + box.width / 2, box.bottom - 4]];
          return { covers: Math.abs(control.width - box.width) <= 3 && Math.abs(control.height - box.height) <= 3,
            hits: points.map(([x, y]) => document.elementFromPoint(x, y) === element) };
        });
        assert.ok(result.covers && result.hits.every(Boolean), `Entire dropdown must be clickable at ${size.width}px: ${JSON.stringify(result)}`);
        // A genuine pointer click on the arrow area must open the native popup.
        const box = await select.boundingBox();
        await select.click({ position: { x: box.width - 13, y: box.height / 2 } });
        assert.ok(await select.evaluate((element) => element.matches(':open')), 'Arrow click did not open native select');
        await page.keyboard.press('Escape');
      }
    }
    await page.getByLabel('Filter by location').selectOption('charles-market');
    await page.locator('.modal-food-row').filter({ hasText: 'PLANTERS Salted Peanuts' }).click();
    await page.getByRole('button', { name: 'Add to lunch', exact: true }).click();
    await page.locator('.entry-row').filter({ hasText: 'PLANTERS Salted Peanuts' }).waitFor();
    await page.getByRole('button', { name: 'Add to Lunch', exact: true }).click();
    await page.getByLabel('Filter by location').selectOption('charles-market');
    const unknownFood = page.locator('.modal-food-row').filter({ hasText: 'Asiago Turkey' });
    await unknownFood.click();
    assert.equal(await page.getByRole('button', { name: 'Add to lunch', exact: true }).isEnabled(), true);
    await page.getByText('Nutrition unavailable; unknown values are not included in totals.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Add to lunch', exact: true }).click();
    const unknownEntry = page.locator('.entry-row').filter({ hasText: 'Asiago Turkey' });
    await unknownEntry.waitFor();
    assert.equal(await unknownEntry.locator('.entry-macros strong').innerText(), '—');
    assert.equal(await unknownEntry.locator('.entry-macros span').innerText(), 'unavailable');
    await page.locator('.nutrition-warning').waitFor();
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: Hopkins fallback, all 230 Charles Market foods, York Street and peanut links, known and unavailable-macro logging, dietary filters, sorting, desktop/mobile dropdown arrow clicks.');
  } finally {
    await browser?.close();
    server.kill();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

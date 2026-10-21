require('./load-typescript.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchMenu } = require('../worker/src/index.ts');

async function main() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const out = path.join(__dirname, '../public/api/menus');
  let todayLoaded = false;
  let todayComplete = false;
  await fs.mkdir(out, { recursive: true });
  // The published fallback is refreshed daily, and always has an exact menu date.
  for (const offset of [0, -1, 1]) {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    const date = day.toISOString().slice(0, 10);
    const menu = await fetchMenu(date);
    console.log(JSON.stringify({ date, food_count: menu.foods.length, partial: menu.partial,
      locations: menu.locations.map((location) => ({ name: location.name, status: location.status,
        foods: menu.foods.filter((food) => food.locationId === location.id).length })), errors: menu.errors }));
    if (offset === 0) todayLoaded = menu.foods.length > 0 || menu.errors.length === 0;
    if (offset === 0) todayComplete = menu.errors.length === 0;
    if (!menu.foods.length && menu.errors.length) continue;
    await fs.writeFile(path.join(out, `${date}.json`), JSON.stringify(menu));
  }
  if (!todayLoaded || !todayComplete) {
    const message = 'Some Hopkins menus could not be downloaded today. Inspect the location errors above.';
    if (process.argv.includes('--allow-unavailable')) console.warn(`${message} Publishing the app with an explicit unavailable state.`);
    else throw new Error(message);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

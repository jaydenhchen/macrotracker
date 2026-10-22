require('./load-typescript.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { FOODS } = require('../lib/catalog.ts');

const updatedDate = FOODS.map((food) => food.updatedAt).filter(Boolean).sort().at(-1);
if (!updatedDate) throw new Error('Food catalog has no update date');

const catalog = {
  data: FOODS,
  meta: { total: FOODS.length, version: '1.0.0' },
  source: 'fallback-catalog',
  updatedAt: `${updatedDate}T12:00:00.000Z`,
};
const target = path.join(__dirname, '../public/api/v1/foods.json');
fs.writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${catalog.meta.total} foods to ${target}`);

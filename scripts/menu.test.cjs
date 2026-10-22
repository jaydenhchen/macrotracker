require('./load-typescript.cjs');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { fetchMenu, upstreamUrl, default: worker } = require('../worker/src/index.ts');
const { resolveMenuTargets, extractMenuItems, normalizeMenuItem, HOPKINS_LOCATIONS } = require('../worker/src/normalizer.ts');
const originalFetch = global.fetch;
const directory = [
  { slug: 'hopkins-cafe', name: 'Hopkins Café', active_menu_types: [{ slug: 'hopkins-cafe-lunch', name: 'Lunch' }] },
  { slug: 'nolans-on-33rd', name: 'Nolan’s on 33rd', active_menu_types: [{ slug: 'nolans-dinner-2', name: 'Dinner' }] },
  { slug: 'site-1', name: 'Levering Kitchens', active_menu_types: [{ slug: 'lunch', name: 'Lunch' }] },
  { slug: 'levering-cafe', name: 'Levering Café', active_menu_types: [{ slug: 'cafe', name: 'Café' }] },
  { slug: 'peabody-institute', name: 'Peabody Dining Hall', active_menu_types: [{ slug: 'peabody-lunch', name: 'Lunch' }] },
];
const food = { id: 25, name: 'Test menu food', rounded_nutrition_info: { calories: 100, g_protein: 10, g_carbs: 8, g_fat: 3 }, icons: { food_icons: [{ synced_name: 'Vegan' }] } };
const weekly = { days: [{ date: '2026-10-20', menu_items: [{ food: { ...food, name: 'Wrong day' } }] },
  { date: '2026-10-21', menu_items: [{ is_section_title: true, text: 'Burrito station' }, { food }] }] };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { global.fetch = originalFetch; delete global.caches; delete global.window; delete global.localStorage; });

test('every location uses the exact directory menu ID and a Sunday week, without guessing', async () => {
  let requests = 0;
  global.fetch = async (url) => {
    requests++;
    if (url.includes('/schools/')) return json(directory);
    assert.ok(directory.some((location) => location.active_menu_types.some((menu) => url === upstreamUrl('https://hopkinsdining.api.nutrislice.com', location.slug, menu.slug, '2026-10-21'))));
    assert.match(url, /\/2026\/10\/18\/\?format=json$/);
    return json(weekly);
  };
  const result = await fetchMenu('2026-10-21');
  assert.equal(requests, 6);
  assert.equal(result.foods.length, 5);
  assert.equal(result.partial, false);
  assert.ok(result.locations.every((location) => location.status === 'available'));
  assert.ok(result.foods.every((item) => item.name === 'Test menu food' && item.stationName === 'Burrito station' && item.tags.includes('Vegan')));
  assert.match(result.foods.find((item) => item.locationId === 'hopkins-cafe').menuUrl, /hopkins-cafe\/hopkins-cafe-lunch\/2026\/10\/21$/);
});

test('the same named food at one location appears once and keeps every meal period', async () => {
  const twoMeals = [{ slug: 'hopkins-cafe', name: 'Hopkins Café', active_menu_types: [
    { slug: 'hopkins-cafe-lunch', name: 'Lunch' }, { slug: 'hopkins-cafe-dinner', name: 'Dinner' },
  ] }];
  global.fetch = async (url) => url.includes('/schools/') ? json(twoMeals) : json({ days: [{ date: '2026-10-21', menu_items: [{ food }] }] });
  const result = await fetchMenu('2026-10-21');
  assert.equal(result.foods.length, 1);
  assert.deepEqual(result.foods[0].mealPeriods, ['Lunch', 'Dinner']);
  assert.deepEqual(result.foods[0].menuTypes, ['hopkins-cafe-lunch', 'hopkins-cafe-dinner']);
  assert.deepEqual(result.foods[0].legacyIds, [
    'nutrislice-hopkins-cafe-25-hopkins-cafe-lunch',
    'nutrislice-hopkins-cafe-25-hopkins-cafe-dinner',
  ]);
  assert.equal(result.locations[0].meals.find((meal) => meal.name === 'Lunch').foods.length, 1);
  assert.equal(result.locations[0].meals.find((meal) => meal.name === 'Dinner').foods.length, 1);
});

test('deduplicating repeated foods retains station context from a later menu result', async () => {
  const oneLocation = [{ slug: 'site-1', name: 'Levering Kitchens', active_menu_types: [
    { slug: 'lunch-a', name: 'Lunch A' }, { slug: 'lunch-b', name: 'Lunch B' },
  ] }];
  global.fetch = async (url) => url.includes('/schools/') ? json(oneLocation) : json({ days: [{ date: '2026-10-21', menu_items: url.includes('/lunch-a/') ? [{ food }] : [{ is_station_header: true, text: 'Build Your Own' }, { food }] }] });
  const result = await fetchMenu('2026-10-21');
  assert.equal(result.foods.length, 1);
  assert.equal(result.foods[0].stationName, 'Build Your Own');
});

test('empty or malformed directory produces a useful error and no fictional foods', async () => {
  global.fetch = async () => json([]);
  const result = await fetchMenu('2026-10-21');
  assert.deepEqual(result.foods, []);
  assert.equal(result.errors[0].mealType, 'directory');
  assert.ok(result.locations.every((location) => location.status === 'unavailable'));
  assert.equal(resolveMenuTargets([{ name: '', slug: '', active_menu_types: [] }]).length, 0);
});

test('missing macros are explicitly flagged and station headings never become food', () => {
  assert.equal(normalizeMenuItem({ text: 'Closed today', food: null }, HOPKINS_LOCATIONS[0], 'lunch', '2026-10-21'), null);
  const item = normalizeMenuItem({ food: { id: 1, name: 'Unknown macros', rounded_nutrition_info: { calories: 0 } } }, HOPKINS_LOCATIONS[0], 'lunch', '2026-10-21');
  assert.deepEqual(item.missingNutrition, ['protein', 'carbs', 'fat']);
  assert.equal(item.calories, 0);
  assert.equal(extractMenuItems(weekly, '2026-10-22').length, 0);
});

test('no added sugar is tagged only when added sugar is explicitly zero; natural sugar is allowed', () => {
  const noAdded = normalizeMenuItem({ food: { id: 11, name: 'Fruit cup', rounded_nutrition_info: { g_sugar: 12, g_added_sugar: 0 } } }, HOPKINS_LOCATIONS[0], 'lunch', '2026-10-21');
  const hasAdded = normalizeMenuItem({ food: { id: 12, name: 'Sweetened oats', rounded_nutrition_info: { g_sugar: 12, g_added_sugar: 4 } } }, HOPKINS_LOCATIONS[0], 'lunch', '2026-10-21');
  const unknown = normalizeMenuItem({ food: { id: 13, name: 'Unknown sugar', rounded_nutrition_info: { g_sugar: 0, g_added_sugar: null } } }, HOPKINS_LOCATIONS[0], 'lunch', '2026-10-21');
  const conflicting = normalizeMenuItem({ food: { id: 14, name: 'Conflicting label', rounded_nutrition_info: { g_added_sugar: 3 }, icons: { food_icons: [{ synced_name: 'No Added Sugar' }] } } }, HOPKINS_LOCATIONS[0], 'lunch', '2026-10-21');
  assert.equal(noAdded.addedSugar, 0);
  assert.ok(noAdded.tags.includes('No Added Sugar'));
  assert.equal(hasAdded.addedSugar, 4);
  assert.ok(!hasAdded.tags.includes('No Added Sugar'));
  assert.equal(unknown.addedSugar, null);
  assert.ok(!unknown.tags.includes('No Added Sugar'));
  assert.ok(!conflicting.tags.includes('No Added Sugar'));
  const { matchesFoodTag } = require('../lib/food-filters.ts');
  assert.equal(matchesFoodTag(noAdded, 'no-added-sugar'), true);
  assert.equal(matchesFoodTag(hasAdded, 'no-added-sugar'), false);
  assert.equal(matchesFoodTag(unknown, 'no-added-sugar'), false);
  assert.equal(matchesFoodTag(conflicting, 'no-added-sugar'), false);
});

test('rate limits and malformed responses preserve other locations; empty menus are not failures', async () => {
  global.fetch = async (url) => {
    if (url.includes('/schools/')) return json(directory);
    if (url.includes('/hopkins-cafe/')) return json({}, 429);
    if (url.includes('/nolans-on-33rd/')) return json({ unexpected: true });
    if (url.includes('/peabody-institute/')) return json({ days: [] });
    return json(weekly);
  };
  const result = await fetchMenu('2026-10-21');
  assert.equal(result.foods.length, 2);
  assert.equal(result.partial, true);
  assert.equal(result.errors.length, 2);
  assert.equal(result.locations.find((location) => location.id === 'peabody-institute').status, 'empty');
});

test('the Worker stays within the free-tier request budget', async () => {
  let requests = 0;
  global.fetch = async (url) => {
    requests++;
    if (url.includes('/schools/')) return json([{ slug: 'site-1', name: 'Levering Kitchens', active_menu_types: Array.from({ length: 60 }, (_, i) => ({ slug: `menu-${i}`, name: `Menu ${i}` })) }]);
    return json({ days: [] });
  };
  const result = await fetchMenu('2026-10-21');
  assert.equal(requests, 45);
  assert.equal(result.errors.filter((error) => error.message.includes('budget')).length, 16);
});

test('CORS is recalculated on cache hits and invalid dates do not reach upstream', async () => {
  let requests = 0;
  global.fetch = async () => { requests++; throw new Error('must not fetch'); };
  global.caches = { default: { match: async () => new Response('{}', { headers: { 'Access-Control-Allow-Origin': 'https://first.github.io' } }), put: async () => {} } };
  const context = { waitUntil() {} };
  const env = { ALLOWED_ORIGINS: 'https://first.github.io,https://second.github.io' };
  const response = await worker.fetch(new Request('https://worker.test/api/menu?date=2026-10-21', { headers: { Origin: 'https://second.github.io' } }), env, context);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://second.github.io');
  const noOrigin = await worker.fetch(new Request('https://worker.test/api/menu?date=2026-10-21'), env, context);
  assert.equal(noOrigin.headers.get('access-control-allow-origin'), null);
  assert.equal((await worker.fetch(new Request('https://worker.test/api/menu?date=2026-02-30'), env, context)).status, 400);
  assert.equal((await worker.fetch(new Request('https://worker.test/api/menu', { headers: { Origin: 'https://evil.test' } }), env, context)).status, 403);
  assert.equal((await worker.fetch(new Request('https://worker.test/api/menu', { method: 'OPTIONS' }), {}, context)).status, 204);
  assert.equal(requests, 0);
});

test('502 responses retain arrays and CORS so diagnostics and the frontend can handle them', async () => {
  global.caches = { default: { match: async () => undefined, put: async () => { throw new Error('outages must not be cached'); } } };
  global.fetch = async () => json({}, 429);
  const response = await worker.fetch(new Request('https://worker.test/api/menu?date=2026-10-21', { headers: { Origin: 'https://jaydenhchen.github.io' } }), {}, { waitUntil() {} });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.foods, []);
  assert.equal(payload.locations.length, 5);
  assert.equal(payload.errors[0].mealType, 'directory');
});

test('upstream timeouts abort without an unbounded retry loop', async () => {
  global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }));
  const start = Date.now();
  const result = await fetchMenu('2026-10-21', { UPSTREAM_TIMEOUT_MS: '1000' });
  assert.equal(result.foods.length, 0);
  assert.match(result.errors[0].message, /timeout/);
  assert.ok(Date.now() - start < 2500);
});

test('realistic menus larger than four MB are retained with bounded concurrency', async () => {
  const menus = ['hopkins-cafe-breakfast', 'hopkins-cafe-lunch', 'hopkins-cafe-dinner'];
  const largeWeek = JSON.stringify({ ...weekly, description: 'x'.repeat(4_100_000) });
  let active = 0;
  let peak = 0;
  global.fetch = async (url) => {
    if (url.includes('/schools/')) return json([{ ...directory[0], active_menu_types: menus.map((slug) => ({ slug, name: slug })) }]);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return new Response(largeWeek, { headers: { 'Content-Type': 'application/json' } });
  };
  const result = await fetchMenu('2026-10-21');
  assert.equal(result.errors.length, 0);
  assert.equal(result.foods.length, 1);
  assert.equal(result.foods[0].menuTypes.length, 3);
  assert.ok(peak <= 2);
});

test('malformed selected-day item containers are errors, not successful empty menus', async () => {
  global.fetch = async (url) => url.includes('/schools/') ? json([directory[0]]) : json({ days: [{ date: '2026-10-21', menu_items: { broken: true } }] });
  const result = await fetchMenu('2026-10-21');
  assert.equal(result.partial, true);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /malformed menu items/);
  assert.equal(result.locations[0].status, 'unavailable');
  assert.throws(() => extractMenuItems({ days: [{ date: '2026-10-21', menu_items: [null] }] }, '2026-10-21'), /invalid menu item/);
});

test('serving edits and backup round trips preserve immutable nutrition without rounding drift', () => {
  const { resizeMealEntry } = require('../lib/nutrition.ts');
  const { DEFAULT_STATE, normalizeState } = require('../lib/storage.ts');
  const nutrition = { calories: 101, protein: 5.1, carbs: 10.3, fat: 2.2 };
  let entry = { id: 'entry', foodId: 'food', foodName: 'Food', servingSize: '1 serving', servings: 1, nutrition, nutritionPerServing: nutrition, locationName: 'Hopkins Café' };
  for (let index = 0; index < 20; index++) {
    entry = resizeMealEntry(entry, 0.25);
    const state = normalizeState(JSON.parse(JSON.stringify({ ...DEFAULT_STATE, dayLogs: { '2026-10-21': { date: '2026-10-21', meals: { Lunch: [entry] }, customMacros: [], waterEntries: [] } } })));
    entry = resizeMealEntry(state.dayLogs['2026-10-21'].meals.Lunch[0], 1);
    assert.deepEqual(entry.nutrition, nutrition);
  }
});

test('fractional add-ons use the same unrounded basis for logging, display and resizing', () => {
  const { mealNutritionBasis, nutritionForMeal, resizeMealEntry } = require('../lib/nutrition.ts');
  const food = { calories: 101, protein: 1.8, carbs: 0, fat: 0 };
  const addOns = [{ id: 'addon', name: 'Protein', category: 'protein', servingSize: '1 scoop', calories: 101, protein: 3, carbs: 0, fat: 0, quantity: 0.25 }];
  const original = nutritionForMeal(food, 2, addOns);
  assert.deepEqual(original, { calories: 253, protein: 5.1, carbs: 0, fat: 0 });
  let entry = { id: 'entry', foodId: 'food', foodName: 'Food', servingSize: '1 serving', locationName: 'Hopkins Café', servings: 2, nutrition: original, nutritionPerServing: mealNutritionBasis(food, addOns), addOns };
  for (const servings of [1, 2, 0.25, 2, 3, 2]) {
    entry = resizeMealEntry(entry, servings);
    assert.deepEqual(entry.nutrition, nutritionForMeal(food, servings, addOns));
  }
  assert.deepEqual(entry.nutrition, original);
});

test('Levering customization is limited to builder items or stations', () => {
  const { addOnsForFood, missingAddOnNutrition } = require('../lib/customization.ts');
  const base = { id: 'base', name: 'Chef special', locationId: 'site-1', locationName: 'Levering Kitchens', stationName: 'Build Your Own', mealPeriods: ['Lunch'], addOns: [] };
  const chicken = { ...base, id: 'chicken', name: 'Grilled chicken', stationName: 'Build your own', servingSize: '3 oz', calories: 120, protein: 24, carbs: 0, fat: 2, missingNutrition: [] };
  const tofu = { ...base, id: 'tofu', name: 'Tofu', stationName: 'Build Your Own', servingSize: '3 oz', calories: 0, protein: 0, carbs: 0, fat: 0, missingNutrition: ['calories', 'protein', 'carbs', 'fat'] };
  const unrelated = { ...chicken, id: 'other', locationId: 'hopkins-cafe', name: 'Chicken' };
  const options = addOnsForFood(base, [base, chicken, tofu, unrelated]);
  assert.deepEqual(options.map((option) => option.name), ['Grilled chicken', 'Tofu']);
  assert.equal(options[0].category, 'protein');
  assert.equal(options[1].category, 'protein');
  assert.deepEqual(missingAddOnNutrition(options[1], [base, chicken, tofu]), ['calories', 'protein', 'carbs', 'fat']);

  const entree = { ...base, id: 'entree', stationName: 'Hot Entrées' };
  const entreeProtein = { ...chicken, id: 'entree-protein', stationName: 'Hot Entrées' };
  assert.deepEqual(addOnsForFood(entree, [entree, entreeProtein]), []);
});

test('duplicate menu rows retain station and add-on metadata', async () => {
  const { fetchTodayMenu } = require('../lib/nutrislice.ts');
  global.window = { location: { origin: 'https://jaydenhchen.github.io' } };
  global.localStorage = { getItem: () => null, setItem() {} };
  global.fetch = async () => json({
    ok: true,
    schemaVersion: 6,
    source: 'hopkins-nutrislice',
    date: '2026-10-21',
    fetchedAt: new Date().toISOString(),
    partial: false,
    foods: [
      { id: 'first', legacyIds: ['legacy-lunch'], name: 'Chef bowl', locationId: 'site-1', locationName: 'Levering Kitchens', mealPeriods: ['Lunch'], menuType: 'lunch-a', servingSize: '1 bowl', calories: 400, protein: 20, carbs: 50, fat: 10, allergens: [], tags: [], updatedAt: '2026-10-21' },
      { id: 'second', legacyIds: ['legacy-dinner'], name: 'Chef bowl', locationId: 'site-1', locationName: 'Levering Kitchens', mealPeriods: ['Dinner'], menuType: 'lunch-b', stationName: 'Build Your Own', addOns: [{ id: 'avocado', name: 'Avocado', category: 'topping', servingSize: '1 scoop', calories: 80, protein: 1, carbs: 4, fat: 7 }], calories: 400, protein: 20, carbs: 50, fat: 10, allergens: [], tags: [], updatedAt: '2026-10-21' },
    ],
    locations: [{ id: 'site-1', name: 'Levering Kitchens', menuUrl: 'https://hopkinsdining.nutrislice.com/menu/site-1', status: 'available' }],
  });
  const menu = await fetchTodayMenu('2026-10-21');
  assert.equal(menu.foods.length, 1);
  assert.equal(menu.foods[0].stationName, 'Build Your Own');
  assert.deepEqual(menu.foods[0].addOns?.map((addOn) => addOn.name), ['Avocado']);
  assert.deepEqual(menu.foods[0].legacyIds, ['legacy-lunch', 'legacy-dinner']);
});

test('Planters added-sugar values drive the no-added-sugar filter', () => {
  const { FOODS } = require('../lib/catalog.ts');
  const { matchesFoodTags } = require('../lib/food-filters.ts');
  const peanuts = FOODS.filter((food) => food.locationId === 'charles-market');
  assert.deepEqual(peanuts.map((food) => food.addedSugar), [0, 1, 4, 0, 3]);
  assert.deepEqual(peanuts.filter((food) => matchesFoodTags(food, ['no-added-sugar'])).map((food) => food.name), [
    'PLANTERS Salted Peanuts',
    'PLANTERS HEAT Peanuts',
  ]);
});

function cacheFixture() {
  const hc = normalizeMenuItem({ food }, HOPKINS_LOCATIONS[0], 'hopkins-cafe-lunch', '2026-10-21');
  const levering = normalizeMenuItem({ food }, HOPKINS_LOCATIONS[2], 'lunch', '2026-10-21');
  return { ok: true, schemaVersion: 6, source: 'hopkins-nutrislice', date: '2026-10-21', fetchedAt: new Date(Date.now() - 3600000).toISOString(), partial: false,
    foods: [hc, levering], locations: HOPKINS_LOCATIONS.map((location) => ({ ...location, status: [hc.locationId, levering.locationId].includes(location.id) ? 'available' : 'empty' })), errors: [] };
}

test('a partial live request preserves cached failed locations without extending their age', async () => {
  const { fetchTodayMenu } = require('../lib/nutrislice.ts');
  const stored = cacheFixture();
  let saved = JSON.stringify(stored);
  global.window = { location: { origin: 'https://jaydenhchen.github.io' } };
  global.localStorage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const live = { ...stored, fetchedAt: new Date().toISOString(), partial: true, foods: [stored.foods[1]], locations: stored.locations.map((location) => location.id === 'hopkins-cafe' ? { ...location, status: 'unavailable' } : location), errors: [{ locationId: 'hopkins-cafe', mealType: 'hopkins-cafe-lunch', message: 'upstream status 429' }] };
  global.fetch = async (url) => url.startsWith('https:') ? json(live) : json({}, 404);
  for (let index = 0; index < 2; index++) {
    const menu = await fetchTodayMenu('2026-10-21');
    assert.equal(menu.foods.length, 2);
    assert.equal(menu.mode, 'cached');
    assert.equal(menu.fetchedAt, stored.fetchedAt);
    assert.equal(menu.locations.find((location) => location.id === 'hopkins-cafe').cached, true);
    assert.equal(JSON.parse(saved).foods.length, 2);
  }
});

test('failed individual meals can use saved foods while published-empty locations stay empty', async () => {
  const { fetchTodayMenu } = require('../lib/nutrislice.ts');
  const stored = cacheFixture();
  let saved = JSON.stringify(stored);
  global.window = { location: { origin: 'https://jaydenhchen.github.io' } };
  global.localStorage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const breakfast = normalizeMenuItem({ food }, HOPKINS_LOCATIONS[0], 'hopkins-cafe-breakfast', '2026-10-21');
  let live = { ...stored, fetchedAt: new Date().toISOString(), partial: true, foods: [breakfast, stored.foods[1]], errors: [{ locationId: 'hopkins-cafe', mealType: 'hopkins-cafe-lunch', message: 'upstream status 429' }] };
  global.fetch = async (url) => url.startsWith('https:') ? json(live) : json({}, 404);
  const menu = await fetchTodayMenu('2026-10-21');
  assert.equal(menu.foods.length, 2);
  assert.equal(menu.mode, 'cached');
  live = { ...live, partial: false, foods: [stored.foods[1]], errors: [], locations: stored.locations.map((location) => location.id === 'hopkins-cafe' ? { ...location, status: 'empty' } : location) };
  const empty = await fetchTodayMenu('2026-10-21');
  assert.equal(empty.foods.length, 1);
  assert.equal(empty.mode, 'live');
});

test('GitHub Pages fallback respects base paths, dates, and provenance', async () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/macrotracker';
  const { fetchTodayMenu } = require('../lib/nutrislice.ts');
  global.window = { location: { origin: 'https://jaydenhchen.github.io' } };
  global.localStorage = { getItem: () => null, setItem() {} };
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url);
    if (url.startsWith('https:')) return json({}, 502);
    return json({ ok: true, schemaVersion: 6, source: 'hopkins-nutrislice', date: '2026-10-21', fetchedAt: new Date().toISOString(), partial: false, foods: [], locations: [] });
  };
  const menu = await fetchTodayMenu('2026-10-21');
  assert.equal(menu.mode, 'cached');
  assert.equal(requests[1], '/macrotracker/api/menus/2026-10-21.json');
  global.fetch = async () => json({ ok: true, foods: [{ name: 'Invented food' }] });
  await assert.rejects(fetchTodayMenu('2026-10-21'));
  delete process.env.NEXT_PUBLIC_BASE_PATH;
});

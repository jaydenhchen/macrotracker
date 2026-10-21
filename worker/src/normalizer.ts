export type NutrisliceLocation = {
  id: string;
  name: string;
  school: string;
  menuUrl: string;
};

export type MenuTarget = {
  location: NutrisliceLocation;
  school: string;
  mealTypes: string[];
  mealNames: Record<string, string>;
};

export type NormalizedFood = {
  id: string;
  name: string;
  description: string;
  locationId: string;
  locationName: string;
  menuUrl: string;
  mealPeriods: string[];
  menuType: string;
  menuTypes: string[];
  servingSize: string;
  allergens: string[];
  tags: string[];
  addOns?: NormalizedFoodAddOn[];
  missingNutrition: string[];
  stationName?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  addedSugar: number | null;
  updatedAt: string;
};

export type NormalizedFoodAddOn = {
  id: string;
  name: string;
  category: "protein" | "topping";
  servingSize: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type NormalizedMeal = {
  id: string;
  name: string;
  foods: NormalizedFood[];
};

export type NormalizedLocation = NutrisliceLocation & {
  meals: NormalizedMeal[];
  status: "available" | "empty" | "unavailable";
};

export type MenuResponse = {
  ok: true;
  schemaVersion: 6;
  date: string;
  fetchedAt: string;
  source: "hopkins-nutrislice";
  partial: boolean;
  locations: NormalizedLocation[];
  foods: NormalizedFood[];
  errors: Array<{ locationId: string; mealType: string; message: string }>;
};

export const HOPKINS_LOCATIONS: readonly NutrisliceLocation[] = [
  { id: "hopkins-cafe", name: "Hopkins Café", school: "hopkins-cafe", menuUrl: "https://hopkinsdining.nutrislice.com/menu/hopkins-cafe" },
  { id: "nolans-on-33rd", name: "Nolan’s on 33rd", school: "nolans-on-33rd", menuUrl: "https://hopkinsdining.nutrislice.com/menu/nolans-on-33rd" },
  { id: "levering-kitchens", name: "Levering Kitchens", school: "site-1", menuUrl: "https://hopkinsdining.nutrislice.com/menu/site-1" },
  { id: "levering-cafe", name: "Levering Café", school: "levering-cafe", menuUrl: "https://hopkinsdining.nutrislice.com/menu/levering-cafe" },
  { id: "peabody-institute", name: "Peabody Dining Hall", school: "peabody-institute", menuUrl: "https://hopkinsdining.nutrislice.com/menu/peabody-institute" },
];

export const MENU_TYPES = ["breakfast", "brunch", "lunch", "dinner"] as const;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function directoryEntries(payload: unknown) {
  if (Array.isArray(payload)) return arrayRecords(payload);
  const root = record(payload);
  if (!root) return [];
  for (const key of ["value", "schools", "locations", "results", "data"]) {
    if (Array.isArray(root[key])) return arrayRecords(root[key]);
  }
  return [];
}

/** School and menu slugs are identifiers, never display labels to shorten or guess. */
export function resolveMenuTargets(payload: unknown): MenuTarget[] {
  const targets = new Map<string, MenuTarget>();
  for (const entry of directoryEntries(payload)) {
    const school = stringValue(entry.slug);
    const name = stringValue(entry.name);
    if (!school || !name || !/^[a-zA-Z0-9_-]+$/.test(school)) continue;
    const known = HOPKINS_LOCATIONS.find((location) =>
      location.school === school || normalizedText(location.name) === normalizedText(name));
    const location = {
      id: known?.id ?? school,
      name: known?.name ?? name,
      school,
      menuUrl: `https://hopkinsdining.nutrislice.com/menu/${encodeURIComponent(school)}`,
    };
    const rawMenus = entry.active_menu_types ?? entry.menu_types;
    if (!Array.isArray(rawMenus)) continue;
    const mealNames: Record<string, string> = Object.create(null);
    for (const value of rawMenus) {
      const menu = record(value);
      const slug = stringValue(typeof value === "string" ? value : menu?.slug);
      if (slug && /^[a-zA-Z0-9_-]+$/.test(slug)) mealNames[slug] = stringValue(menu?.name) || titleCase(slug);
    }
    targets.set(location.id, { location, school, mealTypes: Object.keys(mealNames), mealNames });
  }
  return Array.from(targets.values());
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function validNutritionValue(value: unknown) {
  return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function dateMatches(value: unknown, date: string) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.slice(0, 10) === date) return true;
  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  return Boolean(slashDate && `${slashDate[3]}-${slashDate[1].padStart(2, "0")}-${slashDate[2].padStart(2, "0")}` === date);
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
}

function withStations(items: JsonRecord[]): JsonRecord[] {
  let stationName = "";
  return items.map((item) => {
    if (item.is_section_title || item.is_station_header) stationName = stringValue(item.text);
    return { ...item, stationName };
  });
}

function itemsFromContainer(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return arrayRecords(value);
  const container = record(value);
  if (!container) return [];
  for (const key of ["menu_items", "menuItems", "items", "food_items", "foods"]) {
    if (key in container && !Array.isArray(container[key])) throw new Error("Nutrislice returned malformed menu items for this date");
    const items = arrayRecords(container[key]);
    if (Array.isArray(container[key]) && items.length !== container[key].length) throw new Error("Nutrislice returned invalid menu item records");
    if (items.length || Array.isArray(container[key])) return withStations(items);
  }
  for (const key of ["menu", "day"]) {
    const nested = itemsFromContainer(container[key]);
    if (nested.length) return nested;
  }
  return [];
}

/** Nutrislice's week response is usually { days: { ... } }, but some menus return a direct item array. */
export function extractMenuItems(payload: unknown, date: string): JsonRecord[] {
  if (Array.isArray(payload)) {
    const items = arrayRecords(payload);
    const datedItems = items.filter((item) => typeof item.date === "string");
    return datedItems.length ? datedItems.filter((item) => dateMatches(item.date, date)) : items;
  }

  const root = record(payload);
  if (!root) return [];

  const days = root.days;
  if (days) {
    const dayEntries = Array.isArray(days)
      ? days.map((day, index) => [String(index), day] as const)
      : Object.entries(record(days) ?? {});
    const matchingDay = dayEntries.find(([key, value]) => key === date || dateMatches(record(value)?.date, date));
    return matchingDay ? itemsFromContainer(matchingDay[1]) : [];
  }

  const items = itemsFromContainer(root);
  const datedItems = items.filter((item) => typeof item.date === "string");
  return datedItems.length ? datedItems.filter((item) => dateMatches(item.date, date)) : items;
}

function iconNames(food: JsonRecord) {
  const icons = record(food.icons);
  const candidates = [icons?.food_icons, icons?.myplate_icons, food.food_icons, food.tags];
  return candidates.flatMap((candidate) => Array.isArray(candidate) ? candidate.map((icon) => {
    if (typeof icon === "string") return icon.trim();
    const iconRecord = record(icon);
    return stringValue(iconRecord?.synced_name || iconRecord?.name);
  }) : []).filter(Boolean);
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item.trim() : stringValue(record(item)?.name)).filter(Boolean);
}

function addOnRecords(food: JsonRecord, item: JsonRecord) {
  const sources = [
    food.nested_foods,
    food.options,
    food.add_ons,
    food.addons,
    food.sides,
    item.nested_foods,
    item.options,
    item.add_ons,
    item.addons,
    item.sides,
  ];
  return sources.flatMap((source) => {
    if (Array.isArray(source)) return arrayRecords(source);
    const container = record(source);
    if (!container) return [];
    return ["choices", "items", "foods", "options", "nested_foods"].flatMap((key) => arrayRecords(container[key]));
  });
}

function addOnCategory(value: JsonRecord) {
  const text = `${stringValue(value.category)} ${stringValue(value.food_category)} ${stringValue(value.type)} ${stringValue(value.name)}`.toLowerCase();
  return /protein|chicken|steak|beef|pork|turkey|fish|tofu|tempeh|falafel|egg/.test(text) ? "protein" : "topping";
}

function normalizeFoodAddOns(item: JsonRecord, food: JsonRecord, parentId: string): NormalizedFoodAddOn[] {
  const seen = new Set<string>();
  return addOnRecords(food, item).flatMap((candidate, index) => {
    const raw = record(candidate?.food) ?? candidate;
    const name = stringValue(raw.name ?? candidate.text);
    if (!name) return [];
    const rawId = raw.id ?? raw.synced_id ?? candidate.id ?? `${parentId}-addon-${index}`;
    const id = `${parentId}-addon-${String(rawId)}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const nutrition = record(raw.rounded_nutrition_info) ?? record(raw.nutrition_info) ?? record(candidate.rounded_nutrition_info) ?? {};
    if ([nutrition.calories ?? raw.calories, nutrition.g_protein ?? raw.protein, nutrition.g_carbs ?? raw.carbs, nutrition.g_fat ?? raw.fat].some((value) => !validNutritionValue(value))) return [];
    const servingInfo = record(raw.serving_size_info) ?? record(candidate.serving_size_info) ?? {};
    return [{
      id,
      name,
      category: addOnCategory(raw),
      servingSize: `${String(servingInfo.serving_size_amount ?? raw.serving_size_amount ?? candidate.serving_size_amount ?? "1")} ${String(servingInfo.serving_size_unit ?? raw.serving_size_unit ?? candidate.serving_size_unit ?? "serving")}`.trim(),
      calories: numberValue(nutrition.calories ?? raw.calories ?? candidate.calories),
      protein: numberValue(nutrition.g_protein ?? raw.protein ?? candidate.protein),
      carbs: numberValue(nutrition.g_carbs ?? raw.carbs ?? candidate.carbs),
      fat: numberValue(nutrition.g_fat ?? raw.fat ?? candidate.fat),
    }];
  });
}

function titleCase(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const ALLERGEN_NAMES = new Set(["milk", "wheat", "soy", "egg", "eggs", "fish", "shellfish", "tree nuts", "peanuts", "sesame"]);

export function normalizeMenuItem(item: JsonRecord, location: NutrisliceLocation, mealType: string, date: string): NormalizedFood | null {
  if (item.is_section_title === true || item.is_station_header === true || item.is_holiday === true) return null;
  const rawFood = record(item.food) ?? (typeof item.name === "string" ? item : null);
  if (!rawFood) return null;
  const name = stringValue(rawFood.name);
  if (!name) return null;

  const nutrition = record(rawFood.rounded_nutrition_info) ?? record(rawFood.nutrition_info) ?? record(item.rounded_nutrition_info) ?? {};
  const nutritionSources = [
    record(rawFood.rounded_nutrition_info), record(rawFood.nutrition_info),
    record(item.rounded_nutrition_info), record(item.nutrition_info),
  ].filter((source): source is JsonRecord => Boolean(source));
  const rawAddedSugar = nutritionSources.flatMap((source) => [source.g_added_sugar, source.added_sugar]).find(validNutritionValue)
    ?? rawFood.added_sugar ?? item.added_sugar;
  const addedSugar = validNutritionValue(rawAddedSugar) ? Number(rawAddedSugar) : null;
  const servingInfo = record(rawFood.serving_size_info) ?? record(item.serving_size_info) ?? {};
  const icons = iconNames({ ...item, ...rawFood });
  const explicitAllergens = stringList(rawFood.allergens ?? item.allergens ?? rawFood.allergen_icons);
  const allergens = Array.from(new Set([...explicitAllergens, ...icons.filter((icon) => ALLERGEN_NAMES.has(icon.toLowerCase()))]));
  const sourceTags = [...icons, stringValue(rawFood.food_category ?? item.category), ...stringList(item.tags)];
  const tags = Array.from(new Set([
    ...sourceTags.filter((tag) => !(addedSugar !== null && addedSugar > 0 && /no added sugar/i.test(tag))),
    ...(addedSugar === 0 ? ["No Added Sugar"] : []),
  ].filter(Boolean)));
  const rawId = rawFood.id ?? rawFood.synced_id ?? item.id ?? `${location.id}-${slug(name)}`;
  const addOns = normalizeFoodAddOns(item, rawFood, String(rawId));
  const servingAmount = servingInfo.serving_size_amount ?? rawFood.serving_size_amount ?? item.serving_size_amount ?? "1";
  const servingUnit = servingInfo.serving_size_unit ?? rawFood.serving_size_unit ?? item.serving_size_unit ?? "serving";
  const mealName = titleCase(mealType);
  const missingNutrition = Object.entries({ calories: nutrition.calories ?? rawFood.calories, protein: nutrition.g_protein ?? rawFood.protein, carbs: nutrition.g_carbs ?? rawFood.carbs, fat: nutrition.g_fat ?? rawFood.fat }).filter(([, value]) => !validNutritionValue(value)).map(([key]) => key);

  return {
    // Nutrislice repeats the same food object across meal types and stations.
    // Use location + normalized display name as the catalog identity.
    id: `nutrislice-${location.id}-${slug(normalizedText(name)) || String(rawId)}`,
    name,
    description: stringValue(rawFood.description ?? rawFood.subtext) || `${mealName} menu item at ${location.name}.`,
    locationId: location.id,
    locationName: location.name,
    menuUrl: location.menuUrl,
    mealPeriods: [mealName],
    menuType: mealType,
    menuTypes: [mealType],
    servingSize: `${String(servingAmount)} ${String(servingUnit)}`.trim(),
    allergens,
    tags,
    ...(addOns.length ? { addOns } : {}),
    calories: numberValue(nutrition.calories ?? rawFood.calories ?? item.calories),
    protein: numberValue(nutrition.g_protein ?? rawFood.protein ?? item.protein),
    carbs: numberValue(nutrition.g_carbs ?? rawFood.carbs ?? item.carbs),
    fat: numberValue(nutrition.g_fat ?? rawFood.fat ?? item.fat),
    addedSugar,
    missingNutrition,
    stationName: stringValue(item.stationName) || undefined,
    updatedAt: date,
  };
}

export type MenuResult = { location: NutrisliceLocation; mealType: string; mealName?: string; menuUrl?: string; items: JsonRecord[] };

export function makeMenuResponse(date: string, results: MenuResult[], errors: MenuResponse["errors"], fetchedAt: string, targets: MenuTarget[] = []): MenuResponse {
  const foods = results.flatMap((result) => result.items.flatMap((item) => {
    const food = normalizeMenuItem(item, result.location, result.mealType, date);
    return food ? [{ ...food, menuUrl: result.menuUrl ?? food.menuUrl, mealPeriods: [result.mealName ?? titleCase(result.mealType)] }] : [];
  }));
  const uniqueFoods = Array.from(foods.reduce((unique, food) => {
    const key = `${food.locationId}:${normalizedText(food.name)}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, food);
      return unique;
    }
    const preferNewNutrition = food.missingNutrition.length < existing.missingNutrition.length;
    unique.set(key, {
      ...(preferNewNutrition ? food : existing),
      id: existing.id,
      // Preserve station context if an earlier duplicate came from a menu response
      // without section headings; build-your-own choices depend on this grouping.
      stationName: existing.stationName || food.stationName,
      mealPeriods: Array.from(new Set([...existing.mealPeriods, ...food.mealPeriods])),
      menuTypes: Array.from(new Set([...existing.menuTypes, ...food.menuTypes])),
      allergens: Array.from(new Set([...existing.allergens, ...food.allergens])),
      tags: Array.from(new Set([...existing.tags, ...food.tags].filter((tag) => !(food.addedSugar !== null || existing.addedSugar !== null) || !/no added sugar/i.test(tag)).concat((existing.addedSugar ?? food.addedSugar) === 0 && Math.max(existing.addedSugar ?? 0, food.addedSugar ?? 0) === 0 ? ["No Added Sugar"] : []))),
      addedSugar: existing.addedSugar === null ? food.addedSugar : food.addedSugar === null ? existing.addedSugar : Math.max(existing.addedSugar, food.addedSugar),
      addOns: Array.from(new Map([...(existing.addOns ?? []), ...(food.addOns ?? [])].map((addOn) => [normalizedText(addOn.name), addOn])).values()),
    });
    return unique;
  }, new Map<string, NormalizedFood>()).values());
  const allLocations = new Map([...HOPKINS_LOCATIONS, ...targets.map((target) => target.location), ...results.map((result) => result.location)].map((location) => [location.id, location]));
  const locations: NormalizedLocation[] = Array.from(allLocations.values()).map((location) => {
    const menus = results.filter((result) => result.location.id === location.id);
    const available = uniqueFoods.some((food) => food.locationId === location.id);
    const failed = !targets.some((target) => target.location.id === location.id) || errors.some((error) => error.locationId === location.id || error.locationId === "proxy");
    return {
      ...location,
      status: available ? "available" : failed ? "unavailable" : "empty",
      meals: menus.map((menu) => ({
        id: `${location.id}-${menu.mealType}`,
        name: menu.mealName ?? titleCase(menu.mealType),
        foods: uniqueFoods.filter((food) => food.locationId === location.id && food.menuTypes.includes(menu.mealType)),
      })),
    };
  });
  return { ok: true, schemaVersion: 6, date, fetchedAt, source: "hopkins-nutrislice", partial: errors.length > 0, locations, foods: uniqueFoods, errors };
}

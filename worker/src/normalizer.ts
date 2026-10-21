export type NutrisliceLocation = {
  id: string;
  name: string;
  school: string;
  menuUrl: string;
};

export type MenuTarget = {
  location: NutrisliceLocation;
  school: string;
  schools: string[];
  mealTypes: string[];
  menuTypeUrls: Record<string, string[]>;
  menuTypeValues: Record<string, string>;
};

export type NormalizedFood = {
  id: string;
  name: string;
  description: string;
  locationId: string;
  locationName: string;
  menuUrl: string;
  mealPeriods: string[];
  servingSize: string;
  allergens: string[];
  tags: string[];
  addOns?: NormalizedFoodAddOn[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
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
};

export type MenuResponse = {
  ok: true;
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
  { id: "levering-cafe", name: "Levering Café", school: "levering-cafe/cafe", menuUrl: "https://hopkinsdining.nutrislice.com/menu/levering-cafe/cafe/" },
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

function slugValue(value: unknown) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function schoolSlug(value: unknown) {
  const raw = stringValue(value);
  const menuPath = /\/menu\/(.+?)(?:\/$|$)/i.exec(raw)?.[1];
  const path = menuPath || raw.replace(/^https?:\/\/[^/]+\//i, "");
  return path.split("/").filter(Boolean).map(slugValue).filter(Boolean).join("/");
}

function menuTypeSlug(value: unknown) {
  const slug = slugValue(value);
  const match = /(?:^|-)(breakfast|brunch|lunch|dinner|late-night|all-day)(?:-(\d+))?$/.exec(slug);
  return match ? `${match[1]}${match[2] ? `-${match[2]}` : ""}` : slug;
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function directoryEntries(payload: unknown) {
  if (Array.isArray(payload)) return arrayRecords(payload);
  const root = record(payload);
  if (!root) return [];
  for (const key of ["value", "schools", "locations", "sites", "results", "data"]) {
    const entries = arrayRecords(root[key]);
    if (entries.length || Array.isArray(root[key])) return entries;
  }
  return [];
}

function directorySchool(entry: JsonRecord) {
  const nested = record(entry.school);
  const merged = nested ? { ...entry, ...nested } : entry;
  const slug = schoolSlug(merged.slug ?? merged.school_slug ?? merged.school ?? merged.path ?? merged.id);
  const name = stringValue(merged.name ?? merged.title ?? merged.display_name ?? merged.label);
  return { merged, slug, name };
}

function menuTypeUrlTemplates(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === "string") {
    const normalized = value.trim();
    return /\/menu\/api\//i.test(normalized) && /\{(?:date|year|month|day|menu_type|menu-type|school)/i.test(normalized)
      ? [normalized]
      : [];
  }
  const item = record(value);
  if (!item) return [];
  return Object.entries(item).flatMap(([key, nested]) => {
    if (!/url|template|api/i.test(key)) return [];
    return menuTypeUrlTemplates(nested, depth + 1);
  });
}

type DirectoryMealType = { slug: string; upstreamSlug: string; urls: string[] };

function directoryMealTypeTargets(entry: JsonRecord): DirectoryMealType[] {
  const raw = entry.active_menu_types ?? entry.menu_types ?? entry.menuTypes ?? entry.menu_type_options ?? entry.menus;
  if (!Array.isArray(raw)) return [];
  const bySlug = new Map<string, DirectoryMealType>();
  for (const value of raw) {
    const item = record(value);
    const upstreamSlug = stringValue(typeof value === "string" ? value : item?.slug ?? item?.menu_type ?? item?.id ?? item?.name ?? item?.title);
    const slug = menuTypeSlug(upstreamSlug);
    if (!slug) continue;
    const existing = bySlug.get(slug);
    const urls = menuTypeUrlTemplates(value);
    bySlug.set(slug, { slug, upstreamSlug: existing?.upstreamSlug || upstreamSlug, urls: Array.from(new Set([...(existing?.urls ?? []), ...urls])) });
  }
  return Array.from(bySlug.values());
}

const LOCATION_ALIASES: Record<string, string[]> = {
  "hopkins-cafe": ["hopkins cafe", "fresh food cafe", "ffc"],
  "nolans-on-33rd": ["nolan", "nolan's", "nolans", "nolans on 33rd", "nolan's on 33rd"],
  "levering-kitchens": ["levering kitchens", "levering kitchen"],
  "levering-cafe": ["levering cafe", "levering café"],
  "peabody-institute": ["peabody", "peabody institute", "peabody dining hall"],
};

const LOCATION_SCHOOL_ALIASES: Record<string, string[]> = {
  "hopkins-cafe": ["hopkins-cafe", "fresh-food-cafe", "ffc"],
  "nolans-on-33rd": ["nolans-on-33rd", "nolans", "nolan"],
  "levering-kitchens": ["site-1", "levering-kitchens", "levering-kitchen"],
  "levering-cafe": ["levering-cafe/cafe", "levering-cafe", "cafe"],
  "peabody-institute": ["peabody-institute", "peabody", "peabody-dining-hall"],
};

function matchScore(location: NutrisliceLocation, entry: { slug: string; name: string }) {
  const candidates = [location.name, location.school, ...(LOCATION_ALIASES[location.id] ?? [])].map(normalizedText).filter(Boolean);
  const slug = normalizedText(entry.slug);
  const name = normalizedText(entry.name);
  return candidates.reduce((score, candidate) => {
    if (slug === candidate || name === candidate) return Math.max(score, 100);
    if (slug.includes(candidate) || name.includes(candidate)) return Math.max(score, 70);
    if (candidate.includes(slug) || candidate.includes(name)) return Math.max(score, 50);
    return score;
  }, 0);
}

/** Resolve current school slugs and menu types from Nutrislice's directory when available. */
export function resolveMenuTargets(payload: unknown): MenuTarget[] {
  const entries = directoryEntries(payload).map(directorySchool);
  return HOPKINS_LOCATIONS.map((location) => {
    const match = entries
      .map((entry) => ({ ...entry, score: matchScore(location, entry) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0];
    const schools = Array.from(new Set([
      match?.slug,
      location.school,
      ...(LOCATION_SCHOOL_ALIASES[location.id] ?? []),
    ].filter((value): value is string => Boolean(value))));
    const school = schools[0] || location.school;
    const directoryTypes = match ? directoryMealTypeTargets(match.merged) : [];
    const mealTypes = directoryTypes.map((item) => item.slug);
    const menuTypeUrls = Object.fromEntries(directoryTypes.map((item) => [item.slug, item.urls]));
    const menuTypeValues = Object.fromEntries(directoryTypes.map((item) => [item.slug, item.upstreamSlug]));
    return { location, school, schools, mealTypes: mealTypes.length ? mealTypes : [...MENU_TYPES], menuTypeUrls, menuTypeValues };
  });
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
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

function itemsFromContainer(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return arrayRecords(value);
  const container = record(value);
  if (!container) return [];
  for (const key of ["menu_items", "menuItems", "items", "food_items", "foods"]) {
    const items = arrayRecords(container[key]);
    if (items.length || Array.isArray(container[key])) return items;
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
    return stringValue(iconRecord?.name ?? iconRecord?.synced_name);
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
  const rawFood = record(item.food) ?? item;
  const name = stringValue(rawFood.name ?? item.text);
  if (!name) return null;

  const nutrition = record(rawFood.rounded_nutrition_info) ?? record(rawFood.nutrition_info) ?? record(item.rounded_nutrition_info) ?? {};
  const servingInfo = record(rawFood.serving_size_info) ?? record(item.serving_size_info) ?? {};
  const icons = iconNames({ ...item, ...rawFood });
  const explicitAllergens = stringList(rawFood.allergens ?? item.allergens ?? rawFood.allergen_icons);
  const allergens = Array.from(new Set([...explicitAllergens, ...icons.filter((icon) => ALLERGEN_NAMES.has(icon.toLowerCase()))]));
  const tags = Array.from(new Set([...icons, stringValue(rawFood.food_category ?? item.category), ...stringList(item.tags)].filter(Boolean)));
  const rawId = rawFood.id ?? rawFood.synced_id ?? item.id ?? `${location.id}-${mealType}-${slug(name)}`;
  const addOns = normalizeFoodAddOns(item, rawFood, String(rawId));
  const servingAmount = servingInfo.serving_size_amount ?? rawFood.serving_size_amount ?? item.serving_size_amount ?? "1";
  const servingUnit = servingInfo.serving_size_unit ?? rawFood.serving_size_unit ?? item.serving_size_unit ?? "serving";
  const mealName = titleCase(mealType);

  return {
    id: `nutrislice-${location.id}-${String(rawId)}-${mealType}`,
    name,
    description: stringValue(rawFood.description ?? rawFood.subtext) || `${mealName} menu item at ${location.name}.`,
    locationId: location.id,
    locationName: location.name,
    menuUrl: location.menuUrl,
    mealPeriods: [mealName],
    servingSize: `${String(servingAmount)} ${String(servingUnit)}`.trim(),
    allergens,
    tags,
    ...(addOns.length ? { addOns } : {}),
    calories: numberValue(nutrition.calories ?? rawFood.calories ?? item.calories),
    protein: numberValue(nutrition.g_protein ?? rawFood.protein ?? item.protein),
    carbs: numberValue(nutrition.g_carbs ?? rawFood.carbs ?? item.carbs),
    fat: numberValue(nutrition.g_fat ?? rawFood.fat ?? item.fat),
    updatedAt: date,
  };
}

export function makeMenuResponse(date: string, results: Array<{ location: NutrisliceLocation; mealType: string; items: JsonRecord[] }>, errors: MenuResponse["errors"], fetchedAt: string): MenuResponse {
  const foods = results.flatMap((result) => result.items.map((item) => normalizeMenuItem(item, result.location, result.mealType, date)).filter((item): item is NormalizedFood => Boolean(item)));
  const uniqueFoods = Array.from(new Map(foods.map((food) => [food.id, food])).values());
  const locations = HOPKINS_LOCATIONS.map((location) => ({
    ...location,
    meals: Array.from(new Set([
      ...MENU_TYPES,
      ...results.filter((result) => result.location.id === location.id).map((result) => result.mealType),
    ])).map((mealType) => ({
      id: `${location.id}-${mealType}`,
      name: titleCase(mealType),
      foods: uniqueFoods.filter((food) => food.locationId === location.id && food.mealPeriods.includes(titleCase(mealType))),
    })),
  }));
  return { ok: true, date, fetchedAt, source: "hopkins-nutrislice", partial: errors.length > 0, locations, foods: uniqueFoods, errors };
}

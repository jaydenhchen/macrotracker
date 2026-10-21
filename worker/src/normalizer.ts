export type NutrisliceLocation = {
  id: string;
  name: string;
  school: string;
  menuUrl: string;
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
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  updatedAt: string;
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
  const icons = iconNames(rawFood);
  const explicitAllergens = stringList(rawFood.allergens ?? item.allergens ?? rawFood.allergen_icons);
  const allergens = Array.from(new Set([...explicitAllergens, ...icons.filter((icon) => ALLERGEN_NAMES.has(icon.toLowerCase()))]));
  const tags = Array.from(new Set([...icons, stringValue(rawFood.food_category ?? item.category)].filter(Boolean)));
  const rawId = rawFood.id ?? rawFood.synced_id ?? item.id ?? `${location.id}-${mealType}-${slug(name)}`;
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
    meals: MENU_TYPES.map((mealType) => ({
      id: `${location.id}-${mealType}`,
      name: titleCase(mealType),
      foods: uniqueFoods.filter((food) => food.locationId === location.id && food.mealPeriods.includes(titleCase(mealType))),
    })),
  }));
  return { ok: true, date, fetchedAt, source: "hopkins-nutrislice", partial: errors.length > 0, locations, foods: uniqueFoods, errors };
}

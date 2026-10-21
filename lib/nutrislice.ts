import { Food, FoodAddOn } from "./types";

export const NUTRISLICE_LOCATIONS = [
  { id: "hopkins-cafe", name: "Hopkins Café", school: "hopkins-cafe", menuUrl: "https://hopkinsdining.nutrislice.com/menu/hopkins-cafe" },
  { id: "nolans-on-33rd", name: "Nolan’s on 33rd", school: "nolans-on-33rd", menuUrl: "https://hopkinsdining.nutrislice.com/menu/nolans-on-33rd" },
  { id: "levering-kitchens", name: "Levering Kitchens", school: "site-1", menuUrl: "https://hopkinsdining.nutrislice.com/menu/site-1" },
  { id: "levering-cafe", name: "Levering Café", school: "levering-cafe/cafe", menuUrl: "https://hopkinsdining.nutrislice.com/menu/levering-cafe/cafe/" },
  { id: "peabody-institute", name: "Peabody Dining Hall", school: "peabody-institute", menuUrl: "https://hopkinsdining.nutrislice.com/menu/peabody-institute" },
] as const;

export const MENU_API_URL = (process.env.NEXT_PUBLIC_MENU_API_URL || "").trim().replace(/\/$/, "");

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeAddOn(value: unknown, index: number): FoodAddOn | null {
  const item = record(value);
  if (!item || typeof item.name !== "string" || !item.name.trim()) return null;
  const category = item.category === "protein" || item.category === "topping" ? item.category : "topping";
  return {
    id: typeof item.id === "string" && item.id ? item.id : `menu-addon-${index}-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: item.name.trim(),
    category,
    servingSize: typeof item.servingSize === "string" && item.servingSize ? item.servingSize : "1 serving",
    calories: numberValue(item.calories),
    protein: numberValue(item.protein),
    carbs: numberValue(item.carbs),
    fat: numberValue(item.fat),
  };
}

function normalizeFood(value: unknown): Food | null {
  const item = record(value);
  if (!item || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.locationId !== "string" || typeof item.locationName !== "string") return null;
  const addOns = Array.isArray(item.addOns) ? item.addOns.map(normalizeAddOn).filter((addOn): addOn is NonNullable<typeof addOn> => Boolean(addOn)) : [];
  return {
    id: item.id,
    name: item.name,
    description: typeof item.description === "string" ? item.description : "",
    locationId: item.locationId,
    locationName: item.locationName,
    menuUrl: typeof item.menuUrl === "string" ? item.menuUrl : undefined,
    mealPeriods: stringArray(item.mealPeriods),
    servingSize: typeof item.servingSize === "string" && item.servingSize ? item.servingSize : "1 serving",
    allergens: stringArray(item.allergens),
    tags: stringArray(item.tags),
    ...(addOns.length ? { addOns } : {}),
    calories: numberValue(item.calories),
    protein: numberValue(item.protein),
    carbs: numberValue(item.carbs),
    fat: numberValue(item.fat),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
  };
}

function menuEndpoint(date: string) {
  if (!MENU_API_URL) return null;
  const configured = MENU_API_URL.startsWith("/") && process.env.NEXT_PUBLIC_BASE_PATH && !MENU_API_URL.startsWith(`${process.env.NEXT_PUBLIC_BASE_PATH}/`)
    ? `${process.env.NEXT_PUBLIC_BASE_PATH}${MENU_API_URL}`
    : MENU_API_URL;
  const endpoint = new URL(configured, window.location.origin);
  endpoint.searchParams.set("date", date);
  return endpoint.toString();
}

export async function fetchTodayMenu(date: string, signal?: AbortSignal) {
  const endpoint = menuEndpoint(date);
  if (!endpoint) return { foods: [], source: "unconfigured", fetchedAt: "", requested: 0 };
  const response = await fetch(endpoint, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Menu proxy ${response.status}`);
  const payload = await response.json() as unknown;
  const root = record(payload);
  if (root?.ok !== true || root.date !== date || !Array.isArray(root.foods)) throw new Error("Menu proxy returned stale or malformed data");
  const foods = Array.isArray(root?.foods) ? root.foods.map(normalizeFood).filter((food): food is Food => Boolean(food)) : [];
  return {
    foods: Array.from(new Map(foods.map((food) => [food.id, food])).values()),
    source: typeof root?.source === "string" ? root.source : MENU_API_URL,
    fetchedAt: typeof root?.fetchedAt === "string" ? root.fetchedAt : new Date().toISOString(),
    requested: foods.length,
  };
}

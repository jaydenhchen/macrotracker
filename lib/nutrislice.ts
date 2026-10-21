import { Food, FoodAddOn } from "./types";

export const NUTRISLICE_LOCATIONS = [
  { id: "hopkins-cafe", name: "Hopkins Café", school: "hopkins-cafe", menuUrl: "https://hopkinsdining.nutrislice.com/menu/hopkins-cafe" },
  { id: "nolans-on-33rd", name: "Nolan’s on 33rd", school: "nolans-on-33rd", menuUrl: "https://hopkinsdining.nutrislice.com/menu/nolans-on-33rd" },
  { id: "levering-kitchens", name: "Levering Kitchens", school: "site-1", menuUrl: "https://hopkinsdining.nutrislice.com/menu/site-1" },
  { id: "levering-cafe", name: "Levering Café", school: "levering-cafe", menuUrl: "https://hopkinsdining.nutrislice.com/menu/levering-cafe" },
  { id: "peabody-institute", name: "Peabody Dining Hall", school: "peabody-institute", menuUrl: "https://hopkinsdining.nutrislice.com/menu/peabody-institute" },
] as const;

export const MENU_API_URL = (process.env.NEXT_PUBLIC_MENU_API_URL || "https://bluejay-fuel-menu-proxy.bjfuel.workers.dev/api/menu").trim().replace(/\/$/, "");

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value);
  return 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function validNutritionValue(value: unknown) {
  return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) && Number(value) >= 0;
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
  const missingNutrition = Array.from(new Set([...stringArray(item.missingNutrition), ...["calories", "protein", "carbs", "fat"].filter((key) => !validNutritionValue(item[key]))]));
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
    missingNutrition,
    stationName: typeof item.stationName === "string" ? item.stationName : undefined,
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

export type MenuLocation = { id: string; name: string; menuUrl: string; status: "available" | "empty" | "unavailable" };
export type MenuData = { foods: Food[]; locations: MenuLocation[]; fetchedAt: string; mode: "live" | "cached"; partial: boolean };

function parseMenu(payload: unknown, date: string, mode: MenuData["mode"]): MenuData {
  const root = record(payload);
  if (root?.ok !== true || root.source !== "hopkins-nutrislice" || root.schemaVersion !== 6 || root.date !== date || !Array.isArray(root.foods) || !Array.isArray(root.locations)) throw new Error("Stale or malformed menu");
  const fetchedAt = typeof root.fetchedAt === "string" ? root.fetchedAt : "";
  const age = Date.now() - Date.parse(fetchedAt);
  if (!Number.isFinite(age) || age < -300000 || age > 86400000) throw new Error("Menu cache has expired");
  const foods = root.foods.map(normalizeFood).filter((food): food is Food => Boolean(food));
  if (foods.length !== root.foods.length || foods.some((food) => food.updatedAt !== date)) throw new Error("Invalid menu foods");
  const locations = root.locations.map((value): MenuLocation => {
    const location = record(value);
    if (!location || typeof location.id !== "string" || typeof location.name !== "string" || typeof location.menuUrl !== "string") throw new Error("Invalid menu location");
    if (!["available", "empty", "unavailable"].includes(String(location.status))) throw new Error("Invalid menu status");
    return { id: location.id, name: location.name, menuUrl: location.menuUrl, status: location.status as MenuLocation["status"] };
  });
  if (foods.some((food) => !locations.some((location) => location.id === food.locationId))) throw new Error("Unknown food location");
  return { foods, locations, fetchedAt, mode, partial: root.partial === true };
}

async function readMenu(url: string, signal: AbortSignal | undefined, timeout: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Menu request ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function fetchTodayMenu(date: string, signal?: AbortSignal): Promise<MenuData> {
  const key = `bluejay-menu-v6:${date}`;
  const endpoint = menuEndpoint(date);
  if (endpoint) {
    try {
      const payload = await readMenu(endpoint, signal, 16000);
      const menu = parseMenu(payload, date, "live");
      try { localStorage.setItem(key, JSON.stringify(payload)); } catch { /* Storage may be full or disabled. */ }
      return menu;
    } catch {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    }
  }
  // Only genuine, dated Nutrislice data is eligible for fallback.
  const candidates: MenuData[] = [];
  try {
    const stored = localStorage.getItem(key);
    if (stored) candidates.push(parseMenu(JSON.parse(stored), date, "cached"));
  } catch { /* Invalid cache is ignored. */ }
  try {
    const path = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/menus/${date}.json`;
    candidates.push(parseMenu(await readMenu(path, signal, 5000), date, "cached"));
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }
  if (candidates.length) return candidates.sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))[0];
  throw new Error("Hopkins menus are unavailable for this date. Open the official menu or try again.");
}

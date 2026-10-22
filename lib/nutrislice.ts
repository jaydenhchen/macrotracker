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
  const legacyIds = Array.from(new Set(stringArray(item.legacyIds).filter((id) => id && id !== item.id)));
  return {
    id: item.id,
    ...(legacyIds.length ? { legacyIds } : {}),
    name: item.name,
    description: typeof item.description === "string" ? item.description : "",
    locationId: item.locationId,
    locationName: item.locationName,
    menuUrl: typeof item.menuUrl === "string" ? item.menuUrl : undefined,
    mealPeriods: stringArray(item.mealPeriods),
    menuType: typeof item.menuType === "string" ? item.menuType : undefined,
    menuTypes: stringArray(item.menuTypes).length ? stringArray(item.menuTypes) : typeof item.menuType === "string" ? [item.menuType] : [],
    servingSize: typeof item.servingSize === "string" && item.servingSize ? item.servingSize : "1 serving",
    allergens: stringArray(item.allergens),
    tags: stringArray(item.tags),
    ...(addOns.length ? { addOns } : {}),
    calories: numberValue(item.calories),
    protein: numberValue(item.protein),
    carbs: numberValue(item.carbs),
    fat: numberValue(item.fat),
    addedSugar: item.addedSugar === null ? null : validNutritionValue(item.addedSugar) ? Number(item.addedSugar) : null,
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

export type MenuLocation = { id: string; name: string; menuUrl: string; status: "available" | "empty" | "unavailable"; cached?: boolean; unavailableMeals?: string[] };
export type MenuData = { foods: Food[]; locations: MenuLocation[]; fetchedAt: string; mode: "live" | "cached"; partial: boolean };

function parseMenu(payload: unknown, date: string, mode: MenuData["mode"]): MenuData {
  const root = record(payload);
  if (root?.ok !== true || root.source !== "hopkins-nutrislice" || root.schemaVersion !== 6 || root.date !== date || !Array.isArray(root.foods) || !Array.isArray(root.locations)) throw new Error("Stale or malformed menu");
  const fetchedAt = typeof root.fetchedAt === "string" ? root.fetchedAt : "";
  const age = Date.now() - Date.parse(fetchedAt);
  if (!Number.isFinite(age) || age < -300000 || age > 86400000) throw new Error("Menu cache has expired");
  const normalizedFoods = root.foods.map(normalizeFood).filter((food): food is Food => Boolean(food));
  if (normalizedFoods.length !== root.foods.length || normalizedFoods.some((food) => food.updatedAt !== date)) throw new Error("Invalid menu foods");
  const foods = deduplicateFoods(normalizedFoods);
  const locations = root.locations.map((value): MenuLocation => {
    const location = record(value);
    if (!location || typeof location.id !== "string" || typeof location.name !== "string" || typeof location.menuUrl !== "string") throw new Error("Invalid menu location");
    if (!["available", "empty", "unavailable"].includes(String(location.status))) throw new Error("Invalid menu status");
    const unavailableMeals = Array.from(new Set([...stringArray(location.unavailableMeals), ...(Array.isArray(root.errors) ? root.errors.flatMap((value) => {
      const error = record(value);
      if (!error) return [];
      return error.locationId === location.id && typeof error.mealType === "string" ? [error.mealType] : [];
    }) : [])]));
    return { id: location.id, name: location.name, menuUrl: location.menuUrl, status: location.status as MenuLocation["status"], ...(location.cached === true ? { cached: true } : {}), ...(unavailableMeals.length ? { unavailableMeals } : {}) };
  });
  if (foods.some((food) => !locations.some((location) => location.id === food.locationId))) throw new Error("Unknown food location");
  return { foods, locations, fetchedAt, mode: locations.some((location) => location.cached) ? "cached" : mode, partial: root.partial === true };
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

function savedMenu(key: string, date: string): MenuData | null {
  try {
    const stored = localStorage.getItem(key);
    return stored ? parseMenu(JSON.parse(stored), date, "cached") : null;
  } catch { return null; }
}

async function publishedMenu(date: string, signal?: AbortSignal): Promise<MenuData | null> {
  try {
    const path = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/menus/${date}.json`;
    return parseMenu(await readMenu(path, signal, 5000), date, "cached");
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return null;
  }
}

function preserveFailedLocations(live: MenuData, candidates: MenuData[]): MenuData {
  const foods = [...live.foods];
  let oldestFetch = live.fetchedAt;
  let repaired = false;
  const locations = live.locations.map((location) => {
    const failures: Array<string | undefined> = location.status === "unavailable" ? [undefined] : location.unavailableMeals ?? [];
    let locationRepaired = false;
    for (const mealType of failures) {
      const matches = (food: Food) => food.locationId === location.id && (mealType === undefined || (food.menuTypes ?? [food.menuType]).includes(mealType));
      const candidate = candidates.find((menu) => menu.foods.some(matches));
      if (!candidate) continue;
      repaired = true;
      locationRepaired = true;
      foods.push(...candidate.foods.filter(matches));
      if (Date.parse(candidate.fetchedAt) < Date.parse(oldestFetch)) oldestFetch = candidate.fetchedAt;
    }
    return locationRepaired ? { ...location, status: "available" as const, cached: true } : location;
  });
  return repaired ? { ...live, foods: deduplicateFoods(foods), locations, fetchedAt: oldestFetch, mode: "cached", partial: true } : live;
}

function deduplicateFoods(foods: Food[]): Food[] {
  const unique = new Map<string, Food>();
  for (const food of foods) {
    const key = `${food.locationId}:${food.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, food);
      continue;
    }
    const preferNewNutrition = (food.missingNutrition?.length ?? 0) < (existing.missingNutrition?.length ?? 0);
    unique.set(key, {
      ...(preferNewNutrition ? food : existing),
      id: existing.id,
      mealPeriods: Array.from(new Set([...existing.mealPeriods, ...food.mealPeriods])),
      menuTypes: Array.from(new Set([...(existing.menuTypes ?? [existing.menuType].filter((value): value is string => Boolean(value))), ...(food.menuTypes ?? [food.menuType].filter((value): value is string => Boolean(value)))])),
      allergens: Array.from(new Set([...existing.allergens, ...food.allergens])),
      tags: Array.from(new Set([...existing.tags, ...food.tags].filter((tag) => !(food.addedSugar != null || existing.addedSugar != null) || !/no added sugar/i.test(tag)).concat(Math.max(existing.addedSugar ?? 0, food.addedSugar ?? 0) === 0 && (existing.addedSugar === 0 || food.addedSugar === 0) ? ["No Added Sugar"] : []))),
      addedSugar: existing.addedSugar == null ? food.addedSugar ?? null : food.addedSugar == null ? existing.addedSugar : Math.max(existing.addedSugar, food.addedSugar),
      legacyIds: Array.from(new Set([...(existing.legacyIds ?? []), ...(food.legacyIds ?? [])])),
      stationName: existing.stationName || food.stationName,
      addOns: Array.from(new Map([...(existing.addOns ?? []), ...(food.addOns ?? [])].map((addOn) => [addOn.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), addOn])).values()),
    });
  }
  return Array.from(unique.values());
}

function storeMenu(key: string, date: string, menu: MenuData) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...menu, ok: true, source: "hopkins-nutrislice", schemaVersion: 6, date }));
  } catch { /* Storage may be full or disabled. */ }
}

export async function fetchTodayMenu(date: string, signal?: AbortSignal): Promise<MenuData> {
  const key = `bluejay-menu-v6:${date}`;
  const stored = savedMenu(key, date);
  const endpoint = menuEndpoint(date);
  if (endpoint) {
    try {
      const payload = await readMenu(endpoint, signal, 16000);
      const live = parseMenu(payload, date, "live");
      let menu = live;
      if (live.locations.some((location) => location.status === "unavailable" || location.unavailableMeals?.length)) {
        const published = await publishedMenu(date, signal);
        const candidates = [stored, published].filter((candidate): candidate is MenuData => candidate !== null)
          .sort((left, right) => Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt));
        menu = preserveFailedLocations(live, candidates);
      }
      storeMenu(key, date, menu);
      return menu;
    } catch {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    }
  }
  // Only genuine, dated Nutrislice data is eligible for fallback.
  const published = await publishedMenu(date, signal);
  const candidates = [stored, published].filter((candidate): candidate is MenuData => candidate !== null);
  if (candidates.length) return candidates.sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))[0];
  throw new Error("Hopkins menus are unavailable for this date. Open the official menu or try again.");
}

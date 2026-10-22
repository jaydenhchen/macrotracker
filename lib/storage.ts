import { DayLog, MacroEntry, MealAddOn, MealEntry, TrackerState, UserProfile, WaterEntry, WeightEntry } from "./types";

const DB_NAME = "bluejay-fuel";
const STORE_NAME = "tracker";
const STATE_KEY = "state";
const FALLBACK_KEY = "bluejay-fuel-state";

export const DEFAULT_STATE: TrackerState = {
  goals: { calories: 2400, protein: 150, carbs: 260, fat: 80 },
  profile: null,
  dayLogs: {},
  weights: [],
  favorites: [],
  preferredWeightUnit: "lb",
  waterGoal: 64,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeMealAddOn(value: unknown): MealAddOn | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || (value.category !== "protein" && value.category !== "topping")) return null;
  const nutrition = isRecord(value.nutrition) ? value.nutrition : value;
  const quantity = Math.min(20, Math.max(0.25, finiteNumber(value.quantity, 1)));
  return {
    id: value.id,
    name: value.name,
    category: value.category,
    servingSize: typeof value.servingSize === "string" && value.servingSize ? value.servingSize : "1 serving",
    quantity,
    calories: finiteNumber(nutrition.calories, 0),
    protein: finiteNumber(nutrition.protein, 0),
    carbs: finiteNumber(nutrition.carbs, 0),
    fat: finiteNumber(nutrition.fat, 0),
  };
}

function normalizeMealEntry(value: unknown): MealEntry | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.foodId !== "string" || typeof value.foodName !== "string" || typeof value.servingSize !== "string" || typeof value.locationName !== "string") return null;
  const nutrition = isRecord(value.nutrition) ? value.nutrition : {};
  const perServing = isRecord(value.nutritionPerServing) ? value.nutritionPerServing : null;
  const addOns = Array.isArray(value.addOns) ? value.addOns.map(normalizeMealAddOn).filter((addOn): addOn is MealAddOn => Boolean(addOn)) : undefined;
  return {
    id: value.id,
    foodId: value.foodId,
    foodName: value.foodName,
    servingSize: value.servingSize,
    servings: Math.max(0.25, finiteNumber(value.servings, 1)),
    nutrition: {
      calories: finiteNumber(nutrition.calories, 0),
      protein: finiteNumber(nutrition.protein, 0),
      carbs: finiteNumber(nutrition.carbs, 0),
      fat: finiteNumber(nutrition.fat, 0),
    },
    locationName: value.locationName,
    ...(perServing && ["calories", "protein", "carbs", "fat"].every((key) => typeof perServing[key] === "number" && Number.isFinite(perServing[key]) && Number(perServing[key]) >= 0) ? {
      nutritionPerServing: { calories: Number(perServing.calories), protein: Number(perServing.protein), carbs: Number(perServing.carbs), fat: Number(perServing.fat) },
    } : {}),
    ...(Array.isArray(value.missingNutrition) ? { missingNutrition: value.missingNutrition.filter((key): key is string => ["calories", "protein", "carbs", "fat"].includes(String(key))) } : {}),
    ...(addOns?.length ? { addOns } : {}),
  };
}

function normalizeMacroEntry(value: unknown): MacroEntry | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const nutrition = isRecord(value.nutrition) ? value.nutrition : {};
  return {
    id: value.id,
    name: value.name,
    sourceLabel: typeof value.sourceLabel === "string" ? value.sourceLabel : "Outside source",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    nutrition: {
      calories: finiteNumber(nutrition.calories, 0),
      protein: finiteNumber(nutrition.protein, 0),
      carbs: finiteNumber(nutrition.carbs, 0),
      fat: finiteNumber(nutrition.fat, 0),
    },
  };
}

function normalizeWaterEntry(value: unknown): WaterEntry | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const amount = finiteNumber(value.amount, 0);
  return amount > 0 ? { id: value.id, amount, unit: "oz", createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString() } : null;
}

function normalizeDayLogs(value: unknown): Record<string, DayLog> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([date, rawDay]) => {
    const rawMeals = isRecord(rawDay) && isRecord(rawDay.meals) ? rawDay.meals : {};
    const meals = Object.fromEntries(Object.entries(rawMeals).map(([meal, rawEntries]) => [meal, Array.isArray(rawEntries) ? rawEntries.map(normalizeMealEntry).filter((entry): entry is MealEntry => Boolean(entry)) : []]));
    const customMacros = isRecord(rawDay) && Array.isArray(rawDay.customMacros) ? rawDay.customMacros.map(normalizeMacroEntry).filter((entry): entry is MacroEntry => Boolean(entry)) : [];
    const waterEntries = isRecord(rawDay) && Array.isArray(rawDay.waterEntries) ? rawDay.waterEntries.map(normalizeWaterEntry).filter((entry): entry is WaterEntry => Boolean(entry)) : [];
    return [date, { date, meals, customMacros, waterEntries }];
  }));
}

function normalizeWeights(value: unknown): WeightEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.id === "string" && typeof entry.date === "string" && (entry.unit === "lb" || entry.unit === "kg"))
    .map((entry) => ({ id: entry.id as string, date: entry.date as string, value: finiteNumber(entry.value, 0), unit: entry.unit as "lb" | "kg", createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString() }))
    .filter((entry) => entry.value > 0);
}

function normalizeProfile(value: unknown): UserProfile | null {
  if (!isRecord(value)) return null;
  const sex = value.sex === "female" || value.sex === "male" || value.sex === "average" ? value.sex : "male";
  const heightUnit = value.heightUnit === "cm" ? "cm" : "in";
  const weightUnit = value.weightUnit === "kg" ? "kg" : "lb";
  const legacyWorkoutDays: Record<string, number> = { sedentary: 0, light: 2, moderate: 4, very: 6, extra: 7 };
  const workoutDays = typeof value.workoutDays === "number" && Number.isFinite(value.workoutDays)
    ? Math.min(7, Math.max(0, Math.round(value.workoutDays)))
    : legacyWorkoutDays[String(value.activity)] ?? 4;
  const goal = value.goal === "lose" || value.goal === "gain" ? value.goal : "maintain";
  const age = finiteNumber(value.age, 20);
  const height = finiteNumber(value.height, heightUnit === "cm" ? 170 : 67);
  const weight = finiteNumber(value.weight, weightUnit === "kg" ? 68 : 150);
  if (!age || !height || !weight) return null;
  return { age, sex, height, heightUnit, weight, weightUnit, workoutDays, goal, onboardingComplete: value.onboardingComplete === true };
}

export function normalizeState(value: unknown): TrackerState {
  const raw = isRecord(value) ? value : {};
  const rawGoals = isRecord(raw.goals) ? raw.goals : {};
  return {
    ...DEFAULT_STATE,
    goals: {
      calories: finiteNumber(rawGoals.calories, DEFAULT_STATE.goals.calories),
      protein: finiteNumber(rawGoals.protein, DEFAULT_STATE.goals.protein),
      carbs: finiteNumber(rawGoals.carbs, DEFAULT_STATE.goals.carbs),
      fat: finiteNumber(rawGoals.fat, DEFAULT_STATE.goals.fat),
    },
    profile: normalizeProfile(raw.profile),
    dayLogs: normalizeDayLogs(raw.dayLogs),
    weights: normalizeWeights(raw.weights),
    favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((id): id is string => typeof id === "string") : DEFAULT_STATE.favorites,
    preferredWeightUnit: raw.preferredWeightUnit === "kg" ? "kg" : "lb",
    waterGoal: Math.max(1, finiteNumber(raw.waterGoal, DEFAULT_STATE.waterGoal)),
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadState(): Promise<TrackerState> {
  if (typeof window === "undefined") return DEFAULT_STATE;

  try {
    const db = await openDatabase();
    const value = await new Promise<Partial<TrackerState> | null>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    return normalizeState(value);
  } catch {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? "null"));
    } catch {
      return DEFAULT_STATE;
    }
  }
}

export async function saveState(state: TrackerState) {
  if (typeof window === "undefined") return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
  }
}

export function exportState(state: TrackerState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bluejay-fuel-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

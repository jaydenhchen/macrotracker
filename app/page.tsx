"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Calculator,
  Check,
  ChevronDown,
  Download,
  Droplets,
  Flame,
  Heart,
  Home,
  LineChart,
  Plus,
  Ruler,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Utensils,
  UserRound,
  Weight,
  X,
} from "lucide-react";
import { FOODS, LOCATIONS } from "@/lib/catalog";
import { DEFAULT_STATE, dateKey, exportState, loadState, normalizeState, saveState } from "@/lib/storage";
import { fetchTodayMenu, NUTRISLICE_LOCATIONS } from "@/lib/nutrislice";
import { DayLog, Food, FoodAddOn, Goals, MacroEntry, MealAddOn, MealEntry, MealName, MEALS, Nutrition, TrackerState, UserProfile, WaterEntry, WeightEntry } from "@/lib/types";

type View = "today" | "foods" | "weight" | "settings";

const NAV_ITEMS: { id: View; label: string; icon: typeof Home }[] = [
  { id: "today", label: "Today", icon: Home },
  { id: "foods", label: "Foods", icon: Utensils },
  { id: "weight", label: "Weight", icon: Weight },
  { id: "settings", label: "Settings", icon: Settings },
];

const MACRO_META: { key: keyof Nutrition; label: string; color: string; soft: string; unit: string }[] = [
  { key: "calories", label: "Calories", color: "#244f9f", soft: "#e6efff", unit: "kcal" },
  { key: "protein", label: "Protein", color: "#ce6b28", soft: "#fff0e4", unit: "g" },
  { key: "carbs", label: "Carbs", color: "#2a8d78", soft: "#e4f6f1", unit: "g" },
  { key: "fat", label: "Fat", color: "#8b69c2", soft: "#f0ebfa", unit: "g" },
];

const ADD_ON_OPTIONS: FoodAddOn[] = [
  { id: "addon-chicken", name: "Extra grilled chicken", category: "protein", servingSize: "1 scoop", calories: 130, protein: 26, carbs: 0, fat: 3 },
  { id: "addon-steak", name: "Extra steak", category: "protein", servingSize: "1 scoop", calories: 170, protein: 24, carbs: 0, fat: 8 },
  { id: "addon-tofu", name: "Tofu", category: "protein", servingSize: "1 scoop", calories: 100, protein: 10, carbs: 4, fat: 6 },
  { id: "addon-black-beans", name: "Black beans", category: "topping", servingSize: "1 scoop", calories: 90, protein: 6, carbs: 16, fat: 1 },
  { id: "addon-rice", name: "Rice", category: "topping", servingSize: "1 scoop", calories: 170, protein: 4, carbs: 37, fat: 1 },
  { id: "addon-cheese", name: "Cheese", category: "topping", servingSize: "1 oz", calories: 110, protein: 7, carbs: 1, fat: 9 },
  { id: "addon-guacamole", name: "Guacamole", category: "topping", servingSize: "2 oz", calories: 100, protein: 1, carbs: 5, fat: 9 },
  { id: "addon-salsa", name: "Salsa", category: "topping", servingSize: "2 oz", calories: 25, protein: 1, carbs: 5, fat: 0 },
  { id: "addon-sour-cream", name: "Sour cream", category: "topping", servingSize: "1 oz", calories: 60, protein: 1, carbs: 2, fat: 5 },
  { id: "addon-lettuce", name: "Lettuce & vegetables", category: "topping", servingSize: "1 scoop", calories: 20, protein: 1, carbs: 4, fat: 0 },
];

const ADD_ON_FOOD_PATTERN = /burrito|bowl|salad|wrap|sandwich|taco|quesadilla|pita|plate|build.?your.?own|bar/i;

const FOOD_TAG_FILTERS = [
  { value: "all", label: "All dietary tags" },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "high-protein", label: "High protein" },
  { value: "gluten-free", label: "Gluten-free" },
  { value: "dairy-free", label: "Dairy-free" },
] as const;

function blankMeals(): Record<string, MealEntry[]> {
  return {};
}

function emptyDay(date: string): DayLog {
  return { date, meals: blankMeals(), customMacros: [], waterEntries: [] };
}

function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", options ?? { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

function scaleNutrition(food: Food, servings: number): Nutrition {
  return {
    calories: Math.round(food.calories * servings),
    protein: Math.round(food.protein * servings * 10) / 10,
    carbs: Math.round(food.carbs * servings * 10) / 10,
    fat: Math.round(food.fat * servings * 10) / 10,
  };
}

function sumNutrition(first: Nutrition, second: Nutrition): Nutrition {
  return {
    calories: first.calories + second.calories,
    protein: first.protein + second.protein,
    carbs: first.carbs + second.carbs,
    fat: first.fat + second.fat,
  };
}

function subtractNutrition(first: Nutrition, second: Nutrition): Nutrition {
  return {
    calories: Math.max(0, first.calories - second.calories),
    protein: Math.max(0, Math.round((first.protein - second.protein) * 10) / 10),
    carbs: Math.max(0, Math.round((first.carbs - second.carbs) * 10) / 10),
    fat: Math.max(0, Math.round((first.fat - second.fat) * 10) / 10),
  };
}

function scaleAddOn(addOn: FoodAddOn, quantity: number): Nutrition {
  return {
    calories: Math.round(addOn.calories * quantity),
    protein: Math.round(addOn.protein * quantity * 10) / 10,
    carbs: Math.round(addOn.carbs * quantity * 10) / 10,
    fat: Math.round(addOn.fat * quantity * 10) / 10,
  };
}

function nutritionForMeal(food: Food, servings: number, addOns: MealAddOn[] = []): Nutrition {
  return addOns.reduce((total, addOn) => sumNutrition(total, scaleAddOn(addOn, addOn.quantity * servings)), scaleNutrition(food, servings));
}

function addOnsForFood(food: Food): FoodAddOn[] {
  const searchable = `${food.name} ${food.description} ${food.tags.join(" ")}`;
  return ADD_ON_FOOD_PATTERN.test(searchable) ? ADD_ON_OPTIONS : [];
}

function displayFoodTags(food: Food) {
  const tags = Array.from(new Set(food.tags.map((tag) => tag.trim()).filter(Boolean)));
  const priority = [/^vegan$/i, /^vegetarian/i, /high.?protein/i, /gluten.?free/i, /dairy.?free/i, /contains/i];
  return tags.sort((a, b) => {
    const aPriority = priority.findIndex((pattern) => pattern.test(a));
    const bPriority = priority.findIndex((pattern) => pattern.test(b));
    return (aPriority < 0 ? 99 : aPriority) - (bPriority < 0 ? 99 : bPriority);
  }).slice(0, 4);
}

function matchesFoodTag(food: Food, filter: string) {
  if (filter === "all") return true;
  const tags = food.tags.map((tag) => tag.toLowerCase().replace(/[-_]+/g, " ").trim());
  if (filter === "vegetarian") return tags.some((tag) => tag.includes("vegetarian") || tag === "vegan");
  return tags.some((tag) => tag === filter.replace("-", " ") || tag.includes(filter.replace("-", " ")));
}

function FoodTags({ food, compact = false }: { food: Food; compact?: boolean }) {
  const tags = displayFoodTags(food).slice(0, compact ? 1 : 4);
  return <span className={`food-tags ${compact ? "compact" : ""}`}>{tags.map((tag) => <span className={`food-tag ${/^vegan$/i.test(tag) ? "vegan" : /^vegetarian/i.test(tag) ? "vegetarian" : ""}`} key={tag}>{tag}</span>)}</span>;
}

function sumEntries(entries: MealEntry[] = []): Nutrition {
  return entries.reduce(
    (total, entry) => ({
      calories: total.calories + entry.nutrition.calories,
      protein: total.protein + entry.nutrition.protein,
      carbs: total.carbs + entry.nutrition.carbs,
      fat: total.fat + entry.nutrition.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function sumDay(day: ReturnType<typeof emptyDay>): Nutrition {
  const mealsTotal = Object.values(day.meals).reduce((total, entries) => {
    const values = sumEntries(entries);
    return {
      calories: total.calories + values.calories,
      protein: total.protein + values.protein,
      carbs: total.carbs + values.carbs,
      fat: total.fat + values.fat,
    };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  return day.customMacros.reduce((total, entry) => ({
    calories: total.calories + entry.nutrition.calories,
    protein: total.protein + entry.nutrition.protein,
    carbs: total.carbs + entry.nutrition.carbs,
    fat: total.fat + entry.nutrition.fat,
  }), mealsTotal);
}

function sumWater(day: ReturnType<typeof emptyDay>) {
  return day.waterEntries.reduce((total, entry) => total + entry.amount, 0);
}

type FoodUsage = {
  count: number;
  servings: number;
  lastLoggedDate: string;
};

type FoodUsageMap = ReadonlyMap<string, FoodUsage>;

function collectFoodUsage(dayLogs: TrackerState["dayLogs"]): Map<string, FoodUsage> {
  const usage = new Map<string, FoodUsage>();
  Object.entries(dayLogs).forEach(([date, day]) => {
    Object.values(day.meals).flat().forEach((entry) => {
      const current = usage.get(entry.foodId);
      usage.set(entry.foodId, {
        count: (current?.count ?? 0) + 1,
        servings: (current?.servings ?? 0) + entry.servings,
        lastLoggedDate: !current || date > current.lastLoggedDate ? date : current.lastLoggedDate,
      });
    });
  });
  return usage;
}

function sortFoodsByUsage(foods: Food[], usage: FoodUsageMap): Food[] {
  return foods
    .map((food, index) => ({ food, index, stats: usage.get(food.id) }))
    .sort((a, b) => {
      const countDifference = (b.stats?.count ?? 0) - (a.stats?.count ?? 0);
      if (countDifference) return countDifference;
      const dateDifference = (b.stats?.lastLoggedDate ?? "").localeCompare(a.stats?.lastLoggedDate ?? "");
      return dateDifference || a.index - b.index;
    })
    .map(({ food }) => food);
}

function foodSnapshotFromEntry(entry: MealEntry): Food {
  const servings = Math.max(entry.servings, 0.25);
  const addOnNutrition = (entry.addOns ?? []).reduce((total, addOn) => sumNutrition(total, scaleAddOn(addOn, addOn.quantity * servings)), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const baseNutrition = subtractNutrition(entry.nutrition, addOnNutrition);
  return {
    id: entry.foodId,
    name: entry.foodName,
    description: "Previously logged Hopkins food",
    locationId: "logged-history",
    locationName: entry.locationName,
    mealPeriods: [],
    servingSize: entry.servingSize,
    calories: Math.round(baseNutrition.calories / servings),
    protein: Math.round((baseNutrition.protein / servings) * 10) / 10,
    carbs: Math.round((baseNutrition.carbs / servings) * 10) / 10,
    fat: Math.round((baseNutrition.fat / servings) * 10) / 10,
    allergens: [],
    tags: [],
    updatedAt: entry.id,
  };
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function getProgress(value: number, goal: number) {
  return Math.min(100, Math.round((value / Math.max(goal, 1)) * 100));
}

type OnboardingDraft = {
  age: string;
  sex: UserProfile["sex"];
  height: string;
  heightUnit: UserProfile["heightUnit"];
  weight: string;
  weightUnit: UserProfile["weightUnit"];
  workoutDays: string;
  waterGoal: string;
  goal: UserProfile["goal"];
};

const DEFAULT_ONBOARDING_DRAFT: OnboardingDraft = {
  age: "19",
  sex: "male",
  height: "68",
  heightUnit: "in",
  weight: "150",
  weightUnit: "lb",
  workoutDays: "3",
  waterGoal: "64",
  goal: "maintain",
};

function workoutActivityFactor(workoutDays: number) {
  return 1.2 + (Math.min(7, Math.max(0, workoutDays)) / 7) * 0.6;
}

function calculateGoals(profile: UserProfile): Goals {
  const weightKg = profile.weightUnit === "kg" ? profile.weight : profile.weight * 0.453592;
  const heightCm = profile.heightUnit === "cm" ? profile.height : profile.height * 2.54;
  const sexAdjustment = profile.sex === "male" ? 5 : profile.sex === "female" ? -161 : -78;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * profile.age + sexAdjustment;
  const activityFactor = workoutActivityFactor(profile.workoutDays);
  const goalAdjustment = { lose: -300, maintain: 0, gain: 300 }[profile.goal];
  const calories = Math.max(1200, Math.round((bmr * activityFactor + goalAdjustment) / 50) * 50);
  const protein = Math.max(1, Math.round(weightKg * 1.6));
  const fat = Math.max(1, Math.round((calories * 0.27) / 9));
  const carbs = Math.max(1, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat };
}

function profileToDraft(profile: UserProfile | null, waterGoal = DEFAULT_STATE.waterGoal): OnboardingDraft {
  if (!profile) return DEFAULT_ONBOARDING_DRAFT;
  return { age: String(profile.age), sex: profile.sex, height: String(profile.height), heightUnit: profile.heightUnit, weight: String(profile.weight), weightUnit: profile.weightUnit, workoutDays: String(profile.workoutDays), waterGoal: String(waterGoal), goal: profile.goal };
}

export default function Page() {
  const [activeView, setActiveView] = useState<View>("today");
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [state, setState] = useState<TrackerState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [addFoodOpen, setAddFoodOpen] = useState(false);
  const [modalMeal, setModalMeal] = useState<MealName>("Lunch");
  const [modalQuery, setModalQuery] = useState("");
  const [modalLocation, setModalLocation] = useState("all");
  const [modalTagFilter, setModalTagFilter] = useState("all");
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [servings, setServings] = useState(1);
  const [macroEntryOpen, setMacroEntryOpen] = useState(false);
  const [weightDraft, setWeightDraft] = useState("");
  const [weightRange, setWeightRange] = useState<"1m" | "3m" | "all">("all");
  const [calcWeight, setCalcWeight] = useState("150");
  const [calcWorkoutDays, setCalcWorkoutDays] = useState("3");
  const [calcGoal, setCalcGoal] = useState("maintain");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraft>(DEFAULT_ONBOARDING_DRAFT);
  const [menuFoods, setMenuFoods] = useState<Food[]>(FOODS);
  const [menuStatus, setMenuStatus] = useState<"loading" | "live" | "fallback">("loading");
  const [menuFetchedAt, setMenuFetchedAt] = useState("");
  const [toast, setToast] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadState().then((loaded) => {
      setState(loaded);
      setCalcWeight(String(Math.round(loaded.goals.protein / 0.8)));
      setOnboardingDraft(profileToDraft(loaded.profile, loaded.waterGoal));
      if (!loaded.profile?.onboardingComplete) setOnboardingOpen(true);
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (hydrated) void saveState(state);
  }, [state, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setMenuStatus("loading");
    fetchTodayMenu(selectedDate, controller.signal).then((result) => {
      if (result.foods.length) {
        setMenuFoods(result.foods);
        setMenuStatus("live");
      } else {
        setMenuFoods(FOODS);
        setMenuStatus("fallback");
      }
      setMenuFetchedAt(result.fetchedAt);
    }).catch(() => {
      setMenuFoods(FOODS);
      setMenuStatus("fallback");
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [hydrated, selectedDate]);

  const day = state.dayLogs[selectedDate] ?? emptyDay(selectedDate);
  const totals = useMemo(() => sumDay(day), [day]);
  const foodUsage = useMemo(() => collectFoodUsage(state.dayLogs), [state.dayLogs]);
  const foodCatalog = useMemo(() => {
    const loggedSnapshots = Object.values(state.dayLogs)
      .flatMap((log) => Object.values(log.meals).flat())
      .reduce((foods, entry) => foods.set(entry.foodId, foodSnapshotFromEntry(entry)), new Map<string, Food>());
    return Array.from(new Map([...Array.from(loggedSnapshots.values()), ...FOODS, ...menuFoods].map((food) => [food.id, food])).values());
  }, [menuFoods, state.dayLogs]);
  const mostLoggedFoods = useMemo(() => sortFoodsByUsage(foodCatalog.filter((food) => foodUsage.has(food.id)), foodUsage), [foodCatalog, foodUsage]);
  const favoriteFoods = useMemo(() => state.favorites.map((id) => foodCatalog.find((food) => food.id === id)).filter(Boolean) as Food[], [state.favorites, foodCatalog]);

  function updateDay(updater: (current: ReturnType<typeof emptyDay>) => ReturnType<typeof emptyDay>) {
    setState((current) => ({
      ...current,
      dayLogs: { ...current.dayLogs, [selectedDate]: updater(current.dayLogs[selectedDate] ?? emptyDay(selectedDate)) },
    }));
  }

  function openAddFood(meal: MealName = "Lunch", food?: Food) {
    setModalMeal(meal);
    setSelectedFood(food ?? null);
    setServings(1);
    setModalQuery(food ? food.name : "");
    setModalTagFilter("all");
    setAddFoodOpen(true);
  }

  function addFoodToDay(addOns: MealAddOn[] = []) {
    if (!selectedFood) return;
    const entry: MealEntry = {
      id: makeId(),
      foodId: selectedFood.id,
      foodName: selectedFood.name,
      servingSize: selectedFood.servingSize,
      servings,
      nutrition: nutritionForMeal(selectedFood, servings, addOns),
      locationName: selectedFood.locationName,
      ...(addOns.length ? { addOns } : {}),
    };
    updateDay((current) => ({ ...current, meals: { ...current.meals, [modalMeal]: [...(current.meals[modalMeal] ?? []), entry] } }));
    setAddFoodOpen(false);
    setToast(`${selectedFood.name}${addOns.length ? " with add-ons" : ""} added to ${modalMeal.toLowerCase()}`);
  }

  function updateEntry(mealName: string, entryId: string, nextServings: number) {
    const safeServings = Math.max(0.25, Math.min(20, Math.round(nextServings * 4) / 4));
    updateDay((current) => ({
      ...current,
      meals: {
        ...current.meals,
        [mealName]: (current.meals[mealName] ?? []).map((entry) => {
          if (entry.id !== entryId) return entry;
          const food = foodCatalog.find((item) => item.id === entry.foodId);
          if (food) return { ...entry, servings: safeServings, nutrition: nutritionForMeal(food, safeServings, entry.addOns) };
          const base = Math.max(entry.servings, 0.25);
          return {
            ...entry,
            servings: safeServings,
            nutrition: {
              calories: Math.round((entry.nutrition.calories / base) * safeServings),
              protein: Math.round((entry.nutrition.protein / base) * safeServings * 10) / 10,
              carbs: Math.round((entry.nutrition.carbs / base) * safeServings * 10) / 10,
              fat: Math.round((entry.nutrition.fat / base) * safeServings * 10) / 10,
            },
          };
        }),
      },
    }));
  }

  function removeEntry(mealName: string, entryId: string) {
    updateDay((current) => ({ ...current, meals: { ...current.meals, [mealName]: (current.meals[mealName] ?? []).filter((entry) => entry.id !== entryId) } }));
  }

  function addMacroEntry(entry: Omit<MacroEntry, "id" | "createdAt">) {
    const nextEntry: MacroEntry = { ...entry, id: makeId(), createdAt: new Date().toISOString() };
    updateDay((current) => ({ ...current, customMacros: [...current.customMacros, nextEntry] }));
    setMacroEntryOpen(false);
    setToast(`${entry.name} added to today’s macros`);
  }

  function removeMacroEntry(entryId: string) {
    updateDay((current) => ({ ...current, customMacros: current.customMacros.filter((entry) => entry.id !== entryId) }));
  }

  function addWater(amount: number) {
    const safeAmount = Math.min(128, Math.max(1, Math.round(amount * 10) / 10));
    const entry: WaterEntry = { id: makeId(), amount: safeAmount, unit: "oz", createdAt: new Date().toISOString() };
    updateDay((current) => ({ ...current, waterEntries: [...current.waterEntries, entry] }));
    setToast(`${formatNumber(safeAmount)} oz of water logged`);
  }

  function removeWater(entryId: string) {
    updateDay((current) => ({ ...current, waterEntries: current.waterEntries.filter((entry) => entry.id !== entryId) }));
  }

  function toggleFavorite(foodId: string) {
    setState((current) => ({ ...current, favorites: current.favorites.includes(foodId) ? current.favorites.filter((id) => id !== foodId) : [...current.favorites, foodId] }));
  }

  function moveDate(amount: number) {
    const date = new Date(`${selectedDate}T12:00:00`);
    date.setDate(date.getDate() + amount);
    setSelectedDate(dateKey(date));
  }

  function addWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(weightDraft);
    if (!value || value <= 0 || value > 1000) return;
    const entry: WeightEntry = { id: makeId(), date: selectedDate, value, unit: state.preferredWeightUnit, createdAt: new Date().toISOString() };
    setState((current) => ({ ...current, weights: [...current.weights, entry].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)) }));
    setWeightDraft("");
    setToast("Weight logged");
  }

  function applyGuidedGoals() {
    const weight = Number(calcWeight);
    if (!weight || weight <= 0) return;
    const workoutDays = Math.min(7, Math.max(0, Number(calcWorkoutDays) || 0));
    let calories = Math.round(weight * 10 * workoutActivityFactor(workoutDays));
    if (calcGoal === "lose") calories -= 300;
    if (calcGoal === "gain") calories += 300;
    const protein = Math.round(weight * 0.8);
    const carbs = Math.round((calories * 0.45) / 4);
    const fat = Math.round((calories * 0.25) / 9);
    setState((current) => ({ ...current, goals: { calories, protein, carbs, fat } }));
    setToast("Your targets were updated");
  }

  function finishOnboarding(customGoals?: Goals) {
    const profile: UserProfile = {
      age: Number(onboardingDraft.age),
      sex: onboardingDraft.sex,
      height: Number(onboardingDraft.height),
      heightUnit: onboardingDraft.heightUnit,
      weight: Number(onboardingDraft.weight),
      weightUnit: onboardingDraft.weightUnit,
      workoutDays: Math.min(7, Math.max(0, Number(onboardingDraft.workoutDays) || 0)),
      goal: onboardingDraft.goal,
      onboardingComplete: true,
    };
    const waterGoal = Math.min(512, Math.max(1, Number(onboardingDraft.waterGoal) || DEFAULT_STATE.waterGoal));
    if (!profile.age || !profile.height || !profile.weight || profile.age < 13 || profile.age > 100 || profile.height <= 0 || profile.weight <= 0) {
      setToast("Add valid numbers to continue");
      return;
    }
    setState((current) => ({ ...current, profile, goals: customGoals ?? calculateGoals(profile), waterGoal }));
    setOnboardingOpen(false);
    setOnboardingStep(1);
    setToast("Your starting targets are ready");
  }

  function updateGoal(key: keyof Goals, value: string) {
    const numeric = Math.max(0, Number(value) || 0);
    setState((current) => ({ ...current, goals: { ...current.goals, [key]: numeric } }));
  }

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        setState(normalizeState(parsed));
        setToast("Backup restored on this device");
      } catch {
        setToast("That backup file could not be read");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  const visibleFoods = sortFoodsByUsage(menuFoods.filter((food) => {
    const query = modalQuery.trim().toLowerCase();
    const matchesQuery = !query || `${food.name} ${food.description} ${food.tags.join(" ")}`.toLowerCase().includes(query);
    const matchesLocation = modalLocation === "all" || food.locationId === modalLocation;
    return matchesQuery && matchesLocation && matchesFoodTag(food, modalTagFilter);
  }), foodUsage);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark"><div className="brand-bird">B</div><div><strong>bluejay</strong><span>fuel</span></div></div>
        <div className="semester-pill"><span className="status-dot" /> Homewood · Fall 2026</div>
        <nav className="side-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => <NavButton key={item.id} item={item} activeView={activeView} onClick={setActiveView} />)}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip"><Sparkles size={16} /><div><strong>Small wins add up.</strong><span>Keep showing up for yourself.</span></div></div>
          <button className="sidebar-settings" onClick={() => setActiveView("settings")}><Settings size={17} /> Preferences</button>
          <div className="sidebar-footer"><span className="jhu-dot">JH</span><span>Made for Blue Jays</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-bird">B</div><strong>bluejay fuel</strong></div>
          <div className="date-switcher">
            <button aria-label="Previous day" onClick={() => moveDate(-1)}><ArrowLeft size={17} /></button>
            <button className="date-label" onClick={() => setSelectedDate(dateKey())}><CalendarDays size={17} /><span>{selectedDate === dateKey() ? "Today" : formatDate(selectedDate, { weekday: "short", month: "short", day: "numeric" })}</span><ChevronDown size={15} /></button>
            <button aria-label="Next day" onClick={() => moveDate(1)}><ArrowRight size={17} /></button>
          </div>
          <button className="help-button" aria-label="Help"><span>?</span><span className="help-label">Help</span></button>
        </header>

        <div className="page-wrap">
          {activeView === "today" && <TodayView day={day} totals={totals} goals={state.goals} waterGoal={state.waterGoal} favoriteFoods={favoriteFoods} mostLoggedFoods={mostLoggedFoods} foodUsage={foodUsage} onOpenAdd={openAddFood} onOpenMacroEntry={() => setMacroEntryOpen(true)} onUpdateEntry={updateEntry} onRemoveEntry={removeEntry} onRemoveMacroEntry={removeMacroEntry} onAddWater={addWater} onRemoveWater={removeWater} onToggleFavorite={toggleFavorite} />}
          {activeView === "foods" && <FoodsView foods={menuFoods} menuStatus={menuStatus} menuFetchedAt={menuFetchedAt} favoriteFoods={favoriteFoods} foodUsage={foodUsage} onOpenAdd={openAddFood} onToggleFavorite={toggleFavorite} />}
          {activeView === "weight" && <WeightView state={state} selectedDate={selectedDate} weightDraft={weightDraft} weightRange={weightRange} setWeightDraft={setWeightDraft} setWeightRange={setWeightRange} onUnitChange={(unit) => setState((current) => ({ ...current, preferredWeightUnit: unit }))} onAddWeight={addWeight} onDeleteWeight={(id) => setState((current) => ({ ...current, weights: current.weights.filter((entry) => entry.id !== id) }))} />}
          {activeView === "settings" && <SettingsView state={state} calcWeight={calcWeight} calcWorkoutDays={calcWorkoutDays} calcGoal={calcGoal} setCalcWeight={setCalcWeight} setCalcWorkoutDays={setCalcWorkoutDays} setCalcGoal={setCalcGoal} onApplyGuided={applyGuidedGoals} onOpenOnboarding={() => { setOnboardingDraft(profileToDraft(state.profile, state.waterGoal)); setOnboardingStep(1); setOnboardingOpen(true); }} onUpdateGoal={updateGoal} onExport={() => exportState(state)} onImport={() => importRef.current?.click()} />}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.map((item) => <NavButton key={item.id} item={item} activeView={activeView} onClick={setActiveView} mobile />)}
      </nav>

      <input ref={importRef} type="file" accept="application/json" className="visually-hidden" onChange={handleImport} />
      {addFoodOpen && <AddFoodModal foods={visibleFoods} meal={modalMeal} query={modalQuery} location={modalLocation} tagFilter={modalTagFilter} selectedFood={selectedFood} servings={servings} foodUsage={foodUsage} setQuery={setModalQuery} setLocation={setModalLocation} setTagFilter={setModalTagFilter} setMeal={setModalMeal} setSelectedFood={setSelectedFood} setServings={setServings} onAdd={addFoodToDay} onClose={() => setAddFoodOpen(false)} onToggleFavorite={toggleFavorite} favoriteIds={state.favorites} />}
      {macroEntryOpen && <MacroEntryModal onAdd={addMacroEntry} onClose={() => setMacroEntryOpen(false)} />}
      {onboardingOpen && <OnboardingModal step={onboardingStep} draft={onboardingDraft} setStep={setOnboardingStep} setDraft={setOnboardingDraft} goals={calculateGoals({ age: Number(onboardingDraft.age) || 20, sex: onboardingDraft.sex, height: Number(onboardingDraft.height) || 68, heightUnit: onboardingDraft.heightUnit, weight: Number(onboardingDraft.weight) || 150, weightUnit: onboardingDraft.weightUnit, workoutDays: Math.min(7, Math.max(0, Number(onboardingDraft.workoutDays) || 0)), goal: onboardingDraft.goal, onboardingComplete: true })} onFinish={finishOnboarding} onClose={() => setOnboardingOpen(false)} />}
      {toast && <div className="toast"><Check size={17} /> {toast}</div>}
    </div>
  );
}

function NavButton({ item, activeView, onClick, mobile = false }: { item: (typeof NAV_ITEMS)[number]; activeView: View; onClick: (view: View) => void; mobile?: boolean }) {
  const Icon = item.icon;
  return <button className={`nav-button ${activeView === item.id ? "active" : ""} ${mobile ? "mobile-nav-button" : ""}`} onClick={() => onClick(item.id)}><Icon size={mobile ? 21 : 19} /><span>{item.label}</span>{item.id === "today" && !mobile && <span className="nav-live" />}</button>;
}

function TodayView({ day, totals, goals, waterGoal, favoriteFoods, mostLoggedFoods, foodUsage, onOpenAdd, onOpenMacroEntry, onUpdateEntry, onRemoveEntry, onRemoveMacroEntry, onAddWater, onRemoveWater, onToggleFavorite }: { day: ReturnType<typeof emptyDay>; totals: Nutrition; goals: Goals; waterGoal: number; favoriteFoods: Food[]; mostLoggedFoods: Food[]; foodUsage: FoodUsageMap; onOpenAdd: (meal?: MealName, food?: Food) => void; onOpenMacroEntry: () => void; onUpdateEntry: (mealName: string, entryId: string, servings: number) => void; onRemoveEntry: (mealName: string, entryId: string) => void; onRemoveMacroEntry: (entryId: string) => void; onAddWater: (amount: number) => void; onRemoveWater: (entryId: string) => void; onToggleFavorite: (foodId: string) => void }) {
  const caloriesLeft = goals.calories - totals.calories;
  const progress = getProgress(totals.calories, goals.calories);
  return <>
    <section className="welcome-row"><div><p className="eyebrow">Your day at a glance</p><h1>Fuel your <span>Blue Jay</span> life.</h1><p className="subhead">A little structure for the days that move fast.</p></div><button className="primary-button" onClick={() => onOpenAdd("Lunch")}><Plus size={18} /> Log food</button></section>
    <section className="dashboard-grid">
      <div className="calorie-card card">
        <div className="card-kicker"><span className="icon-bubble blue"><Flame size={17} /></span><span>Daily fuel</span><span className="kicker-meta">{progress}% of goal</span></div>
        <div className="calorie-main"><div className="ring-wrap"><div className="progress-ring" style={{ background: `conic-gradient(#244f9f ${progress * 3.6}deg, #e8eef7 0deg)` }}><div className="ring-inner"><strong>{formatNumber(Math.max(0, caloriesLeft))}</strong><span>left</span></div></div></div><div><div className="calorie-total"><strong>{formatNumber(totals.calories)}</strong><span> / {formatNumber(goals.calories)} kcal</span></div><p className="muted">{caloriesLeft >= 0 ? "You have room to fuel up." : `${formatNumber(Math.abs(caloriesLeft))} kcal over target`}</p></div></div>
        <div className="macro-progress-list">{MACRO_META.slice(1).map((macro) => <div className="macro-progress" key={macro.key}><div className="macro-progress-label"><span><i style={{ background: macro.color }} />{macro.label}</span><strong>{formatNumber(totals[macro.key])}<small> / {formatNumber(goals[macro.key])}{macro.unit === "g" ? "g" : ""}</small></strong></div><div className="bar-track"><div className="bar-fill" style={{ width: `${getProgress(totals[macro.key], goals[macro.key])}%`, background: macro.color }} /></div></div>)}</div>
      </div>
      <WaterCard entries={day.waterEntries} goal={waterGoal} onAdd={onAddWater} onRemove={onRemoveWater} />
    </section>

    <section className="section-heading"><div><p className="eyebrow">Your log</p><h2>Meals & snacks</h2></div><button className="text-button" onClick={() => onOpenAdd("Lunch")}><Plus size={16} /> Add entry</button></section>
    <section className="meal-list">{MEALS.map((meal) => <MealCard key={meal} meal={meal} entries={day.meals[meal] ?? []} onOpenAdd={onOpenAdd} onUpdateEntry={onUpdateEntry} onRemoveEntry={onRemoveEntry} />)}</section>

    <section className="section-heading macro-sources-heading"><div><p className="eyebrow">Macro accounting</p><h2>Where your macros came from</h2></div><button className="text-button" onClick={onOpenMacroEntry}><Plus size={16} /> Add outside source</button></section>
    <MacroSources day={day} onRemoveMacroEntry={onRemoveMacroEntry} />

    <section className="section-heading quick-heading"><div><p className="eyebrow">Make it easy</p><h2>{mostLoggedFoods.length ? "Most logged by you" : "Quick add"}</h2></div><span className="section-note">{mostLoggedFoods.length ? "Sorted from your on-device history" : "Star foods you love"}</span></section>
    <section className="quick-grid">{[...mostLoggedFoods, ...favoriteFoods.filter((food) => !mostLoggedFoods.some((logged) => logged.id === food.id))].slice(0, 4).map((food) => <QuickFoodCard key={food.id} food={food} loggedCount={foodUsage.get(food.id)?.count ?? 0} isFavorite={favoriteFoods.some((fav) => fav.id === food.id)} onAdd={() => onOpenAdd("Snacks", food)} onToggleFavorite={() => onToggleFavorite(food.id)} />)}{mostLoggedFoods.length === 0 && favoriteFoods.length === 0 && <div className="empty-inline">Log a food or star a favorite and it’ll show up here.</div>}</section>
  </>;
}

function WaterCard({ entries, goal, onAdd, onRemove }: { entries: WaterEntry[]; goal: number; onAdd: (amount: number) => void; onRemove: (entryId: string) => void }) {
  const [customAmount, setCustomAmount] = useState("");
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const progress = getProgress(total, goal);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(customAmount);
    if (!amount || amount <= 0) return;
    onAdd(amount);
    setCustomAmount("");
  }
  return <div className="water-card card"><div className="water-card-top"><div className="focus-top"><span className="icon-bubble blue"><Droplets size={17} /></span><span>Hydration</span></div><strong>{formatNumber(total)} <small>/ {formatNumber(goal)} oz</small></strong></div><div className="water-progress"><div className="water-progress-fill" style={{ width: `${progress}%` }} /></div><p className="water-helper">{total >= goal ? "Water goal reached — nice work." : `${formatNumber(Math.max(0, goal - total))} oz to your daily goal`}</p><div className="water-actions"><button type="button" onClick={() => onAdd(8)}>+8 oz</button><button type="button" onClick={() => onAdd(16)}>+16 oz</button><form onSubmit={submit}><input aria-label="Custom water amount in ounces" type="number" min="1" max="128" step="1" value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} placeholder="oz" /><button type="submit" aria-label="Add custom water amount"><Plus size={14} /></button></form></div>{entries.length > 0 && <div className="water-log">{entries.slice(-3).reverse().map((entry) => <div key={entry.id}><span>{formatNumber(entry.amount)} oz</span><button onClick={() => onRemove(entry.id)} aria-label={`Remove ${formatNumber(entry.amount)} ounces`}><X size={13} /></button></div>)}</div>}</div>;
}

function MacroSources({ day, onRemoveMacroEntry }: { day: ReturnType<typeof emptyDay>; onRemoveMacroEntry: (entryId: string) => void }) {
  const sources = Object.entries(day.meals).flatMap(([meal, entries]) => entries.flatMap((entry) => {
    const addOnNutrition = (entry.addOns ?? []).reduce((total, addOn) => sumNutrition(total, scaleAddOn(addOn, addOn.quantity * entry.servings)), { calories: 0, protein: 0, carbs: 0, fat: 0 });
    const baseSource = { id: entry.id, name: entry.foodName, detail: `${entry.locationName} · ${meal} · ${formatNumber(entry.servings)}x`, nutrition: subtractNutrition(entry.nutrition, addOnNutrition), removable: false };
    const addOnSources = (entry.addOns ?? []).map((addOn) => ({ id: `${entry.id}-${addOn.id}`, name: `+ ${addOn.name}`, detail: `${entry.foodName} · ${formatNumber(addOn.quantity * entry.servings)}x add-on`, nutrition: scaleAddOn(addOn, addOn.quantity * entry.servings), removable: false }));
    return [baseSource, ...addOnSources];
  })).concat(day.customMacros.map((entry) => ({ id: entry.id, name: entry.name, detail: entry.sourceLabel, nutrition: entry.nutrition, removable: true })));
  return <section className="macro-sources card">{sources.length ? <><div className="source-grid source-grid-head"><span>Source</span><span>Calories</span><span>Protein</span><span>Carbs</span><span>Fat</span><span /></div>{sources.map((source) => <div className="source-grid source-grid-row" key={source.id}><div className="source-name"><strong>{source.name}</strong><small>{source.detail}</small></div><span>{formatNumber(source.nutrition.calories)}</span><strong>{formatNumber(source.nutrition.protein)}g</strong><span>{formatNumber(source.nutrition.carbs)}g</span><span>{formatNumber(source.nutrition.fat)}g</span>{source.removable ? <button className="delete-button" onClick={() => onRemoveMacroEntry(source.id)} aria-label={`Remove ${source.name}`}><Trash2 size={14} /></button> : <span />}</div>)}</> : <div className="empty-state small"><Target size={23} /><strong>No macro sources yet</strong><span>Log a Hopkins food or add an outside source to see the breakdown.</span></div>}</section>;
}

function MealCard({ meal, entries, onOpenAdd, onUpdateEntry, onRemoveEntry }: { meal: string; entries: MealEntry[]; onOpenAdd: (meal?: MealName) => void; onUpdateEntry: (mealName: string, entryId: string, servings: number) => void; onRemoveEntry: (mealName: string, entryId: string) => void }) {
  const total = sumEntries(entries);
  return <article className="meal-card card"><div className="meal-heading"><div className="meal-title"><span className={`meal-icon ${meal.toLowerCase()}`}><MealIcon meal={meal} /></span><div><h3>{meal}</h3><span>{entries.length ? `${formatNumber(total.calories)} kcal` : "Nothing logged yet"}</span></div></div><button className="round-add" aria-label={`Add to ${meal}`} onClick={() => onOpenAdd(meal as MealName)}><Plus size={18} /></button></div>{entries.length > 0 && <div className="entry-list">{entries.map((entry) => <div className="entry-row" key={entry.id}><div className="entry-info"><strong>{entry.foodName}</strong><span>{entry.servingSize} · {entry.locationName}</span>{entry.addOns?.length ? <small className="entry-add-ons">+ {entry.addOns.map((addOn) => `${addOn.quantity > 1 ? `${formatNumber(addOn.quantity)}× ` : ""}${addOn.name}`).join(", ")}</small> : null}</div><div className="entry-macros"><strong>{formatNumber(entry.nutrition.calories)}</strong><span>kcal</span></div><div className="serving-stepper"><button onClick={() => onUpdateEntry(meal, entry.id, entry.servings - 0.25)} aria-label="Decrease serving">−</button><span>{formatNumber(entry.servings)}x</span><button onClick={() => onUpdateEntry(meal, entry.id, entry.servings + 0.25)} aria-label="Increase serving">+</button></div><button className="delete-button" onClick={() => onRemoveEntry(meal, entry.id)} aria-label={`Remove ${entry.foodName}`}><Trash2 size={15} /></button></div>)}</div>}</article>;
}

function MealIcon({ meal }: { meal: string }) {
  if (meal === "Breakfast") return <span>☀</span>;
  if (meal === "Lunch") return <span>◒</span>;
  if (meal === "Dinner") return <span>☾</span>;
  return <span>✦</span>;
}

function QuickFoodCard({ food, loggedCount, isFavorite, onAdd, onToggleFavorite }: { food: Food; loggedCount: number; isFavorite: boolean; onAdd: () => void; onToggleFavorite: () => void }) {
  return <button className="quick-food-card" onClick={onAdd}><FoodTags food={food} compact /><div className="quick-food-info"><strong>{food.name}</strong><span>{loggedCount ? `Logged ${loggedCount} time${loggedCount === 1 ? "" : "s"}` : `${food.calories} kcal · ${food.protein}g protein`}</span></div><span className={`favorite-button ${isFavorite ? "saved" : ""}`} onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }}><Heart size={16} fill={isFavorite ? "currentColor" : "none"} /></span></button>;
}

function FoodsView({ foods: sourceFoods, menuStatus, menuFetchedAt, favoriteFoods, foodUsage, onOpenAdd, onToggleFavorite }: { foods: Food[]; menuStatus: "loading" | "live" | "fallback"; menuFetchedAt: string; favoriteFoods: Food[]; foodUsage: FoodUsageMap; onOpenAdd: (meal?: MealName, food?: Food) => void; onToggleFavorite: (foodId: string) => void }) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const foods = sortFoodsByUsage(sourceFoods.filter((food) => {
    const matchQuery = !query || `${food.name} ${food.description} ${food.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase());
    return matchQuery && (location === "all" || food.locationId === location) && matchesFoodTag(food, tagFilter);
  }), foodUsage);
  const fetchedLabel = menuFetchedAt ? `Updated ${new Date(menuFetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Waiting for menu data";
  return <><section className="welcome-row compact"><div><p className="eyebrow">Hopkins dining today</p><h1>Find your <span>fuel.</span></h1><p className="subhead">What’s actually on the menu, with nutrition when Hopkins provides it.</p></div><div className={`api-badge ${menuStatus}`}><span className="status-dot" />{menuStatus === "live" ? "Live Nutrislice menu" : menuStatus === "loading" ? "Loading today’s menu" : "Fallback snapshot"}</div></section><div className="catalog-disclaimer">{menuStatus === "live" ? "Live menu data is pulled from Hopkins Dining’s Nutrislice feed. Recipes, portions, and allergen details can change at the dining location." : "The live menu feed was unavailable, so this is a starter snapshot for planning only. Check Hopkins Dining for today’s recipes, portions, and allergen details."} <a href={NUTRISLICE_LOCATIONS[0].menuUrl} target="_blank" rel="noreferrer">Open Hopkins menus ↗</a></div><section className="food-toolbar"><label className="search-field"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search today’s foods, tags, or ingredients" /><kbd>⌘ K</kbd></label><label className="select-field"><SlidersHorizontal size={16} /><select value={location} onChange={(event) => setLocation(event.target.value)}><option value="all">All locations</option>{NUTRISLICE_LOCATIONS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></label><label className="select-field"><select aria-label="Filter by dietary tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>{FOOD_TAG_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select><ChevronDown size={15} /></label></section><div className="catalog-meta"><span>{foods.length} items available · {menuStatus === "live" ? "live source" : "starter data"}</span><span>{foodUsage.size ? "Most logged first · " : "Alphabetical until you log food · "}{fetchedLabel} · Nutrition values per serving</span></div><section className="food-grid">{foods.map((food) => <CatalogFoodCard key={food.id} food={food} loggedCount={foodUsage.get(food.id)?.count ?? 0} saved={favoriteFoods.some((item) => item.id === food.id)} onAdd={() => onOpenAdd("Lunch", food)} onToggleFavorite={() => onToggleFavorite(food.id)} />)}</section></>;
}

function CatalogFoodCard({ food, loggedCount, saved, onAdd, onToggleFavorite }: { food: Food; loggedCount: number; saved: boolean; onAdd: () => void; onToggleFavorite: () => void }) {
  return <article className="catalog-food-card card"><div className="catalog-food-top"><FoodTags food={food} /><button className={`favorite-button ${saved ? "saved" : ""}`} onClick={onToggleFavorite}><Heart size={17} fill={saved ? "currentColor" : "none"} /></button></div><div className="food-location">{food.locationName}</div><h3>{food.name}</h3><p>{food.description}</p><div className="nutrition-strip"><span><strong>{food.calories}</strong> kcal</span><span><strong>{food.protein}g</strong> protein</span><span><strong>{food.carbs}g</strong> carbs</span><span><strong>{food.fat}g</strong> fat</span></div><div className="food-card-footer"><span>{loggedCount ? `Logged ${loggedCount}×` : food.servingSize}</span><button className="small-add" onClick={onAdd}><Plus size={15} /> Log food</button></div></article>;
}

function AddFoodModal({ foods, meal, query, location, tagFilter, selectedFood, servings, foodUsage, setQuery, setLocation, setTagFilter, setMeal, setSelectedFood, setServings, onAdd, onClose, onToggleFavorite, favoriteIds }: { foods: Food[]; meal: MealName; query: string; location: string; tagFilter: string; selectedFood: Food | null; servings: number; foodUsage: FoodUsageMap; setQuery: (value: string) => void; setLocation: (value: string) => void; setTagFilter: (value: string) => void; setMeal: (value: MealName) => void; setSelectedFood: (food: Food | null) => void; setServings: (value: number) => void; onAdd: (addOns: MealAddOn[]) => void; onClose: () => void; onToggleFavorite: (foodId: string) => void; favoriteIds: string[] }) {
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, number>>({});
  const addOnOptions = selectedFood ? addOnsForFood(selectedFood) : [];
  const chosenAddOns = addOnOptions.filter((addOn) => (selectedAddOns[addOn.id] ?? 0) > 0).map((addOn) => ({ ...addOn, quantity: selectedAddOns[addOn.id] }));
  const selectedNutrition = selectedFood ? nutritionForMeal(selectedFood, servings, chosenAddOns) : null;

  function chooseFood(food: Food) {
    setSelectedFood(food);
    setSelectedAddOns({});
  }

  function toggleAddOn(addOn: FoodAddOn) {
    setSelectedAddOns((current) => ({ ...current, [addOn.id]: current[addOn.id] ? 0 : 1 }));
  }

  function changeAddOnQuantity(addOn: FoodAddOn, amount: number) {
    setSelectedAddOns((current) => ({ ...current, [addOn.id]: Math.min(4, Math.max(0, Math.round(amount * 4) / 4)) }));
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="food-modal" role="dialog" aria-modal="true" aria-labelledby="add-food-title"><div className="modal-header"><div><p className="eyebrow">Build your log</p><h2 id="add-food-title">Add a food</h2></div><button className="close-button" onClick={onClose}><X size={19} /></button></div><div className="modal-controls"><label className="search-field"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the dining catalog" /></label><label className="select-field"><select value={location} onChange={(event) => setLocation(event.target.value)}><option value="all">All locations</option>{NUTRISLICE_LOCATIONS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></label><label className="select-field"><select aria-label="Filter by dietary tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>{FOOD_TAG_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select><ChevronDown size={15} /></label></div><div className="meal-tabs">{MEALS.map((item) => <button key={item} className={meal === item ? "active" : ""} onClick={() => setMeal(item)}>{item}</button>)}</div><p className="food-sort-note">{foodUsage.size ? "Most logged by you appears first." : "Your most logged foods will appear first after you start logging."}</p><div className="food-modal-list">{foods.map((food) => { const loggedCount = foodUsage.get(food.id)?.count ?? 0; return <button key={food.id} className={`modal-food-row ${selectedFood?.id === food.id ? "selected" : ""}`} onClick={() => chooseFood(food)}><FoodTags food={food} compact /><span className="modal-food-copy"><strong>{food.name}</strong><small>{food.locationName} · {food.servingSize}{loggedCount ? ` · Logged ${loggedCount}×` : ""}</small></span><span className="modal-food-kcal">{food.calories}<small> kcal</small></span><span className={`favorite-button ${favoriteIds.includes(food.id) ? "saved" : ""}`} onClick={(event) => { event.stopPropagation(); onToggleFavorite(food.id); }}><Heart size={16} fill={favoriteIds.includes(food.id) ? "currentColor" : "none"} /></span></button>; })}{foods.length === 0 && <div className="empty-state small"><Search size={24} /><strong>No foods found</strong><span>Try a different search or location.</span></div>}</div>{selectedFood && addOnOptions.length > 0 && <section className="add-on-panel"><div className="add-on-heading"><div><strong>Customize your {selectedFood.name}</strong><span>Optional add-ons · quantities are per serving</span></div><span className="add-on-estimate">Standard estimates</span></div>{(["protein", "topping"] as const).map((category) => <div className="add-on-group" key={category}><span className="add-on-group-label">{category === "protein" ? "Add protein" : "Toppings"}</span>{addOnOptions.filter((addOn) => addOn.category === category).map((addOn) => { const quantity = selectedAddOns[addOn.id] ?? 0; return <div className={`add-on-option ${quantity ? "selected" : ""}`} key={addOn.id}><button type="button" className="add-on-toggle" onClick={() => toggleAddOn(addOn)}><span className="add-on-check">{quantity ? "✓" : ""}</span><span className="add-on-copy"><strong>{addOn.name}</strong><small>{addOn.servingSize} · +{addOn.calories} kcal · +{formatNumber(addOn.protein)}g protein</small></span></button>{quantity > 0 && <div className="add-on-stepper"><button type="button" onClick={() => changeAddOnQuantity(addOn, quantity - 0.25)} aria-label={`Decrease ${addOn.name}`}>−</button><span>{formatNumber(quantity)}x</span><button type="button" onClick={() => changeAddOnQuantity(addOn, quantity + 0.25)} aria-label={`Increase ${addOn.name}`}>+</button></div>}</div>; })}</div>)}</section>}{selectedFood && <div className="selected-food-panel"><div><strong>{selectedFood.name}</strong><span>{selectedNutrition ? `${formatNumber(selectedNutrition.calories)} kcal · ${formatNumber(selectedNutrition.protein)}g protein` : ""} per {selectedFood.servingSize}{chosenAddOns.length ? ` · ${chosenAddOns.length} add-on${chosenAddOns.length === 1 ? "" : "s"}` : ""}</span></div><div className="serving-control"><span>Servings</span><div className="serving-stepper large"><button type="button" onClick={() => setServings(Math.max(0.25, servings - 0.25))}>−</button><strong>{formatNumber(servings)}</strong><button type="button" onClick={() => setServings(Math.min(20, servings + 0.25))}>+</button></div></div><button type="button" className="primary-button modal-add" onClick={() => onAdd(chosenAddOns)}><Plus size={17} /> Add to {meal.toLowerCase()}</button></div>}</div></div>;
}

function MacroEntryModal({ onAdd, onClose }: { onAdd: (entry: Omit<MacroEntry, "id" | "createdAt">) => void; onClose: () => void }) {
  const [draft, setDraft] = useState({ name: "", calories: "", protein: "", carbs: "", fat: "" });
  function update(key: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const protein = Math.max(0, Number(draft.protein) || 0);
    const carbs = Math.max(0, Number(draft.carbs) || 0);
    const fat = Math.max(0, Number(draft.fat) || 0);
    const calories = Math.max(0, Number(draft.calories) || protein * 4 + carbs * 4 + fat * 9);
    if (!draft.name.trim() || protein + carbs + fat === 0) return;
    onAdd({ name: draft.name.trim(), sourceLabel: "Outside source", nutrition: { calories: Math.round(calories), protein, carbs, fat } });
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="macro-modal card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Outside the dining hall</p><h2>Add macro source</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close macro source form"><X size={19} /></button></div><p className="macro-modal-copy">Add protein powder, a snack, or anything else you ate. Leave calories blank to estimate them from the macros.</p><label className="form-label">Name<input className="plain-input" required value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="Protein powder" /></label><div className="macro-entry-grid"><label className="form-label">Calories<input className="plain-input" type="number" min="0" step="1" value={draft.calories} onChange={(event) => update("calories", event.target.value)} placeholder="Auto" /></label><label className="form-label">Protein (g)<input className="plain-input" type="number" min="0" step="0.1" value={draft.protein} onChange={(event) => update("protein", event.target.value)} placeholder="30" /></label><label className="form-label">Carbs (g)<input className="plain-input" type="number" min="0" step="0.1" value={draft.carbs} onChange={(event) => update("carbs", event.target.value)} placeholder="0" /></label><label className="form-label">Fat (g)<input className="plain-input" type="number" min="0" step="0.1" value={draft.fat} onChange={(event) => update("fat", event.target.value)} placeholder="0" /></label></div><div className="macro-modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><Plus size={16} /> Add source</button></div></form></div>;
}

function WeightView({ state, selectedDate, weightDraft, weightRange, setWeightDraft, setWeightRange, onUnitChange, onAddWeight, onDeleteWeight }: { state: TrackerState; selectedDate: string; weightDraft: string; weightRange: "1m" | "3m" | "all"; setWeightDraft: (value: string) => void; setWeightRange: (value: "1m" | "3m" | "all") => void; onUnitChange: (unit: "lb" | "kg") => void; onAddWeight: (event: FormEvent<HTMLFormElement>) => void; onDeleteWeight: (id: string) => void }) {
  const unit = state.preferredWeightUnit;
  const now = new Date(`${selectedDate}T12:00:00`);
  const start = new Date(now);
  if (weightRange === "1m") start.setDate(start.getDate() - 30);
  if (weightRange === "3m") start.setDate(start.getDate() - 90);
  const entries = state.weights.filter((entry) => new Date(`${entry.date}T12:00:00`) >= start).sort((a, b) => a.date.localeCompare(b.date));
  const values = entries.map((entry) => entry.unit === unit ? entry.value : unit === "lb" ? entry.value * 2.20462 : entry.value / 2.20462);
  const latest = values[values.length - 1];
  const first = values[0];
  const change = latest !== undefined && first !== undefined ? latest - first : 0;
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const padding = Math.max((max - min) * 0.25, 2);
  const low = min - padding;
  const high = max + padding;
  const points = values.map((value, index) => ({ x: values.length === 1 ? 300 : 32 + (index / (values.length - 1)) * 536, y: 204 - ((value - low) / Math.max(high - low, 1)) * 168, value, date: entries[index].date }));
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return <><section className="welcome-row compact"><div><p className="eyebrow">Progress, not perfection</p><h1>Track your <span>trend.</span></h1><p className="subhead">Log a weigh-in whenever it feels useful to you.</p></div><div className="weight-stat-chip"><Weight size={18} /><div><strong>{latest !== undefined ? `${formatNumber(latest)} ${unit}` : "—"}</strong><span>latest check-in</span></div><div className="unit-toggle" aria-label="Weight unit"><button className={unit === "lb" ? "active" : ""} onClick={() => onUnitChange("lb")}>lb</button><button className={unit === "kg" ? "active" : ""} onClick={() => onUnitChange("kg")}>kg</button></div></div></section><section className="weight-grid"><div className="chart-card card"><div className="chart-header"><div><h2>Weight trend</h2><p>{entries.length ? `${entries.length} check-in${entries.length === 1 ? "" : "s"} in this view` : "Your chart will come alive after your first check-in."}</p></div><div className="range-tabs">{(["1m", "3m", "all"] as const).map((range) => <button key={range} className={weightRange === range ? "active" : ""} onClick={() => setWeightRange(range)}>{range === "all" ? "All" : range === "1m" ? "1 month" : "3 months"}</button>)}</div></div>{points.length ? <div className="chart-wrap"><svg viewBox="0 0 600 240" role="img" aria-label="Weight trend chart"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#244f9f" stopOpacity=".17" /><stop offset="100%" stopColor="#244f9f" stopOpacity="0" /></linearGradient></defs><line x1="32" y1="204" x2="568" y2="204" className="chart-grid-line" /><line x1="32" y1="120" x2="568" y2="120" className="chart-grid-line" /><line x1="32" y1="36" x2="568" y2="36" className="chart-grid-line" /><text x="0" y="40">{Math.round(high)}</text><text x="0" y="124">{Math.round((high + low) / 2)}</text><text x="0" y="208">{Math.round(low)}</text>{points.length > 1 && <path d={`${path} L${points[points.length - 1].x},220 L${points[0].x},220 Z`} fill="url(#chartFill)" />}<path d={path} className="chart-line" />{points.map((point) => <g key={`${point.date}-${point.x}`}><circle cx={point.x} cy={point.y} r="5" className="chart-dot" /><text x={point.x} y="232" textAnchor="middle">{formatShortDate(point.date)}</text></g>)}</svg></div> : <div className="empty-state chart-empty"><div className="empty-chart-icon"><LineChart size={25} /></div><strong>No weigh-ins yet</strong><span>Start with today’s number below. You can always add another later.</span></div>}</div><div className="weight-side"><form className="log-weight-card card" onSubmit={onAddWeight}><div className="card-kicker"><span className="icon-bubble purple"><Weight size={17} /></span><span>New check-in</span></div><h2>How are you doing today?</h2><p>There’s no perfect number. This is just information for you.</p><label className="form-label">Weight <span>({unit})</span><div className="number-input"><input type="number" min="1" max="1000" step="0.1" value={weightDraft} onChange={(event) => setWeightDraft(event.target.value)} placeholder="0.0" /><span>{unit}</span></div></label><div className="selected-date-note"><CalendarDays size={15} /> Logging for {formatDate(selectedDate, { month: "short", day: "numeric", year: "numeric" })}</div><button className="primary-button full-width" type="submit"><Plus size={17} /> Log weight</button></form><div className="weight-summary card"><div className="summary-metric"><span>Change in view</span><strong className={change > 0 ? "up" : change < 0 ? "down" : ""}>{values.length > 1 ? `${change > 0 ? "+" : ""}${formatNumber(change)} ${unit}` : "—"}</strong></div><div className="summary-metric"><span>Range</span><strong>{values.length ? `${formatNumber(min)}–${formatNumber(max)}` : "—"}</strong></div></div></div></section><section className="section-heading weight-history-heading"><div><p className="eyebrow">Your history</p><h2>Recent check-ins</h2></div><span className="section-note">Stored only on this device</span></section><section className="weight-history card">{state.weights.length ? [...state.weights].reverse().slice(0, 8).map((entry) => <div className="weight-history-row" key={entry.id}><div className="history-date"><span className="history-day">{new Date(`${entry.date}T12:00:00`).getDate()}</span><div><strong>{formatDate(entry.date, { weekday: "short", month: "short" })}</strong><span>{entry.date === dateKey() ? "Today" : "Logged on device"}</span></div></div><strong>{formatNumber(entry.value)} <small>{entry.unit}</small></strong><button className="delete-button" onClick={() => onDeleteWeight(entry.id)} aria-label="Delete weight entry"><Trash2 size={15} /></button></div>) : <div className="empty-state small"><Weight size={24} /><strong>Your check-ins will appear here</strong><span>Only you can see these entries.</span></div>}</section></>;
}

function SettingsView({ state, calcWeight, calcWorkoutDays, calcGoal, setCalcWeight, setCalcWorkoutDays, setCalcGoal, onApplyGuided, onOpenOnboarding, onUpdateGoal, onExport, onImport }: { state: TrackerState; calcWeight: string; calcWorkoutDays: string; calcGoal: string; setCalcWeight: (value: string) => void; setCalcWorkoutDays: (value: string) => void; setCalcGoal: (value: string) => void; onApplyGuided: () => void; onOpenOnboarding: () => void; onUpdateGoal: (key: keyof Goals, value: string) => void; onExport: () => void; onImport: () => void }) {
  return <><section className="welcome-row compact"><div><p className="eyebrow">Make it yours</p><h1>Your plan, your <span>pace.</span></h1><p className="subhead">Tune your targets and keep your data close.</p></div></section><section className="settings-grid"><div className="goals-card card"><div className="card-kicker"><span className="icon-bubble blue"><Target size={17} /></span><span>Daily targets</span></div><h2>What are you aiming for?</h2><p>These numbers guide your dashboard and remaining macros.</p><div className="goal-input-grid">{MACRO_META.map((macro) => <label key={macro.key} className="form-label">{macro.label}<div className="number-input"><input type="number" min="0" step="1" value={state.goals[macro.key]} onChange={(event) => onUpdateGoal(macro.key, event.target.value)} /><span>{macro.unit}</span></div></label>)}</div><div className="settings-divider" /><div className="guided-header"><div><span className="guided-icon"><Sparkles size={16} /></span><div><h3>Guided setup</h3><p>Get a starting point, then make it yours.</p></div></div><button className="text-button" onClick={onOpenOnboarding}><Calculator size={15} /> Full setup</button></div><div className="guided-grid"><label className="form-label">Weight (lb)<input className="plain-input" type="number" value={calcWeight} onChange={(event) => setCalcWeight(event.target.value)} /></label><label className="form-label slider-field"><span>Workout days / week <strong>{calcWorkoutDays}</strong></span><input className="range-input" type="range" min="0" max="7" step="1" value={calcWorkoutDays} onChange={(event) => setCalcWorkoutDays(event.target.value)} /><small>How many days you intentionally work out</small></label><label className="form-label">Direction<select className="plain-input" value={calcGoal} onChange={(event) => setCalcGoal(event.target.value)}><option value="maintain">Maintain</option><option value="lose">Lose slowly</option><option value="gain">Gain slowly</option></select></label></div><button className="secondary-button" onClick={onApplyGuided}><Sparkles size={16} /> Suggest targets</button></div><div className="settings-side"><div className="privacy-card card"><div className="privacy-icon"><SlidersHorizontal size={20} /></div><h2>Your data stays yours.</h2><p>BlueJay Fuel stores your goals, meals, favorites, and weight history in this browser. There is no account and no personal data in the public catalog API.</p><div className="privacy-status"><span className="status-dot" /> Local storage active</div></div><div className="backup-card card"><div className="card-kicker"><Download size={17} /><span>Backup & restore</span></div><h3>Take your data with you</h3><p>Export a private JSON backup before switching devices or clearing browser data.</p><div className="backup-buttons"><button className="secondary-button" onClick={onExport}><Download size={15} /> Export</button><button className="secondary-button" onClick={onImport}><ArrowLeft size={15} /> Import</button></div></div><div className="about-card"><div className="about-logo">B</div><div><strong>BlueJay Fuel v1.0</strong><span>Homewood starter catalog · Fall 2026</span></div></div></div></section></>;
}

function OnboardingModal({ step, draft, goals, setStep, setDraft, onFinish, onClose }: { step: number; draft: OnboardingDraft; goals: Goals; setStep: (step: number) => void; setDraft: (draft: OnboardingDraft) => void; onFinish: (goals: Goals) => void; onClose: () => void }) {
  const update = <K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) => setDraft({ ...draft, [key]: value });
  const next = () => setStep(Math.min(4, step + 1));
  const back = () => setStep(Math.max(1, step - 1));
  const [targetDraft, setTargetDraft] = useState<Goals>(goals);
  useEffect(() => setTargetDraft(goals), [goals]);
  const updateTarget = (key: keyof Goals, value: string) => setTargetDraft((current) => ({ ...current, [key]: Math.max(0, Number(value) || 0) }));
  const goalLabels: Record<OnboardingDraft["goal"], string> = { lose: "Lose slowly", maintain: "Maintain", gain: "Gain slowly" };
  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-aside">
          <div className="onboarding-brand"><div className="brand-bird">B</div><strong>bluejay fuel</strong></div>
          <div className="onboarding-aside-copy"><p className="eyebrow">A better starting point</p><h2>Fuel your semester with numbers that fit <em>you.</em></h2><p>We’ll use a standard calorie estimate to create a starting target. You can edit it anytime.</p></div>
          <div className="onboarding-foot"><span className="status-dot" /> Private on this device</div>
        </div>
        <div className="onboarding-body">
          <div className="onboarding-top"><div className="onboarding-steps">{[1, 2, 3, 4].map((item) => <span key={item} className={step >= item ? "active" : ""}>{item}</span>)}</div><button className="close-button" onClick={onClose} aria-label="Close setup"><X size={18} /></button></div>
          {step === 1 && <div className="onboarding-content"><div className="onboarding-icon blue"><UserRound size={21} /></div><p className="eyebrow">Step 1 of 4 · About you</p><h1 id="onboarding-title">Let’s start with the basics.</h1><p className="onboarding-copy">These details help estimate your resting energy needs. They stay on this device.</p><div className="onboarding-form-grid"><label className="form-label">Age<input className="plain-input" type="number" min="13" max="100" value={draft.age} onChange={(event) => update("age", event.target.value)} /></label><label className="form-label">Sex used for estimate<select className="plain-input" value={draft.sex} onChange={(event) => update("sex", event.target.value as OnboardingDraft["sex"])}><option value="female">Female</option><option value="male">Male</option><option value="average">Use an average estimate</option></select></label></div><p className="field-hint">Choose the option that makes the estimate most useful for you. This is not a diagnosis.</p></div>}
          {step === 2 && <div className="onboarding-content"><div className="onboarding-icon orange"><Ruler size={21} /></div><p className="eyebrow">Step 2 of 4 · Your starting point</p><h1>How much space do you take up?</h1><p className="onboarding-copy">Height and weight let us estimate how much energy your body uses at rest.</p><div className="onboarding-form-grid"><label className="form-label">Height<div className="split-input"><input className="plain-input" type="number" min="1" value={draft.height} onChange={(event) => update("height", event.target.value)} /><select className="plain-input" value={draft.heightUnit} onChange={(event) => update("heightUnit", event.target.value as OnboardingDraft["heightUnit"])}><option value="in">in</option><option value="cm">cm</option></select></div></label><label className="form-label">Current weight<div className="split-input"><input className="plain-input" type="number" min="1" value={draft.weight} onChange={(event) => update("weight", event.target.value)} /><select className="plain-input" value={draft.weightUnit} onChange={(event) => update("weightUnit", event.target.value as OnboardingDraft["weightUnit"])}><option value="lb">lb</option><option value="kg">kg</option></select></div></label></div><p className="field-hint">A recent, approximate weight is enough. You can update your weight separately in the tracker.</p></div>}
          {step === 3 && <div className="onboarding-content"><div className="onboarding-icon mint"><Activity size={21} /></div><p className="eyebrow">Step 3 of 4 · Your routine</p><h1>How many days do you work out?</h1><p className="onboarding-copy">Use the slider for the number of days you intentionally exercise in a typical week, then choose a water goal you can actually use.</p><div className="workout-slider-card"><div className="range-value"><strong>{draft.workoutDays}</strong><span>{Number(draft.workoutDays) === 1 ? "day" : "days"} per week</span></div><input className="range-input onboarding-range" type="range" min="0" max="7" step="1" value={draft.workoutDays} onChange={(event) => update("workoutDays", event.target.value)} /><div className="range-scale"><span>0 days</span><span>7 days</span></div></div><label className="form-label onboarding-water-goal">Daily water goal<div className="number-input"><input type="number" min="1" max="512" step="1" value={draft.waterGoal} onChange={(event) => update("waterGoal", event.target.value)} /><span>oz</span></div><small>We’ll use this target on your daily hydration tracker.</small></label><div className="goal-choice"><span className="choice-label">My direction</span><div>{(Object.keys(goalLabels) as OnboardingDraft["goal"][]).map((goal) => <button key={goal} className={draft.goal === goal ? "active" : ""} onClick={() => update("goal", goal)}>{goalLabels[goal]}</button>)}</div></div></div>}
          {step === 4 && <div className="onboarding-content"><div className="onboarding-icon purple"><Calculator size={21} /></div><p className="eyebrow">Step 4 of 4 · Your starting targets</p><h1>Make these numbers yours.</h1><p className="onboarding-copy">We calculated a starting point from your inputs. Adjust any target before saving it.</p><div className="onboarding-result editable-targets">{MACRO_META.map((macro) => <label key={macro.key} className="onboarding-target-input"><span>{macro.label}</span><div className="number-input"><input type="number" min="0" step="1" value={targetDraft[macro.key]} onChange={(event) => updateTarget(macro.key, event.target.value)} /><span>{macro.unit}</span></div></label>)}</div><div className="estimate-note"><Check size={16} /><span>Calculated with the Mifflin–St Jeor equation, workout days, and a modest goal adjustment.</span></div><p className="field-hint">This is general wellness guidance, not medical advice. If you have a medical condition or a history of disordered eating, talk with a qualified professional before changing your intake.</p></div>}
          <div className="onboarding-actions">{step > 1 ? <button className="secondary-button" onClick={back}><ArrowLeft size={16} /> Back</button> : <button className="skip-button" onClick={onClose}>I’ll do this later</button>}{step < 4 ? <button className="primary-button" onClick={next}>Continue <ArrowRight size={16} /></button> : <button className="primary-button" onClick={() => onFinish(targetDraft)}><Check size={16} /> Use these targets</button>}</div>
        </div>
      </div>
    </div>
  );
}

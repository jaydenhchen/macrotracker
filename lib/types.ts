export type MacroKey = "calories" | "protein" | "carbs" | "fat";

export type Nutrition = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type Food = Nutrition & {
  id: string;
  name: string;
  description: string;
  locationId: string;
  locationName: string;
  menuUrl?: string;
  mealPeriods: string[];
  menuType?: string;
  servingSize: string;
  allergens: string[];
  tags: string[];
  addOns?: FoodAddOn[];
  updatedAt: string;
  missingNutrition?: string[];
  stationName?: string;
};

export type FoodAddOn = Nutrition & {
  id: string;
  name: string;
  category: "protein" | "topping";
  servingSize: string;
};

export type Location = {
  id: string;
  name: string;
  shortName: string;
  address: string;
  hours: string;
  accent: string;
};

export type MealEntry = {
  id: string;
  foodId: string;
  foodName: string;
  servingSize: string;
  servings: number;
  nutrition: Nutrition;
  locationName: string;
  nutritionPerServing?: Nutrition;
  addOns?: MealAddOn[];
};

export type MealAddOn = FoodAddOn & {
  quantity: number;
};

export type MacroEntry = {
  id: string;
  name: string;
  nutrition: Nutrition;
  sourceLabel: string;
  createdAt: string;
};

export type WaterEntry = {
  id: string;
  amount: number;
  unit: "oz";
  createdAt: string;
};

export type DayLog = {
  date: string;
  meals: Record<string, MealEntry[]>;
  customMacros: MacroEntry[];
  waterEntries: WaterEntry[];
};

export type WeightEntry = {
  id: string;
  date: string;
  value: number;
  unit: "lb" | "kg";
  createdAt: string;
};

export type Goals = Nutrition;

export type UserProfile = {
  age: number;
  sex: "female" | "male" | "average";
  height: number;
  heightUnit: "in" | "cm";
  weight: number;
  weightUnit: "lb" | "kg";
  workoutDays: number;
  goal: "lose" | "maintain" | "gain";
  onboardingComplete: boolean;
};

export type TrackerState = {
  goals: Goals;
  profile: UserProfile | null;
  dayLogs: Record<string, DayLog>;
  weights: WeightEntry[];
  favorites: string[];
  preferredWeightUnit: "lb" | "kg";
  waterGoal: number;
};

export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"] as const;
export type MealName = (typeof MEALS)[number];

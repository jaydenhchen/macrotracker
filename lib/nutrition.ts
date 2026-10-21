import { MealAddOn, MealEntry, Nutrition } from "./types";

/** Add ingredient quantities before rounding, then keep this basis in the log. */
export function mealNutritionBasis(food: Nutrition, addOns: MealAddOn[] = []): Nutrition {
  return addOns.reduce((total, addOn) => ({
    calories: total.calories + addOn.calories * addOn.quantity,
    protein: total.protein + addOn.protein * addOn.quantity,
    carbs: total.carbs + addOn.carbs * addOn.quantity,
    fat: total.fat + addOn.fat * addOn.quantity,
  }), { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat });
}

function scaleNutrition(basis: Nutrition, servings: number): Nutrition {
  return {
    calories: Math.round(basis.calories * servings),
    protein: Math.round(basis.protein * servings * 10) / 10,
    carbs: Math.round(basis.carbs * servings * 10) / 10,
    fat: Math.round(basis.fat * servings * 10) / 10,
  };
}

export function nutritionForMeal(food: Nutrition, servings: number, addOns: MealAddOn[] = []): Nutrition {
  return scaleNutrition(mealNutritionBasis(food, addOns), servings);
}

/** Keep an immutable per-serving snapshot so rounded display totals never compound. */
export function resizeMealEntry(entry: MealEntry, servings: number): MealEntry {
  const previousServings = Math.max(entry.servings, 0.25);
  const perServing: Nutrition = entry.nutritionPerServing ?? {
    calories: entry.nutrition.calories / previousServings,
    protein: entry.nutrition.protein / previousServings,
    carbs: entry.nutrition.carbs / previousServings,
    fat: entry.nutrition.fat / previousServings,
  };
  return {
    ...entry,
    servings,
    nutritionPerServing: perServing,
    nutrition: scaleNutrition(perServing, servings),
  };
}

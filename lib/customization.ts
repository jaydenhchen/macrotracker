import { Food, FoodAddOn } from "@/lib/types";

const PROTEIN_PATTERN = /protein|chicken|steak|beef|pork|turkey|fish|salmon|shrimp|tofu|tempeh|falafel|egg|beans?|lentils?/i;
const BUILDER_PATTERN = /burrito|bowl|salad|wrap|sandwich|taco|quesadilla|pita|plate|build.?your.?own|customize/i;

function normalized(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Find choices from the same Nutrislice station, even when the base item has a non-obvious name. */
export function addOnsForFood(food: Food, foods: Food[]): FoodAddOn[] {
  if (food.addOns?.length) return food.addOns;
  if (!food.stationName) return [];

  const station = normalized(food.stationName);
  const isLevering = /levering/i.test(food.locationName) || /levering|site-1/i.test(food.locationId);
  const stationFoods = foods.filter((option) =>
    option.id !== food.id &&
    option.locationId === food.locationId &&
    option.stationName && normalized(option.stationName) === station &&
    option.mealPeriods.some((meal) => food.mealPeriods.includes(meal))
  );
  // Levering's build-your-own stations commonly list the base under a generic dish name.
  // Offer the station components there even when the base name doesn't say "bowl" etc.
  if (!stationFoods.length || (!isLevering && !BUILDER_PATTERN.test(food.name))) return [];

  return stationFoods.map((option) => ({
    id: option.id,
    name: option.name,
    servingSize: option.servingSize,
    category: PROTEIN_PATTERN.test(option.name) ? "protein" as const : "topping" as const,
    // Keep partially documented choices selectable; unavailable values are explicitly shown in UI.
    calories: option.calories,
    protein: option.protein,
    carbs: option.carbs,
    fat: option.fat,
  }));
}

export function missingAddOnNutrition(addOn: FoodAddOn, foods: Food[]) {
  return foods.find((food) => food.id === addOn.id)?.missingNutrition ?? [];
}

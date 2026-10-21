import { Food } from "./types";

export function matchesFoodTag(food: Food, filter: string) {
  if (!filter || filter === "all") return true;
  const tags = food.tags.map((tag) => tag.toLowerCase().replace(/[-_]+/g, " ").trim());
  if (filter === "vegetarian") return tags.some((tag) => tag.includes("vegetarian") || tag === "vegan");
  if (filter === "no-added-sugar") return food.addedSugar === 0 || (food.addedSugar == null && tags.some((tag) => /no added sugar/.test(tag)));
  if (filter === "high-protein") return !food.missingNutrition?.includes("protein") && food.protein >= 20;
  return tags.some((tag) => tag === filter.replace(/[-_]+/g, " ") || tag.includes(filter.replace(/[-_]+/g, " ")));
}

export function matchesFoodTags(food: Food, filters: string[]) {
  return filters.every((filter) => matchesFoodTag(food, filter));
}

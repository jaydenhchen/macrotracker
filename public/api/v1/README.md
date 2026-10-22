# BlueJay Fuel public catalog API

This is a static, read-only API designed for GitHub Pages. It contains no personal user data.

- `health.json` — service and version status
- `locations.json` — Homewood dining locations
- `foods.json` — food items, nutrition, serving sizes, allergens, and tags
- `menus.json` — menu response metadata
- `categories.json` — meal and dietary filter categories

The app is intentionally local-first: goals, meal logs, favorites, and weights remain in the user’s browser. The static JSON files are fallback catalog data; the app separately attempts to read the selected day’s live menu from Hopkins Dining’s Nutrislice feed in the browser and labels fallback data when live access fails.

Charles Market includes five 49 g PLANTERS peanut packs and 225 York Street Market food listings transcribed from pages 3–22 of the currently linked [Grab-&-Go catalog](https://www.yorkstreetmarket.com/grab-n-go). This is the 225 products listed in that catalog, not every seasonal option advertised by the market. Entries include catalog page/item codes and UPCs where printed. Verified online macro values link to their source via `nutritionSourceUrl`; these third-party values are not represented as York Street Market–published nutrition. Foods with `missingNutrition` remain loggable; unavailable values display as dashes, are omitted from totals, and trigger a warning on the daily log.

Macro fields remain numeric for schema compatibility. If a macro key appears in `missingNutrition`, its `0` value is a placeholder, not a measured zero; API consumers should use that field to distinguish unavailable data.

Ingredient descriptions are copied from the menu. An empty `allergens` array means no verified allergen declaration was included; it does not mean allergen-free.

Run `npm run catalog:refresh` to regenerate `foods.json` from `lib/catalog.ts`.

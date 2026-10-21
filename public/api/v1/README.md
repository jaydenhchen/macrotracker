# BlueJay Fuel public catalog API

This is a static, read-only API designed for GitHub Pages. It contains no personal user data.

- `health.json` — service and version status
- `locations.json` — Homewood dining locations
- `foods.json` — food items, nutrition, serving sizes, allergens, and tags
- `menus.json` — menu response metadata
- `categories.json` — meal and dietary filter categories

The app is intentionally local-first: goals, meal logs, favorites, and weights remain in the user’s browser. The static JSON files are fallback catalog data; the app separately attempts to read the selected day’s live menu from Hopkins Dining’s Nutrislice feed in the browser and labels fallback data when live access fails.

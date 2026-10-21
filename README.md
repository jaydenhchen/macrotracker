# BlueJay Fuel

BlueJay Fuel is a local-first JHU dining macro tracker. It is a static Next.js site intended for GitHub Pages.

On first use, onboarding asks for age, sex used for the estimate, height, weight, workout days per week, and direction. It uses the Mifflin–St Jeor equation to produce editable starting calorie and macro targets; this is general wellness guidance, not medical advice.

## Run locally

```bash
npm install
npm run dev
```

The production export is generated into `out/`:

```bash
npm run typecheck
npm run build
```

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys the static export whenever `main` is updated. In the repository settings, set Pages to **GitHub Actions**. The workflow automatically supplies the repository name as the Next.js `basePath`, so the app works as a project site such as `https://USERNAME.github.io/REPOSITORY/`.

## Public catalog API

The public, read-only catalog is static JSON under `public/api/v1/` and is published at:

- `/api/v1/health.json`
- `/api/v1/locations.json`
- `/api/v1/foods.json`
- `/api/v1/menus.json`
- `/api/v1/categories.json`

Goals, food logs, favorites, and weights are never sent to the API. They stay in IndexedDB in the browser, with local storage fallback and JSON export/import backup.

The Today view also stores hydration entries and outside macro sources on-device. Use the hydration quick-add controls for water, or use **Add outside source** for items such as protein powder; calories are inferred from protein, carbs, and fat when you leave calories blank. The **Where your macros came from** table shows each Hopkins food and outside entry beside its calories, protein, carbs, and fat.

The app calls the Cloudflare Worker at `NEXT_PUBLIC_MENU_API_URL` for the selected date. If the Worker is missing, unavailable, times out, or returns malformed data, it clearly labels and uses the bundled starter snapshot instead. The client never sends goals, food logs, favorites, or weights to the Worker.

## Free Cloudflare menu proxy

The Worker in `worker/` is a free-tier-compatible serverless proxy for Hopkins Dining’s JSON Nutrislice API. It exposes `GET /api/menu?date=YYYY-MM-DD`, normalizes locations, meal periods, foods, nutrition, serving sizes, allergens, tags, and official menu links, adds CORS, and caches each date for five minutes. It does not scrape HTML.

One-time Cloudflare setup:

```bash
npx wrangler@latest login
npx wrangler@latest deploy --config worker/wrangler.toml
```

The deploy output includes the Worker URL. Verify it before connecting GitHub Pages:

```bash
curl -i "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/menu?date=2026-10-21"
```

Set the GitHub repository variable `NEXT_PUBLIC_MENU_API_URL` to the full Worker endpoint, for example `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/menu`. The Pages workflow passes that value into the static build. The Worker workflow also deploys automatically from `main` when `worker/**` changes; add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets to enable it. The API token only needs permission to edit Workers for the chosen account.

For tighter CORS, replace `ALLOWED_ORIGINS = "*"` in `worker/wrangler.toml` with the exact GitHub Pages origin, such as `https://YOUR-USER.github.io`, and redeploy. The default wildcard is intentional for this public, read-only menu endpoint and does not allow credentials.

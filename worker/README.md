# BlueJay Fuel menu proxy

This Worker provides the live menu endpoint used by the GitHub Pages app:

```text
GET /api/menu?date=YYYY-MM-DD
```

It reads Hopkins Dining's Nutrislice school directory and fetches each published location and active menu using the exact upstream school/menu slugs and Sunday week boundary. It selects only the requested date and returns normalized `locations`, `meals`, and flat `foods`, including official menu links. `missingNutrition` explicitly flags missing values; the app displays a dash and disables logging incomplete foods instead of treating unknown macros as zero.

## Deploy once

From the repository root:

```bash
npx wrangler@latest login
npx wrangler@latest deploy --config worker/wrangler.toml
```

Then verify the URL printed by Wrangler:

```bash
curl -i "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/menu?date=2026-10-21"
```

The Worker caches complete menus for five minutes, and empty/partial menus for 30 seconds. It performs at most 45 upstream requests with six concurrent connections and a 14-second total request budget. Each request times out after at most five seconds. Failed locations are marked unavailable; a valid menu with no published foods is marked empty. A completely unavailable upstream returns `502` with `Cache-Control: no-store` and a consistent `foods`, `locations`, and `errors` shape. The client may then use a real, dated Nutrislice snapshot published by GitHub Actions or saved on the device, for up to 24 hours. No generated catalog foods are substituted.

To verify that the proxy is not serving a one-location or stale deployment, inspect the location counts after each Worker deploy:

```bash
curl -sS "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/menu?date=$(date +%F)" | jq '{ok,error,food_count:((.foods // [])|length),partial,locations:((.locations // [])|map({name,food_count:([.meals[]?.foods[]?]|length)})),errors}'
```

The response should include every location for which Hopkins has menu items. Deploying the current Worker increments its internal cache schema, so the first request after this resolver change cannot reuse the previous partial cache.

## Connect GitHub Pages

Set the repository variable to the full endpoint, not only the Worker origin:

```bash
gh variable set NEXT_PUBLIC_MENU_API_URL --body "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/menu"
```

For automatic Worker deploys from `main`, add GitHub Actions secrets:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

The token should be scoped to the intended Cloudflare account with permission to edit Workers. The Pages workflow reads `NEXT_PUBLIC_MENU_API_URL` at build time; if it is missing or the Worker is unreachable, the UI remains usable with the bundled catalog.

For tighter CORS, set `ALLOWED_ORIGINS` in `wrangler.toml` to the exact Pages origin (for example, `https://YOUR-USER.github.io`) and deploy again. The default `*` is appropriate for this public read-only endpoint and does not enable credentials.

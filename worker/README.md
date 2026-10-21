# BlueJay Fuel menu proxy

This Worker provides the live menu endpoint used by the GitHub Pages app:

```text
GET /api/menu?date=YYYY-MM-DD
```

It calls Hopkins Dining's Nutrislice JSON endpoints, fetches the five configured Hopkins locations and breakfast/brunch/lunch/dinner menus, normalizes the week response to the requested day, and returns normalized `locations`, `meals`, and flat `foods`. Missing nutrition is represented as zero rather than causing the whole menu to fail.

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

The Worker uses the Cloudflare cache API plus five-minute `Cache-Control` headers. It reads Nutrislice's current school and menu-type directory, preserves the directory's date URL templates when present, and retries known Hopkins school-slug aliases when a renamed location returns no items. It limits each upstream request to five seconds and continues when an individual location or meal is unavailable. A completely unavailable upstream returns `502` with `Cache-Control: no-store`, allowing the app to use its bundled fallback instead of caching an outage.

To verify that the proxy is not serving a one-location or stale deployment, inspect the location counts after each Worker deploy:

```bash
curl -sS "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/menu?date=$(date +%F)" | jq '{ok,food_count:(.foods|length),partial,locations:[.locations[]|{name,food_count:([.meals[].foods[]]|length)}],errors}'
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

# Menu and dropdown review

Changes reviewed against CORS, malformed upstream data, timeouts, stale data, rate limits, missing nutrition, and GitHub Pages paths.

- Nutrislice school and menu slugs remain exact API identifiers. Requests use the Sunday week boundary and select only the requested day. All published locations and active menus are discovered from the JSON directory.
- Generated starter foods and estimated toppings are excluded from the daily menu. Saved fallback menus must have the same date, schema, Nutrislice source, and a fetch timestamp within 24 hours. Each location has an official menu link and an available, empty, or unavailable state.
- Unknown nutrition is flagged explicitly, shown as a dash, and placed after known values when sorting. Foods with incomplete macros cannot silently add zero macros to the log.
- CORS is recalculated on cached responses. Disallowed origins receive no allow-origin header; credentials are not enabled. Error responses preserve the same arrays as successful responses.
- Each invocation makes at most 45 upstream requests, with six concurrent connections, per-request timeouts, a 14-second total deadline, and a streamed four-megabyte response cap. There are no guessed-slug retry loops.
- Complete menus cache for five minutes; empty or partial responses cache for 30 seconds. Upstream outages return an uncached 502. A cache-write failure does not break an otherwise usable response.
- Cancelled requests cannot overwrite a newly selected date. Static fallback URLs include the GitHub Pages base path. Old logs retain their original nutrition when serving counts change.
- Native select elements cover their whole visible container, including the arrow and icon areas. Decorative icons ignore pointer events. The date arrow opens a real date input. Mobile modal controls wrap rather than overflowing.

## Validation

Passed locally: nine API regression tests (`npm test`), app TypeScript, Worker TypeScript, production export with `/macrotracker` as the base path, script syntax checks, and `git diff --check`.

The Chromium smoke test and live Hopkins comparison are configured in `.github/workflows/verify.yml`. They have not run in this session: local server ports/browser launch and direct external API access are restricted. GitHub rejected repository writes with HTTP 403, so the verification workflow could not be published or executed remotely. No live food counts or browser test success are claimed.

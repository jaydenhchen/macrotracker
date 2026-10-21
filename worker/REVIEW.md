# Menu and dropdown review

Changes reviewed against CORS, malformed upstream data, timeouts, stale data, rate limits, missing nutrition, and GitHub Pages paths.

- Nutrislice school and menu slugs remain exact API identifiers. Requests use the Sunday week boundary and select only the requested day. All published locations and active menus are discovered from the JSON directory.
- Generated starter foods and estimated toppings are excluded from the daily menu. Saved fallback menus must have the same date, schema, Nutrislice source, and a fetch timestamp within 24 hours. Each location has an official menu link and an available, empty, or unavailable state.
- Unknown nutrition is flagged explicitly, shown as a dash, and placed after known values when sorting. Foods with incomplete macros cannot silently add zero macros to the log.
- CORS is recalculated on cached responses. Disallowed origins receive no allow-origin header; credentials are not enabled. Error responses preserve the same arrays as successful responses.
- Each invocation makes at most 45 upstream requests, with two concurrent connections, per-request timeouts, a 14-second total deadline, and a streamed 16-megabyte response cap. The original four-megabyte cap was proven too small by live CI downloads and has been raised while reducing concurrency. There are no guessed-slug retry loops.
- Complete menus cache for five minutes; empty or partial responses cache for 30 seconds. Upstream outages return an uncached 502. A cache-write failure does not break an otherwise usable response.
- Cancelled requests cannot overwrite a newly selected date. Static fallback URLs include the GitHub Pages base path. Partial live responses preserve saved foods for failed locations and individual meals without resetting their age. Malformed selected-day item containers raise errors rather than replacing saved data with an empty menu.
- Meal entries preserve an immutable per-serving nutrition snapshot across serving edits, saving, and backup restoration, preventing rounding drift.
- Native select elements cover their whole visible container, including the arrow and icon areas. Decorative icons ignore pointer events. The date arrow opens a real date input. Mobile modal controls wrap rather than overflowing.

## Validation

Passed locally: 15 regression tests (`npm test`), covering the original nine cases plus large menus, malformed day containers, serving-rounding drift (including fractional add-ons), preservation of failed locations, and preservation of failed individual meals.

PR #1 at commit `9f68f5c` passed GitHub Actions run `39562012246`, including both TypeScript checks, nine API tests, the production build, and desktop/mobile Chromium dropdown and menu tests. Its live download returned 874 foods across all five locations, but exposed missing Hopkins Café lunch/dinner and Peabody lunch because weekly responses exceeded four MB. The strict integration download now fails on partial results so this cannot silently pass again.

An independent read-only review also reproduced the rounding, partial-cache overwrite, and malformed-container bugs. All are fixed locally with regression coverage. GitHub still rejects writes with HTTP 403 and the local Git index is read-only; the follow-up fixes must be committed/pushed and the strict live/browser workflow rerun before merge. No success for that new live run is claimed yet.

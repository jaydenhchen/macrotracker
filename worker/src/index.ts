import { extractMenuItems, makeMenuResponse, resolveMenuTargets, type MenuResponse, type NutrisliceLocation } from "./normalizer";

export type Env = {
  NUTRISLICE_API_BASE?: string;
  ALLOWED_ORIGINS?: string;
  CACHE_TTL_SECONDS?: string;
  UPSTREAM_TIMEOUT_MS?: string;
};

type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

const DEFAULT_API_BASE = "https://hopkinsdining.api.nutrislice.com";
const DEFAULT_CACHE_TTL = 300;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_DATE_YEAR = 2200;
// Bump this whenever target resolution changes so a previously partial menu cannot mask a fix.
const CACHE_SCHEMA = "4";

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((item) => item.trim()).filter(Boolean);
  const allowOrigin = allowed.includes("*") ? "*" : origin && allowed.includes(origin) ? origin : "";
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(value: unknown, status: number, request: Request, env: Env, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request, env), ...extra },
  });
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || parsed.getUTCFullYear() > MAX_DATE_YEAR) return null;
  return value;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function numberEnv(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function expandMenuTemplate(template: string, base: string, school: string, mealType: string, date: string) {
  const [year, month, day] = date.split("-");
  const schoolPath = school.split("/").map((part) => encodeURIComponent(part)).join("/");
  const root = base.replace(/\/$/, "");
  const values: Record<string, string> = {
    school: schoolPath,
    school_slug: schoolPath,
    "school-slug": schoolPath,
    menu_type: encodeURIComponent(mealType),
    "menu-type": encodeURIComponent(mealType),
    menutype: encodeURIComponent(mealType),
    year,
    month,
    day,
    date,
  };
  const expanded = template.replace(/\{([^}]+)\}/g, (match, key: string) => values[key.trim().toLowerCase()] ?? match);
  const candidate = /^https?:\/\//i.test(expanded)
    ? expanded
    : `${root}/${expanded.replace(/^\/+/, "")}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.origin !== new URL(root).origin || /\{[^}]+\}/.test(parsed.pathname + parsed.search)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function upstreamUrls(base: string, school: string, mealType: string, date: string, templates: string[] = [], templateMealType = mealType) {
  const [year, month, day] = date.split("-");
  const schoolPath = school.split("/").map((part) => encodeURIComponent(part)).join("/");
  const root = base.replace(/\/$/, "");
  const exactUrls = templates.map((template) => expandMenuTemplate(template, base, school, templateMealType, date)).filter((url): url is string => Boolean(url));
  return Array.from(new Set([
    ...exactUrls,
    `${root}/menu/api/weeks/school/${schoolPath}/menu-type/${encodeURIComponent(mealType)}/${year}/${month}/${day}/?format=json`,
    `${root}/menu/api/digest/school/${schoolPath}/menu-type/${encodeURIComponent(mealType)}/date/${year}/${month}/${day}/?format=json`,
  ]));
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`upstream status ${response.status}`);
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("json")) throw new Error("upstream did not return JSON");
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error("upstream response was too large");
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error("upstream returned malformed JSON");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMenu(date: string, env: Env) {
  const base = env.NUTRISLICE_API_BASE || DEFAULT_API_BASE;
  const timeoutMs = numberEnv(env.UPSTREAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 10000);
  let targets = resolveMenuTargets(null);
  try {
    const directory = await fetchJson(`${base.replace(/\/$/, "")}/menu/api/schools/`, timeoutMs);
    targets = resolveMenuTargets(directory);
  } catch {
    // The directory is a convenience; the known public slugs remain the fallback.
  }
  const jobs = targets.flatMap((target) => target.mealTypes.map((mealType) => ({ ...target, mealType })));
  const results: Array<{ location: NutrisliceLocation; mealType: string; items: ReturnType<typeof extractMenuItems> }> = [];
  const errors: MenuResponse["errors"] = [];
  const concurrency = 10;

  for (let index = 0; index < jobs.length; index += concurrency) {
    const batch = jobs.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map(async ({ location, schools, mealType, menuTypeUrls, menuTypeValues }) => {
      try {
        let lastError: unknown = null;
        for (let schoolIndex = 0; schoolIndex < schools.length; schoolIndex += 1) {
          const schoolCandidate = schools[schoolIndex];
          const templates = schoolIndex === 0 ? menuTypeUrls[mealType] ?? [] : [];
          const templateMealType = schoolIndex === 0 ? menuTypeValues[mealType] ?? mealType : mealType;
          for (const url of upstreamUrls(base, schoolCandidate, mealType, date, templates, templateMealType)) {
            try {
              const payload = await fetchJson(url, timeoutMs);
              const items = extractMenuItems(payload, date);
              if (items.length) return { location, mealType, items };
              lastError = new Error("upstream returned no menu items");
            } catch (error) {
              lastError = error;
            }
          }
        }
        throw lastError instanceof Error ? lastError : new Error("upstream request failed");
      } catch (error) {
        errors.push({ locationId: location.id, mealType, message: error instanceof Error ? error.message : "upstream request failed" });
        return null;
      }
    }));
    results.push(...batchResults.filter((result): result is NonNullable<typeof result> => Boolean(result)));
  }

  return makeMenuResponse(date, results, errors, new Date().toISOString());
}

function cachedResponse(response: Response, request: Request, env: Env, cacheStatus: string) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
  headers.set("X-Menu-Cache", cacheStatus);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/menu") return json({ ok: false, error: "Not found" }, 404, request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405, request, env, { Allow: "GET, OPTIONS" });

    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((item) => item.trim()).filter(Boolean);
    if (origin && !allowed.includes("*") && !allowed.includes(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, request, env);

    const date = validDate(url.searchParams.get("date")) || (url.searchParams.has("date") ? null : todayUtc());
    if (!date) return json({ ok: false, error: "date must use YYYY-MM-DD" }, 400, request, env);

    const ttl = numberEnv(env.CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL, 30, 3600);
    const cacheKey = new Request(`${url.origin}/api/menu?date=${date}&v=${CACHE_SCHEMA}`, { method: "GET" });
    const cached = await caches.default.match(cacheKey);
    if (cached) return cachedResponse(cached, request, env, "HIT");

    const payload = await fetchMenu(date, env);
    if (payload.foods.length === 0) {
      return json({ ok: false, date, error: payload.foods.length === 0 ? "Hopkins returned no menu items for this date" : "Hopkins Dining was unavailable", errors: payload.errors }, 502, request, env, { "Cache-Control": "no-store" });
    }
    const response = json(payload, 200, request, env, { "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=60` });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return cachedResponse(response, request, env, "MISS");
  },
};

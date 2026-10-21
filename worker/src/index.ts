import { extractMenuItems, makeMenuResponse, resolveMenuTargets, type MenuResponse, type MenuResult } from "./normalizer";

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
const CACHE_SCHEMA = "7";

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

function todayHopkins() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function numberEnv(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

/** Nutrislice's weeks endpoint is keyed by Sunday, with exact directory slugs. */
export function upstreamUrl(base: string, school: string, mealType: string, date: string) {
  const week = new Date(`${date}T12:00:00Z`);
  week.setUTCDate(week.getUTCDate() - week.getUTCDay());
  const [year, month, day] = week.toISOString().slice(0, 10).split("-");
  return `${base.replace(/\/$/, "")}/menu/api/weeks/school/${encodeURIComponent(school)}/menu-type/${encodeURIComponent(mealType)}/${year}/${month}/${day}/?format=json`;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal, redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`upstream status ${response.status}`);
    }
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("json")) {
      await response.body?.cancel();
      throw new Error("upstream did not return JSON");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("upstream returned an empty response");
    const decoder = new TextDecoder();
    let body = "";
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16_000_000) {
        await reader.cancel();
        throw new Error("upstream response was too large");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error("upstream returned malformed JSON");
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMenu(date: string, env: Env = {}) {
  const base = env.NUTRISLICE_API_BASE || DEFAULT_API_BASE;
  const timeoutMs = numberEnv(env.UPSTREAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 10000);
  const deadline = Date.now() + 14000;
  const errors: MenuResponse["errors"] = [];
  const results: MenuResult[] = [];
  let targets: ReturnType<typeof resolveMenuTargets> = [];
  try {
    const directory = await fetchJson(`${base.replace(/\/$/, "")}/menu/api/schools/?format=json`, timeoutMs);
    targets = resolveMenuTargets(directory);
    if (!targets.length) throw new Error("Nutrislice returned an empty or malformed location directory");
  } catch (error) {
    errors.push({ locationId: "proxy", mealType: "directory", message: error instanceof Error ? error.message : "Directory unavailable" });
    return makeMenuResponse(date, [], errors, new Date().toISOString());
  }
  // One directory request + at most 44 menu requests, below the free-tier limit.
  const jobs = targets.flatMap((target) => target.mealTypes.map((mealType) => ({ ...target, mealType })));
  let nextJob = 0;
  async function consume() {
    while (nextJob < jobs.length) {
      const index = nextJob++;
      const { location, school, mealType, mealNames } = jobs[index];
      try {
        if (index >= 44) throw new Error("Menu request budget exceeded");
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("Menu request deadline exceeded");
        const payload = await fetchJson(upstreamUrl(base, school, mealType, date), Math.min(timeoutMs, remaining));
        if (!payload || typeof payload !== "object" || !("days" in payload) || !Array.isArray(payload.days) && (payload.days === null || typeof payload.days !== "object")) {
          throw new Error("Nutrislice returned a malformed weekly menu");
        }
        results.push({
          location, mealType, mealName: mealNames[mealType],
          menuUrl: `${location.menuUrl}/${encodeURIComponent(mealType)}/${date.replaceAll("-", "/")}`,
          items: extractMenuItems(payload, date),
        });
      } catch (error) {
        errors.push({ locationId: location.id, mealType, message: error instanceof Error ? error.message : "Menu unavailable" });
      }
    }
  }
  // Large weekly menus can exceed four MB. Limit concurrent bodies so allowing
  // real menus does not multiply peak memory across six large JSON responses.
  await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, consume));
  return makeMenuResponse(date, results, errors, new Date().toISOString(), targets);
}

function cachedResponse(response: Response, request: Request, env: Env, cacheStatus: string) {
  const headers = new Headers(response.headers);
  headers.delete("Access-Control-Allow-Origin");
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

    const date = validDate(url.searchParams.get("date")) || (url.searchParams.has("date") ? null : todayHopkins());
    if (!date) return json({ ok: false, error: "date must use YYYY-MM-DD" }, 400, request, env);

    const ttl = numberEnv(env.CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL, 30, 3600);
    const cacheKey = new Request(`${url.origin}/api/menu?date=${date}&v=${CACHE_SCHEMA}`, { method: "GET" });
    const cached = await caches.default.match(cacheKey).catch(() => undefined);
    if (cached) return cachedResponse(cached, request, env, "HIT");

    const payload = await fetchMenu(date, env);
    if (payload.foods.length === 0 && payload.errors.length) {
      return json({ ...payload, ok: false, error: "Hopkins menus are currently unavailable" }, 502, request, env, { "Cache-Control": "no-store" });
    }
    const cacheTtl = payload.partial || !payload.foods.length ? 30 : ttl;
    const response = json(payload, 200, request, env, { "Cache-Control": `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}` });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()).catch(() => undefined));
    return cachedResponse(response, request, env, "MISS");
  },
};

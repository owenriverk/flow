/**
 * Shared gauge logic for every page that shows a live reading.
 *
 * Extracted from gauges.js (2026-09-19) so the per-river pages can reuse it.
 * gauges.js cannot itself be loaded anywhere else: at module scope it wires
 * document.getElementById('gauge-body'/'filter-input'), which throws on any
 * page without the homepage table. Everything here is pure or injectable, so
 * it runs in a browser, on a river page, and under vitest in plain node.
 *
 *                     Supabase gauges?select=*
 *                              │
 *                       fetchGauges()
 *                     ┌────────┴────────┐
 *                  ok │                 │ throws / !ok
 *                     ▼                 ▼
 *              writeCache()        readCache()  ── null ──▶ caller's
 *                     │                 │                  evergreen path
 *                     └────────┬────────┘
 *                              ▼
 *              ageInfo / rowClass / flowText / trendInfo
 *                              │
 *                   homepage table  │  river page
 *
 * Behavior is a verbatim copy of what the homepage shipped — any change here
 * changes what paddlers read on the table too, so test/gaugeCore.test.ts pins
 * it. The only additions are injectable seams (`now`, `fetchFn`) for tests.
 */

export const SUPABASE_URL = 'https://vfkoegvzllxvshcnfbox.supabase.co';
export const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZma29lZ3Z6bGx4dnNoY25mYm94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NzE1MTcsImV4cCI6MjA5ODI0NzUxN30.PdQ8fbjVE0s8LoTED5WHyb1zx8WU-X3QqO4td9XBHqo';
export const REFRESH_MS = 10 * 60 * 1000;

// Reading timestamps older than this are flagged visually.
export const STALE_WARN_HRS = 2;   // muted warning style
export const OFFLINE_HRS    = 72;  // [OFFLINE] — clearly broken

export const CMS_TO_CFS = 35.3147;

/**
 * Returns { label, cls } for a gauge's freshness.
 * cls is '' (fresh), 'age-stale' (> 2 hr), or 'age-offline' (> 72 hr, missing, or no reading).
 *
 * Backend fetchers stamp reading_time as "now" whenever a source returns no
 * value (see refresh-gauges), so a null discharge/stage can carry a fresh-looking
 * timestamp — check for that first instead of trusting reading_time alone.
 */
export function ageInfo(g, now = Date.now()) {
  if (g.discharge == null && g.stage == null) return { label: '[OFFLINE]', cls: 'age-offline' };
  const isoString = g.reading_time;
  if (!isoString) return { label: '—', cls: 'age-offline' };
  const mins = (now - new Date(isoString).getTime()) / 60000;
  if (mins < 1)  return { label: 'just now', cls: '' };
  if (mins < 60) return { label: `${Math.floor(mins)} min ago`, cls: '' };
  const h = Math.floor(mins / 60);
  if (h >= OFFLINE_HRS) return { label: '[OFFLINE]', cls: 'age-offline' };
  if (h >= STALE_WARN_HRS) return { label: `${h} hr ago`, cls: 'age-stale' };
  return { label: '1 hr ago', cls: '' };
}

// 'grey' covers both "no reading" and "no low/high range configured" — either
// way there's no status to color-code, so both belong in the same filter bucket
// instead of vanishing from every status filter (including "No data").
export function rowClass(g) {
  const d = g.discharge;
  if (d == null && g.stage == null) return 'grey';
  if (g.low == null || g.high == null || d == null) return 'grey';
  if (d < g.low) return 'low';
  if (d > g.high) return 'high';
  return 'good';
}

export function flowText(g) {
  if (g.discharge != null) {
    const n = g.discharge_unit === 'cms'
      ? Number(g.discharge).toLocaleString('en-US', { maximumFractionDigits: 1 })
      : Math.round(g.discharge).toLocaleString('en-US');
    const stg = g.stage != null
      ? ` / ${Number(g.stage).toFixed(2)} ${g.stage_unit}`
      : '';
    return `${n} ${g.discharge_unit}${stg}`;
  }
  if (g.stage != null) return `${Number(g.stage).toFixed(2)} ${g.stage_unit}`;
  return '—';
}

// Ignore swings under this so measurement jitter doesn't flip the arrow.
// Tuned against the ~24h baseline window — see the v3 design doc assignment.
export const TREND_THRESHOLD = 0.02;

/**
 * Returns { glyph, cls, title } for the discharge trend, or null if unknown/flat.
 *
 * Compares against baseline_* — a reading from ~24h ago picked by
 * refresh-gauges from flow_history. Same-time-of-day comparison cancels the
 * diurnal melt cycle, so the arrow reads day-over-day ("is it coming in"),
 * not this morning vs last night's peak. (prev_* is the bot's outage
 * fallback, a different contract — do not read it here.)
 */
export function trendInfo(g) {
  if (g.discharge == null || g.baseline_discharge == null || g.baseline_discharge === 0) return null;
  const pct = (g.discharge - g.baseline_discharge) / g.baseline_discharge;
  if (Math.abs(pct) < TREND_THRESHOLD) return null;
  const pctLabel = `${pct > 0 ? '+' : ''}${Math.round(pct * 100)}%`;
  const sinceLabel = g.baseline_reading_time
    ? ` vs yesterday (${new Date(g.baseline_reading_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })})`
    : '';
  return pct > 0
    ? { glyph: '↑', cls: 'trend-up',   title: `${pctLabel}${sinceLabel}` }
    : { glyph: '↓', cls: 'trend-down', title: `${pctLabel}${sinceLabel}` };
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

// Last-known-good fallback for when the browser can't reach Supabase (e.g. spotty
// signal at a trailhead) — mirrors the cache fallback already used on the InReach side.
// One cache for the whole roster, shared by the table and the river pages: a
// visitor who touched the homepage arrives on /grand-canyon already warm.
export const CACHE_KEY = 'lateboof:gauges-cache:v1';

export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // absent, unparseable, or localStorage unavailable (node, private mode)
    return null;
  }
}

export function writeCache(rows) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rows, fetchedAt: new Date().toISOString() }));
  } catch {
    // localStorage unavailable (private mode, quota, etc.) — cache is best-effort.
  }
}

/**
 * The whole roster in one request. Every consumer asks for the same URL on
 * purpose: one shared cache entry, and a river page inherits the homepage's
 * warm cache instead of paying a second cold fetch. Throws on a non-2xx so
 * callers hit the same catch as a network failure.
 */
export async function fetchGauges(fetchFn = fetch) {
  const res = await fetchFn(`${SUPABASE_URL}/rest/v1/gauges?select=*`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

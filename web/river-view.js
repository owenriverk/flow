/**
 * What a river page should show, decided without touching the DOM.
 *
 * A river page asks for ONE run, which the homepage table never does — the
 * table renders whatever rows come back, so a key that isn't in the response
 * simply doesn't appear. Here it is the whole page, so "key missing" is a real
 * state and not an impossible one.
 *
 *   fetch rows ──┬── key found ──┬── has a reading ─────────▶ state: live
 *                │               └── discharge+stage null ──▶ state: offline
 *                └── key absent ──┐
 *   fetch threw / !ok ────────────┤
 *                                 ├── cached row for key ───▶ state: cached
 *                                 └── nothing cached ───────▶ state: unavailable
 *                                       reason: missing-key | unreachable
 *
 * Every state still renders the page's evergreen half (the number to text, the
 * key, the QR, the paragraph). A page selling trustworthy flow has to fail
 * honestly: never a blank, never a stale number dressed up as live.
 */

import { ageInfo, flowText, rowClass, trendInfo } from './gauge-core.js';

/**
 * One shape for every state, so a caller never has to narrow before reading.
 * The reading fields are absent in the 'unavailable' state and `reason` is
 * absent in the others — `live` is the flag that says which half is filled in.
 *
 * @typedef {object} RiverView
 * @property {'live'|'cached'|'offline'|'unavailable'} state
 * @property {boolean} live              true only when there is a real reading to show
 * @property {string}  key
 * @property {'missing-key'|'unreachable'} [reason]  why there is nothing to show
 * @property {string}  [name]
 * @property {string}  [location]
 * @property {string}  [textKey]
 * @property {string}  [gaugeUrl]
 * @property {string}  [flow]            preformatted, e.g. "2,800 cfs / 4.21 ft"
 * @property {'low'|'good'|'high'|'grey'} [status]
 * @property {{label: string, cls: string}} [age]
 * @property {{glyph: string, cls: string, title: string}|null} [trend]
 * @property {string|null} [cachedAt]    ISO time the cached payload was stored
 */

/** The row for one run, or null. Tolerates a null/!Array payload. */
export function pickRiver(rows, key) {
  if (!Array.isArray(rows)) return null;
  return rows.find((g) => g && g.key === key) ?? null;
}

/** @returns {RiverView} */
function reading(g, { source, cachedAt = null, now }) {
  // A dead gauge can carry a fresh-looking reading_time (refresh-gauges stamps
  // "now" on an empty read), so trust the values, not the timestamp.
  const dead = g.discharge == null && g.stage == null;
  return {
    state: dead ? 'offline' : source === 'cached' ? 'cached' : 'live',
    key: g.key,
    name: g.name,
    location: g.location,
    textKey: g.text_key,
    gaugeUrl: g.gauge_url,
    flow: flowText(g),
    status: rowClass(g),
    age: ageInfo(g, now),
    trend: trendInfo(g),
    cachedAt,
    live: !dead,
  };
}

/**
 * @param {object}  o
 * @param {Array|null} o.rows    parsed API rows, or null when the fetch failed
 * @param {object|null} o.cached  readCache() output, or null
 * @param {string}  o.key         this page's gauge key
 * @param {number} [o.now]
 * @returns {RiverView}
 */
export function buildView({ rows, cached, key, now = Date.now() }) {
  const fresh = pickRiver(rows, key);
  if (fresh) return reading(fresh, { source: 'live', now });

  const cachedRow = pickRiver(cached?.rows, key);
  if (cachedRow) {
    return reading(cachedRow, { source: 'cached', cachedAt: cached?.fetchedAt ?? null, now });
  }

  // Nothing to show. Distinguish the two causes: a key we asked for that the
  // API doesn't know is a roster drift worth logging, not a network blip.
  return {
    state: 'unavailable',
    reason: Array.isArray(rows) ? 'missing-key' : 'unreachable',
    key,
    live: false,
  };
}

/**
 * One line of honest copy for whatever state the page ended up in.
 * @param {RiverView} view
 */
export function stateNote(view) {
  switch (view.state) {
    case 'live':
      return '';
    case 'offline':
      return 'This gauge is not reporting right now.';
    case 'cached': {
      const when = view.cachedAt
        ? new Date(view.cachedAt).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })
        : 'earlier';
      return `Showing a saved reading from ${when} — could not reach live data.`;
    }
    default:
      return 'Live reading unavailable right now — text the bot for the current flow.';
  }
}

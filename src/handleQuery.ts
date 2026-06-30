/**
 * The channel-agnostic core: text in, reply text out. No email, no SMS, no
 * Worker types leak in here -- that is what lets v2 add SMS as just another
 * adapter that calls this same function.
 *
 *   text ─▶ lookupGauge ─┬─ null ──────────────────────▶ NOT_FOUND
 *                        └─ {site, source} ─▶ fetch[source] ─┬─ Reading ─▶ formatReply
 *                                                            ├─ not_found ─▶ NOT_FOUND
 *                                                            └─ otherwise ─▶ UNAVAILABLE
 *
 * Source routing: 'usgs' -> fetchUsgs, 'wsc' -> fetchWsc.
 * Iron rule: this function never throws and never returns ''. A paddler on a
 * metered satellite link always gets one useful line back.
 */

import { formatReply, type Reading } from './formatReply.js';
import { lookupGauge, type GaugeAlias } from './lookupGauge.js';
import { GaugeError } from './errors.js';
import { fetchReading as fetchUsgsDefault } from './usgs.js';
import { fetchReading as fetchWscDefault } from './wsc.js';
import { fetchReading as fetchCdecDefault } from './cdec.js';
import { fetchReading as fetchDreamflowsDefault } from './dreamflows.js';
import { fetchReading as fetchNoaaDefault } from './noaa.js';

export interface CdecConfig {
  sensor?: number;
  dur?: string;
}

export const NOT_FOUND =
  'Not found. Text a run name from lateboof.com, or an 8+ digit USGS site id.';
export const UNAVAILABLE =
  "Couldn't reach gauge data right now. Try again in a few minutes.";

export interface HandleQueryDeps {
  aliases: Record<string, GaugeAlias>;
  fetchUsgs?: (siteId: string) => Promise<Reading>;
  fetchWsc?: (siteId: string) => Promise<Reading>;
  fetchCdec?: (station: string, cfg: CdecConfig) => Promise<Reading>;
  fetchDreamflows?: (riverId: string) => Promise<Reading>;
  fetchNoaa?: (stationId: string) => Promise<Reading>;
  /** Last-resort fuzzy matcher (Workers AI). Only called when lookup misses. */
  resolveFuzzy?: (text: string) => Promise<string | null>;
}

export async function handleQuery(text: string, deps: HandleQueryDeps): Promise<string> {
  let ref = lookupGauge(text, deps.aliases);

  // Deterministic lookup missed — fall back to the AI matcher, then re-resolve the
  // run name it returns (which is validated to be a real key, so this can't invent a gauge).
  if (ref === null && deps.resolveFuzzy) {
    const guess = await deps.resolveFuzzy(text);
    if (guess) ref = lookupGauge(guess, deps.aliases);
  }

  if (ref === null) return NOT_FOUND;

  const fetchUsgs = deps.fetchUsgs ?? ((id: string) => fetchUsgsDefault(id));
  const fetchWsc = deps.fetchWsc ?? ((id: string) => fetchWscDefault(id));
  const fetchCdec =
    deps.fetchCdec ?? ((id: string, cfg: CdecConfig) => fetchCdecDefault(id, cfg));
  const fetchDreamflows = deps.fetchDreamflows ?? ((id: string) => fetchDreamflowsDefault(id));
  const fetchNoaa = deps.fetchNoaa ?? ((id: string) => fetchNoaaDefault(id));

  try {
    let reading: Reading;
    if (ref.source === 'wsc') {
      reading = await fetchWsc(ref.site);
    } else if (ref.source === 'dreamflows') {
      reading = await fetchDreamflows(ref.site);
    } else if (ref.source === 'noaa') {
      reading = await fetchNoaa(ref.site);
    } else if (ref.source === 'cdec') {
      const cfg: CdecConfig = {};
      if ('sensor' in ref && ref.sensor !== undefined) cfg.sensor = ref.sensor;
      if ('dur' in ref && ref.dur !== undefined) cfg.dur = ref.dur;
      reading = await fetchCdec(ref.site, cfg);
    } else {
      reading = await fetchUsgs(ref.site);
    }
    return formatReply(ref, reading);
  } catch (e) {
    if (e instanceof GaugeError && e.kind === 'not_found') return NOT_FOUND;
    return UNAVAILABLE;
  }
}

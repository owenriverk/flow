/**
 * Resolve a paddler's text into a gauge reference.
 *
 *   "gauley summersville"  ──alias table──▶ { site, source, name, location }
 *   "03189100"             ──all-digit────▶ { site, source: 'usgs' }
 *   "08CE001"              ──WSC format───▶ { site, source: 'wsc' }
 *   "mystery creek"        ──no match─────▶ null
 *
 * Curated aliases carry display name + location; raw ids do not (the upstream
 * API supplies the site name at format time). `source` decides which data API
 * the fetcher hits -- explicit, not guessed downstream.
 */

export type GaugeSource = 'usgs' | 'wsc' | 'cdec';

export interface GaugeAlias {
  site: string;
  name: string;
  location: string;
  source?: GaugeSource; // defaults to 'usgs'
  sensor?: number; // cdec only: which sensor reports flow/stage (20 flow, 76 inflow, 1 stage)
  dur?: string; // cdec only: duration code (H hourly, D daily, E event)
}

export type GaugeRef =
  | {
      site: string;
      source: GaugeSource;
      name: string;
      location: string;
      sensor?: number;
      dur?: string;
    }
  | { site: string; source: GaugeSource };

/** USGS site numbers are all-digit, 8-15 chars. */
const USGS_ID = /^\d{8,15}$/;
/** Water Survey of Canada station numbers: 2 digits, 2 letters, 3 digits (e.g. 08CE001). */
const WSC_ID = /^\d{2}[A-Z]{2}\d{3}$/;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function lookupGauge(
  text: string,
  aliases: Record<string, GaugeAlias>,
): GaugeRef | null {
  const key = normalize(text);
  if (key === '') return null;

  const alias = aliases[key];
  if (alias) {
    const ref: GaugeRef = {
      site: alias.site,
      source: alias.source ?? 'usgs',
      name: alias.name,
      location: alias.location,
    };
    if (alias.sensor !== undefined) ref.sensor = alias.sensor;
    if (alias.dur !== undefined) ref.dur = alias.dur;
    return ref;
  }

  // Raw-id detection runs on the uppercased original so WSC letters survive.
  const raw = text.trim().toUpperCase();
  if (USGS_ID.test(raw)) return { site: raw, source: 'usgs' };
  if (WSC_ID.test(raw)) return { site: raw, source: 'wsc' };

  return null;
}

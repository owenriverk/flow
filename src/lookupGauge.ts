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

export type GaugeSource = 'usgs' | 'wsc' | 'cdec' | 'dreamflows' | 'noaa';

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

function toRef(alias: GaugeAlias): GaugeRef {
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

/** Does `phrase` appear in `text` as a whole word/phrase (not mid-word)? */
function containsPhrase(text: string, phrase: string): boolean {
  return (
    text === phrase ||
    text.startsWith(`${phrase} `) ||
    text.endsWith(` ${phrase}`) ||
    text.includes(` ${phrase} `)
  );
}

// Stop words stripped before word-set matching so prepositions and articles
// in the message don't prevent a match ("middle fork of the salmon" → mf salmon).
const STOP = new Set(['of', 'the', 'at', 'near', 'below', 'above', 'on', 'a', 'an', 'in', 'for']);

function contentWords(phrase: string): string[] {
  return phrase.split(' ').filter((w) => w.length > 0 && !STOP.has(w));
}

export function lookupGauge(
  text: string,
  aliases: Record<string, GaugeAlias>,
): GaugeRef | null {
  const key = normalize(text);
  if (key === '') return null;

  // 1. Exact alias.
  if (aliases[key]) return toRef(aliases[key]!);

  // 2. Raw id (uppercased original so WSC letters survive).
  const raw = text.trim().toUpperCase();
  if (USGS_ID.test(raw)) return { site: raw, source: 'usgs' };
  if (WSC_ID.test(raw)) return { site: raw, source: 'wsc' };

  // 3. Phrase-contains: a known run name appearing verbatim inside the message.
  //    Handles "middle kings at rodger's". Longest match wins.
  let best: string | null = null;
  for (const candidate of Object.keys(aliases)) {
    if (containsPhrase(key, candidate) && (best === null || candidate.length > best.length)) {
      best = candidate;
    }
  }
  if (best) return toRef(aliases[best]!);

  // 4. Word-set: every content word of a known alias appears somewhere in the query.
  //    Handles prepositions and filler words the paddler inserts:
  //      "middle fork of the salmon" → "middle fork salmon"
  //      "gates lodore" → "gates of lodore"
  //    Stop words in the alias itself are ignored. Longest alias wins.
  const keyWords = new Set(contentWords(key));
  let bestWords: string | null = null;
  for (const candidate of Object.keys(aliases)) {
    const aliasWords = contentWords(candidate);
    if (
      aliasWords.length > 0 &&
      aliasWords.every((w) => keyWords.has(w)) &&
      (bestWords === null || candidate.length > bestWords.length)
    ) {
      bestWords = candidate;
    }
  }
  if (bestWords) return toRef(aliases[bestWords]!);

  return null;
}

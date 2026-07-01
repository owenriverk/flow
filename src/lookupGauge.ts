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

// Contract spelled-out fork names before alias lookup so "north fork flathead"
// hits the "nf flathead" alias directly (tier 1 exact) rather than the shorter
// "flathead" alias (MF) via tier 3 phrase-contains. Contraction runs first to
// avoid word-set false positives when both "middle" and "fork" appear in a query
// that targets a different river (e.g. "middle fork feather" → mf feather ✓).
const FORK_CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bmiddle fork\b/g, 'mf'],
  [/\bnorth fork\b/g,  'nf'],
  [/\bsouth fork\b/g,  'sf'],
];

function contractForks(text: string): string {
  let result = text;
  for (const [pat, rep] of FORK_CONTRACTIONS) result = result.replace(pat, rep);
  return result;
}

/** Run tiers 1 (exact), 3 (phrase-contains), and 4 (word-set) against a given key. */
function lookupText(
  key: string,
  aliases: Record<string, GaugeAlias>,
): GaugeRef | null {
  // Tier 1: exact alias.
  if (aliases[key]) return toRef(aliases[key]!);

  // Tier 3: a known run name appearing verbatim inside the message; longest match wins.
  let best: string | null = null;
  for (const candidate of Object.keys(aliases)) {
    if (containsPhrase(key, candidate) && (best === null || candidate.length > best.length)) {
      best = candidate;
    }
  }
  if (best) return toRef(aliases[best]!);

  // Tier 4: word-set — every content word of a known alias appears in the query.
  //    Handles prepositions and filler: "middle fork of the salmon" → mf salmon,
  //    "gates lodore" → gates of lodore. Stop words in aliases are ignored.
  //    Longest alias wins.
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
  return bestWords ? toRef(aliases[bestWords]!) : null;
}

export function lookupGauge(
  text: string,
  aliases: Record<string, GaugeAlias>,
): GaugeRef | null {
  const key = normalize(text);
  if (key === '') return null;

  // Tier 2: raw id (uppercased original so WSC letters survive).
  const raw = text.trim().toUpperCase();
  if (USGS_ID.test(raw)) return { site: raw, source: 'usgs' };
  if (WSC_ID.test(raw)) return { site: raw, source: 'wsc' };

  // Tiers 1 + 3 + 4 on the fork-contracted form FIRST so "north fork flathead"
  // → "nf flathead" (tier 1 exact) before the original text ever reaches word-set
  // where a shorter alias like "the middle fork" could steal the match.
  const contracted = contractForks(key);
  if (contracted !== key) {
    const result = lookupText(contracted, aliases);
    if (result) return result;
  }

  // Fall through to original text (covers aliases that don't involve fork contractions).
  return lookupText(key, aliases);
}

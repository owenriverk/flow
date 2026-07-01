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

/** If `phrase` appears in `text` as a whole word/phrase, its [start, end) span; else null. */
function phraseSpan(text: string, phrase: string): [number, number] | null {
  if (text === phrase) return [0, text.length];
  if (text.startsWith(`${phrase} `)) return [0, phrase.length];
  if (text.endsWith(` ${phrase}`)) return [text.length - phrase.length, text.length];
  const idx = text.indexOf(` ${phrase} `);
  if (idx !== -1) return [idx + 1, idx + 1 + phrase.length];
  return null;
}

// Stop words stripped before word-set matching so prepositions and articles
// in the message don't prevent a match ("middle fork of the salmon" → mf salmon).
const STOP = new Set(['of', 'the', 'at', 'near', 'below', 'above', 'on', 'a', 'an', 'in', 'for']);

function contentWords(phrase: string): string[] {
  return phrase.split(' ').filter((w) => w.length > 0 && !STOP.has(w));
}

function gaugeKey(alias: GaugeAlias): string {
  return `${alias.source ?? 'usgs'}:${alias.site}`;
}

/**
 * Picks a single alias out of a set of candidates that all matched the same query,
 * which may point at different gauges. If they all agree on the gauge, the longest
 * (most specific) candidate wins, same as before. If they don't agree, the query is
 * genuinely ambiguous -- e.g. "stikine grand canyon" substring-matches both "stikine"
 * and the unrelated Colorado "grand canyon" alias -- and returning either one would be
 * a silent wrong answer on a tool people make river safety calls with. null here means
 * "don't guess," not "no match": the caller stops rather than falling through to a
 * weaker tier that's no better positioned to resolve the same conflict.
 */
function resolveCandidates(candidates: string[], aliases: Record<string, GaugeAlias>): string | null {
  if (candidates.length === 0) return null;
  const gauges = new Set(candidates.map((c) => gaugeKey(aliases[c]!)));
  if (gauges.size > 1) return null;
  return candidates.reduce((a, b) => (b.length > a.length ? b : a));
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

  // Tier 3: a known run name appearing verbatim inside the message. A match fully
  // nested inside a longer match ("grand canyon" inside "tuolumne grand canyon") is
  // just a substring of the more specific hit, not independent evidence about a
  // different river -- so nested matches are dropped before checking agreement.
  const spanMatches: Array<{ candidate: string; start: number; end: number }> = [];
  for (const candidate of Object.keys(aliases)) {
    const span = phraseSpan(key, candidate);
    if (span) spanMatches.push({ candidate, start: span[0], end: span[1] });
  }
  const topLevelSpans = spanMatches.filter(
    (m) =>
      !spanMatches.some(
        (o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start,
      ),
  );
  if (topLevelSpans.length > 0) {
    const tier3 = resolveCandidates(
      topLevelSpans.map((m) => m.candidate),
      aliases,
    );
    return tier3 ? toRef(aliases[tier3]!) : null;
  }

  // Tier 4: word-set — every content word of a known alias appears in the query,
  // order and position ignored. Handles prepositions and filler: "middle fork of
  // the salmon" → mf salmon, "gates lodore" → gates of lodore. Same nesting +
  // agreement handling as tier 3: a candidate whose words are a subset of another
  // matching candidate's is dropped as non-independent evidence first.
  const keyWords = new Set(contentWords(key));
  const wordMatches = Object.keys(aliases).filter((candidate) => {
    const words = contentWords(candidate);
    return words.length > 0 && words.every((w) => keyWords.has(w));
  });
  const topLevelWords = wordMatches.filter(
    (c) =>
      !wordMatches.some((o) => {
        if (o === c) return false;
        const wordsO = contentWords(o);
        const wordsC = new Set(contentWords(c));
        return wordsO.length > wordsC.size && wordsO.every((w) => wordsC.has(w));
      }),
  );
  const tier4 = resolveCandidates(topLevelWords, aliases);
  return tier4 ? toRef(aliases[tier4]!) : null;
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

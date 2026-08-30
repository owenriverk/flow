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

export type GaugeSource = 'usgs' | 'wsc' | 'cdec' | 'dreamflows' | 'noaa' | 'envdata' | 'flowrate';

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
  // Punctuation is separator, not content. Two failure modes without this:
  //   "stikine, clore"  -- the comma left "stikine," unmatchable, so the message
  //                        silently resolved to Clore alone (a half-answer);
  //   "kings?"          -- the trailing ? blocked every tier, so the single most
  //                        natural phrasing there is returned not-found.
  return text
    .trim()
    .toLowerCase()
    .replace(/[,;:/|?!.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

/**
 * EVERY whole-word occurrence of `phrase` in `text`, as [start, end) spans.
 * All occurrences matter: in "grand canyon clore grand canyon" the first
 * "grand canyon" is nested inside the Clore alias, but the second stands alone
 * -- an occurrence-blind matcher loses it, and with it the evidence that the
 * message names two rivers.
 */
function phraseSpans(text: string, phrase: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(phrase, from);
    if (idx === -1) break;
    const boundedLeft = idx === 0 || text[idx - 1] === ' ';
    const boundedRight = idx + phrase.length === text.length || text[idx + phrase.length] === ' ';
    if (boundedLeft && boundedRight) spans.push([idx, idx + phrase.length]);
    from = idx + 1;
  }
  return spans;
}

interface SpanMatch {
  candidate: string;
  start: number;
  end: number;
}

function allSpanMatches(key: string, aliases: Record<string, GaugeAlias>): SpanMatch[] {
  const matches: SpanMatch[] = [];
  for (const candidate of Object.keys(aliases)) {
    for (const [start, end] of phraseSpans(key, candidate)) matches.push({ candidate, start, end });
  }
  return matches;
}

/**
 * Drop spans strictly contained in a longer span: a match nested inside a more
 * specific hit ("grand canyon" inside "tuolumne grand canyon", "devils" inside
 * "devils postpile") is a substring of it, not independent evidence about a
 * different river. Shared by tier 3 and the two-river guard so they can never
 * disagree about what counts as evidence.
 */
function topLevel(matches: SpanMatch[]): SpanMatch[] {
  return matches.filter(
    (m) =>
      !matches.some(
        (o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start,
      ),
  );
}

// Joins two separate asks ("gauley and green", "stikine, clore"). Distinct from the
// stop words below: a stop word is noise inside one river's name, a conjunction is
// evidence the message names more than one river.
const CONJUNCTION = /(^|\s)(and|plus|&|\+)(\s|$)|,/;

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
  // Spaced abbreviations, the form USGS itself uses ("N F Flathead River nr
  // Columbia Falls MT"). Without these, "n f flathead" lost the fork entirely
  // and matched the bare "flathead" alias -- which is the MIDDLE fork. A wrong
  // river, not a failed lookup.
  [/\bm f\b/g, 'mf'],
  [/\bn f\b/g, 'nf'],
  [/\bs f\b/g, 'sf'],
];

function contractForks(text: string): string {
  let result = text;
  for (const [pat, rep] of FORK_CONTRACTIONS) result = result.replace(pat, rep);
  return result;
}

/** The distinct gauges named by top-level (non-nested) phrase matches in `key`. */
function namedGauges(key: string, aliases: Record<string, GaugeAlias>): Set<string> {
  return new Set(topLevel(allSpanMatches(key, aliases)).map((m) => gaugeKey(aliases[m.candidate]!)));
}

/** Run tiers 1 (exact), 3 (phrase-contains), and 4 (word-set) against a given key. */
function lookupText(key: string, aliases: Record<string, GaugeAlias>): GaugeRef | null {
  // Tier 1: exact alias.
  if (aliases[key]) return toRef(aliases[key]!);

  // Tier 3: known run names appearing verbatim inside the message (every
  // occurrence), nested matches dropped, survivors put to the agreement rule.
  // Two-river conjunction messages never reach this point -- lookupGauge screens
  // them -- so a disagreement here is a single-river message whose qualifier
  // splits across phrases ("grand canyon AT phantom": the words of the more
  // specific alias are all present but non-contiguous, which phrase matching
  // can't see and tier 4's word-subset rule can). Fall through instead of dying.
  const survivors = topLevel(allSpanMatches(key, aliases));
  if (survivors.length > 0) {
    const tier3 = resolveCandidates(
      [...new Set(survivors.map((m) => m.candidate))],
      aliases,
    );
    if (tier3) return toRef(aliases[tier3]!);
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
        // Drop c when it is strictly less specific than o: every word of c also
        // appears in o, and o says more. "grand canyon" and "phantom" are both
        // subsets of "grand canyon phantom", so only the specific one survives.
        //
        // Compare DISTINCT words on both sides. An alias can repeat a word
        // ("grand canyon at grand canyon"), and counting the repeat made it look
        // longer than the alias that actually contains it, so it escaped the
        // filter and poisoned the agreement check for unrelated queries.
        const wordsC = new Set(contentWords(c));
        const wordsO = new Set(contentWords(o));
        return wordsC.size < wordsO.size && [...wordsC].every((w) => wordsO.has(w));
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

  // Tier 2: raw id (uppercased original so WSC letters survive; trailing
  // sentence punctuation stripped so "13246000?" still passes through).
  const raw = text.trim().toUpperCase().replace(/[?!.,;:]+$/, '');
  if (USGS_ID.test(raw)) return { site: raw, source: 'usgs' };
  if (WSC_ID.test(raw)) return { site: raw, source: 'wsc' };

  const contracted = contractForks(key);

  // Two-river guard. A conjunction (read from the RAW text -- normalize has
  // already eaten the comma) plus top-level phrases naming two different gauges
  // is a two-river ask: refuse, because answering would silently cover half the
  // question. Evidence is gathered from BOTH text forms: contraction can destroy
  // one river's alias ("kings, the middle fork" contracts to "kings, the mf",
  // where MF Salmon's alias no longer matches), and only the union sees through
  // that. Tier-1 exact matches are exempt on purpose: "grand canyon, phantom"
  // normalizes to the curated alias "grand canyon phantom" -- one river,
  // comma-qualified -- and a curated combined alias is explicit intent.
  if (CONJUNCTION.test(text.toLowerCase()) && !aliases[key] && !aliases[contracted]) {
    const named = new Set([...namedGauges(key, aliases), ...namedGauges(contracted, aliases)]);
    if (named.size > 1) return null;
  }

  // Tiers 1 + 3 + 4 on the fork-contracted form FIRST so "north fork flathead"
  // → "nf flathead" (tier 1 exact) before the original text ever reaches word-set
  // where a shorter alias like "the middle fork" could steal the match.
  if (contracted !== key) {
    const result = lookupText(contracted, aliases);
    if (result) return result;
  }

  // Fall through to original text (covers aliases that don't involve fork contractions).
  return lookupText(key, aliases);
}

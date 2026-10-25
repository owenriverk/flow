/**
 * Last-resort fuzzy matcher: when exact/raw-id/phrase lookup all miss, ask a small
 * Workers AI model to map the paddler's shorthand to one known run — slang and odd
 * phrasing the deterministic tiers can't reach (`deso` → Desolation/Green,
 * `river of no return` → Main Salmon).
 *
 * Safety: the model is given the fixed run list and told to return only a key or
 * NONE, AND we validate the reply against the real key set before trusting it. A
 * hallucinated or off-list answer resolves to null — it can never select a gauge
 * that isn't ours. The call also never throws; on any error it returns null and the
 * caller falls through to "not found".
 *
 * Model: picked by measurement, not vibes — scripts/benchmark-jev.mjs races
 * candidates on fuzzy-audit cases, real query_log misses, the 2026-06-30
 * incident class, and off-roster traps that must refuse. 2026-09-22 run
 * (scripts/data/benchmark-jev-2026-09-22T07-41-36.json): mistral-small-3.1-24b
 * went 28/28 where the previous llama-3.2-3b scored 22/28 — the 3b's misses
 * were the dangerous kind (gore canyon → the Grand Canyon gauge, futaleufu →
 * MF Feather, stikeen → Tatshenshini). Still free-tier Workers AI at our
 * volume; the fallback tier fires a handful of times a month.
 */

import type { GaugeAlias } from './lookupGauge.js';

const MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';

// Shared with scripts/benchmark-jev.mjs so the benchmark always measures the
// prompt that ships. Typo-friendly, but no longer "be aggressive, prefer a best
// guess over NONE": that wording answered off-roster asks with the nearest run
// on the list (2026-10-24: "RIODELCO", the Rio Grande's station code, came back
// as Ruby-Horsethief). plausibleMatch below backstops whatever the model says.
export const AI_SYSTEM_PROMPT =
  "You match a whitewater paddler's message to one river run from a fixed list. " +
  'Common abbreviations: MF/mid fork = middle fork, NF = north fork, SF = south fork. ' +
  'Typos are common — match the closest listed run even with misspelling. ' +
  'Reply NONE if the message names a river that is not on the list, or is a station code or ID. ' +
  'A wrong river is worse than NONE. ' +
  'Reply with ONLY the exact run key (text before the dash), or NONE. No explanation.';

/**
 * Model reply -> alias key, or null. Only the first line counts: the model
 * sometimes answers correctly and then keeps generating fake follow-up turns
 * ("deschutes\n\nMessage: ..."), which used to sink a right answer.
 */
export function parseAiReply(response: string, keys: string[]): string | null {
  const firstLine = response.trim().split('\n')[0]!;
  const norm = firstLine.replace(/["'`]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (keys.includes(norm)) return norm;

  // The model sometimes echoes "key — label"; take the part before the dash.
  const beforeDash = norm.split(/\s[—-]\s/)[0]!.trim();
  if (keys.includes(beforeDash)) return beforeDash;

  return null;
}

// Words too common across rivers to count as evidence: "gore canyon" sharing
// "gorge"-ish spelling with Royal Gorge says nothing about which river it is.
const GENERIC_WORDS = new Set([
  'river', 'rivr', 'canyon', 'gorge', 'creek', 'fork', 'falls', 'the', 'of', 'at', 'and', 'near',
  'upper', 'lower', 'middle', 'north', 'south', 'east', 'west', 'main', 'mf', 'nf', 'sf',
  'flow', 'flows', 'level', 'levels', 'cfs',
]);

const words = (s: string) =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0 && !GENERIC_WORDS.has(w));

/** Edit distance counting an adjacent swap as one edit ("stikeen" -> "stikine" is 2). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * Deterministic backstop on the model's pick: the message must share at least
 * one distinctive word with the chosen run (any of its alias keys, or its
 * name), allowing 1 typo for words of 5+ letters and 2 for 7+. The
 * AI tier exists for misspellings and padding of names we carry, and every one
 * of those keeps a recognizable word; a wrong-river guess like RIODELCO ->
 * Ruby-Horsethief shares none, so it is refused whatever the prompt says.
 */
export function plausibleMatch(text: string, key: string, aliases: Record<string, GaugeAlias>): boolean {
  const chosen = aliases[key];
  if (!chosen) return false;
  const runWords = new Set(words(chosen.name));
  for (const [k, a] of Object.entries(aliases)) {
    if (a.site === chosen.site && a.name === chosen.name) for (const w of words(k)) runWords.add(w);
  }
  return words(text).some((q) =>
    [...runWords].some((r) => {
      if (q === r) return true;
      const budget = Math.min(q.length, r.length) >= 7 ? 2 : Math.min(q.length, r.length) >= 5 ? 1 : 0;
      return budget > 0 && editDistance(q, r) <= budget;
    }),
  );
}

export interface AiBinding {
  run(
    model: string,
    input: { messages: Array<{ role: string; content: string }>; max_tokens?: number; temperature?: number },
  ): Promise<{ response?: string }>;
}

export async function aiResolve(
  text: string,
  aliases: Record<string, GaugeAlias>,
  ai: AiBinding,
): Promise<string | null> {
  const keys = Object.keys(aliases);
  const menu = keys.map((k) => `${k} — ${aliases[k]!.name}, ${aliases[k]!.location}`).join('\n');

  const system = AI_SYSTEM_PROMPT;
  const user = `Runs:\n${menu}\n\nMessage: "${text}"\nRun key:`;

  let response: string | undefined;
  try {
    const out = await ai.run(MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 24,
      temperature: 0,
    });
    response = out.response;
  } catch {
    return null;
  }
  if (!response) return null;

  const key = parseAiReply(response, keys);
  return key && plausibleMatch(text, key, aliases) ? key : null;
}

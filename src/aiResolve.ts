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

  const system =
    "You match a whitewater paddler's message to one river run from a fixed list. " +
    'Common abbreviations: MF/mid fork = middle fork, NF = north fork, SF = south fork. ' +
    'Typos are common — match the closest run even with misspelling. ' +
    'Be aggressive: prefer a best-guess match over NONE. ' +
    'Reply NONE only if the message is completely unrelated to any listed river. ' +
    'Reply with ONLY the exact run key (text before the dash), or NONE. No explanation.';
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

  const norm = response.replace(/["'`]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (keys.includes(norm)) return norm;

  // The model sometimes echoes "key — label"; take the part before the dash.
  const beforeDash = norm.split(/\s[—-]\s/)[0]!.trim();
  if (keys.includes(beforeDash)) return beforeDash;

  return null;
}

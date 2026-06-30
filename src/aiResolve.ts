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
 * Model: cheapest one capable of the river-knowledge bridging this needs. ~2 neurons
 * per call, so the 10k-neuron/day free tier covers thousands of calls.
 */

import type { GaugeAlias } from './lookupGauge.js';

const MODEL = '@cf/meta/llama-3.2-3b-instruct';

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
    "You match a whitewater paddler's shorthand to one river run from a fixed list. " +
    'Reply with ONLY the run key (the text before the dash), copied exactly, or the ' +
    'single word NONE if nothing clearly matches. No explanation, no extra text.';
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

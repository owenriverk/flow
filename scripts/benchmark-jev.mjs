/**
 * Jev vs Llama on the fuzzy river-lookup tier — measure, don't argue.
 *
 * Compares the current aiResolve arm (@cf/meta/llama-3.2-3b-instruct with the
 * 151-key menu prompt, replicated verbatim from src/aiResolve.ts) against
 * TypeSafe Jev on Workers AI (typesafe/jev), a typed decision model whose
 * choice question is structurally what aiResolve fakes with a prompt.
 *
 * The case set is the battleground that matters: queries the deterministic
 * tiers miss (typos, slang, ambiguity — from test/fuzzy-audit.test.ts and real
 * query_log misses) plus negatives that MUST resolve to NONE (off-roster
 * rivers, spam). Wrong-gauge beats no-gauge for typos; no-gauge beats
 * wrong-gauge for off-roster rivers — both directions are scored.
 *
 * Run:  node scripts/benchmark-jev.mjs [--arm llama|jev|both] [--verbose]
 * Auth: the local wrangler OAuth token (refresh with `npx wrangler whoami` if
 *       you see code 10000). Jev needs AI Gateway prepaid credits on the
 *       account; without balance it fails with code 2021.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ACCOUNT = 'c368641bb3e52824fdafbccb7437b5bc';
const LLAMA = '@cf/meta/llama-3.2-3b-instruct';

const aliases = JSON.parse(readFileSync(join(ROOT, 'src/aliases.json'), 'utf8'));
const { lookupGauge } = await import(join(ROOT, 'src/lookupGauge.ts')).catch(() => ({ lookupGauge: null }));

// ── auth ─────────────────────────────────────────────────────────────────────
const tomlPath = join(process.env.HOME, 'Library/Preferences/.wrangler/config/default.toml');
const token = readFileSync(tomlPath, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if (!token) throw new Error('no wrangler oauth token — run `npx wrangler login`');

// ── the run roster, deduped for Jev ──────────────────────────────────────────
// aliases.json has 151 keys over ~46 distinct runs. The Jev choice question
// gets one criterion per RUN (canonical = shortest alias key), with the other
// aliases folded into the description so the AKA knowledge rides in the
// request instead of depending on the model's world knowledge. An explicit
// `none` criterion carries the refusal path. 46+1 options, far under the
// 255-option cap even at the future ~200-run roster.
const runId = (a) => `${a.site}|${a.name}`;
const runs = new Map(); // runId -> { canonical, name, location, akas: [] }
for (const [key, a] of Object.entries(aliases)) {
  const id = runId(a);
  if (!runs.has(id)) runs.set(id, { canonical: key, name: a.name, location: a.location, akas: [] });
  const r = runs.get(id);
  if (key.length < r.canonical.length) { r.akas.push(r.canonical); r.canonical = key; }
  else if (key !== r.canonical) r.akas.push(key);
}
const criteria = { none: 'Not about any listed river — an unlisted river, spam, or an unrelated message.' };
for (const r of runs.values()) {
  criteria[r.canonical] =
    `${r.name}, ${r.location}${r.akas.length ? `. Also called: ${r.akas.join(', ')}` : ''}`;
}

// Map any predicted alias key back to its run identity for scoring.
const keyToRun = (key) => (aliases[key] ? runId(aliases[key]) : null);
const nameToRun = (name) => {
  for (const a of Object.values(aliases)) if (a.name === name) return runId(a);
  throw new Error(`benchmark expects unknown run name: ${name}`);
};

// ── cases ────────────────────────────────────────────────────────────────────
// expect: array of acceptable run NAMES, or 'NONE'. src: where the case came from.
const CASES = [
  // typos — no deterministic path (fuzzy-audit "AI-only")
  { q: 'stikeen', expect: ['Stikine (Grand Canyon)'], src: 'audit/typo' },
  { q: 'deschuttes', expect: ['Deschutes R'], src: 'audit/typo' },
  { q: 'midle fork salmon', expect: ['Middle Fork Salmon'], src: 'typo' },
  { q: 'yampa colo', expect: ['Yampa R'], src: 'audit/extra-word' },
  // ambiguity — several plausible gauges; any of them is a win
  { q: 'green river', expect: ['Desolation (Green R)', 'Gates of Lodore (Green R)'], src: 'audit/ambiguous' },
  { q: 'salmon', expect: ['Middle Fork Salmon', 'Main Salmon', 'Lower Salmon', 'South Fork Salmon'], src: 'audit/ambiguous' },
  // the 2026-06-30 production incident class: det refuses, AI must not pick Colorado
  { q: 'stikine grand canyon', expect: ['Stikine (Grand Canyon)'], src: 'incident' },
  { q: 'stikine rivr grand canyon', expect: ['Stikine (Grand Canyon)'], src: 'incident' },
  { q: 'zymoetz grand canyon', expect: ['Clore (Zymoetz R)'], src: 'incident' },
  { q: 'copper river grand canyon', expect: ['Clore (Zymoetz R)'], src: 'incident' },
  // real query_log misses / phrasings
  { q: 'snake river', expect: ['Hells Canyon (Snake R)'], src: 'query_log' },
  { q: 'phantom at 3 pm', expect: ['Grand Canyon — Phantom (Colorado R)'], src: 'query_log' },
  {
    q: 'grand canyon near grand canyon',
    expect: ['Grand Canyon (Colorado R)', 'Grand Canyon — Phantom (Colorado R)'],
    src: 'query_log',
  },
  {
    q: 'i want the flow of the grand canyon near phantom ranch please',
    expect: ['Grand Canyon — Phantom (Colorado R)', 'Grand Canyon (Colorado R)'],
    src: 'query_log',
  },
  { q: 'flows for the mfs?', expect: ['Middle Fork Salmon'], src: 'slang' },
  // negatives — a wrong gauge here is worse than NOT_FOUND. Real rivers we
  // deliberately do not carry must not be mapped to a neighbor.
  { q: 'lochsa', expect: 'NONE', src: 'off-roster' },
  { q: 'kern river', expect: 'NONE', src: 'off-roster (pulled)' },
  { q: 'westwater', expect: 'NONE', src: 'off-roster (pulled)' },
  { q: 'pizza delivery to my house', expect: 'NONE', src: 'unrelated' },
  { q: 'we are a professional web design company based in india', expect: 'NONE', src: 'spam (real)' },
];

// ── arms ─────────────────────────────────────────────────────────────────────
async function cf(path, body) {
  const t0 = performance.now();
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { json, ms: Math.round(performance.now() - t0) };
}

// Verbatim replica of src/aiResolve.ts — prompt, params, and validation.
async function llamaArm(text) {
  const keys = Object.keys(aliases);
  const menu = keys.map((k) => `${k} — ${aliases[k].name}, ${aliases[k].location}`).join('\n');
  const system =
    "You match a whitewater paddler's message to one river run from a fixed list. " +
    'Common abbreviations: MF/mid fork = middle fork, NF = north fork, SF = south fork. ' +
    'Typos are common — match the closest run even with misspelling. ' +
    'Be aggressive: prefer a best-guess match over NONE. ' +
    'Reply NONE only if the message is completely unrelated to any listed river. ' +
    'Reply with ONLY the exact run key (text before the dash), or NONE. No explanation.';
  const user = `Runs:\n${menu}\n\nMessage: "${text}"\nRun key:`;
  const { json, ms } = await cf(`/ai/run/${LLAMA}`, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 24,
    temperature: 0,
  });
  const raw = json?.result?.response ?? json?.result?.choices?.[0]?.message?.content;
  if (!raw) return { pred: null, ms, raw: JSON.stringify(json?.errors ?? json).slice(0, 120) };
  const norm = raw.replace(/["'`]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (keys.includes(norm)) return { pred: norm, ms, raw };
  const beforeDash = norm.split(/\s[—-]\s/)[0].trim();
  if (keys.includes(beforeDash)) return { pred: beforeDash, ms, raw };
  return { pred: null, ms, raw };
}

async function jevArm(text) {
  const { json, ms } = await cf('/ai/run', {
    model: 'typesafe/jev',
    input: {
      state: text,
      questions: {
        run: {
          type: 'choice',
          instructions:
            "Which river run does this whitewater paddler's message mean? " +
            'Typos and shorthand are common (MF = middle fork, NF = north fork, SF = south fork). ' +
            'Pick none only when the message is about an unlisted river or is unrelated.',
          criteria,
        },
      },
    },
  });
  const ans = json?.result?.answers?.run ?? json?.answers?.run;
  if (!ans) return { pred: null, ms, raw: JSON.stringify(json?.errors ?? json).slice(0, 160) };
  const pred = ans.choice === 'none' ? null : ans.choice;
  return { pred, ms, raw: ans.choice, confidence: ans.confidence, probabilities: ans.probabilities };
}

// ── scoring + report ─────────────────────────────────────────────────────────
const armFlag = process.argv.includes('--arm')
  ? process.argv[process.argv.indexOf('--arm') + 1]
  : 'both';
const verbose = process.argv.includes('--verbose');
const arms = { llama: llamaArm, jev: jevArm };
const chosen = armFlag === 'both' ? ['llama', 'jev'] : [armFlag];

const results = {};
for (const armName of chosen) {
  const rows = [];
  for (const c of CASES) {
    const out = await arms[armName](c.q);
    const predRun = out.pred ? keyToRun(out.pred) : null;
    const ok =
      c.expect === 'NONE'
        ? out.pred === null
        : predRun !== null && c.expect.some((n) => nameToRun(n) === predRun);
    // Which cases even reach the AI tier in production?
    const det = lookupGauge ? lookupGauge(c.q, aliases) !== null : null;
    rows.push({ ...c, pred: out.pred, ok, ms: out.ms, det, confidence: out.confidence, raw: out.raw });
    const mark = ok ? '✓' : '✗';
    const conf = out.confidence != null ? ` conf=${out.confidence.toFixed(2)}` : '';
    console.log(
      `${armName.padEnd(5)} ${mark} ${String(out.ms).padStart(5)}ms  "${c.q}" → ${out.pred ?? 'NONE'}${conf}` +
        (ok ? '' : `   [wanted: ${c.expect === 'NONE' ? 'NONE' : c.expect.join(' | ')}]`) +
        (verbose && !ok ? `  raw: ${out.raw}` : ''),
    );
  }
  const pass = rows.filter((r) => r.ok).length;
  const aiOnly = rows.filter((r) => r.det === false);
  const aiPass = aiOnly.filter((r) => r.ok).length;
  const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
  results[armName] = { rows, pass, total: rows.length };
  console.log(
    `\n${armName.toUpperCase()}: ${pass}/${rows.length} overall` +
      (aiOnly.length ? ` | ${aiPass}/${aiOnly.length} on true AI-tier cases (det misses)` : '') +
      ` | latency p50 ${lat[Math.floor(lat.length / 2)]}ms max ${lat[lat.length - 1]}ms\n`,
  );
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = join(ROOT, `scripts/data/benchmark-jev-${stamp}.json`);
writeFileSync(outPath, JSON.stringify({ date: new Date().toISOString(), criteriaCount: Object.keys(criteria).length, results }, null, 2));
console.log(`saved: ${outPath}`);

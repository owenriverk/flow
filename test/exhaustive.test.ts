/**
 * Exhaustive resolver invariants — the acceptance gate for ANY change to
 * src/lookupGauge.ts or src/aliases.json. ~137k generated queries: every alias
 * x trivia/filler, EVERY ordered alias pair x six joiners, order symmetry, raw
 * ids, junk. Offline and deterministic; takes a minute or two, so it is opt-in:
 *
 *     EXHAUSTIVE=1 npx vitest run test/exhaustive.test.ts
 *
 * Born 2026-08-30: a sampled fuzzer (every 4th alias) declared the resolver
 * clean while full enumeration found 2,068 violations across four defect
 * classes. On a tool people make river safety calls with, the bar for resolver
 * changes is every invariant at zero over the full space, not a sample.
 *
 * The oracle below (normQ/contractQ/evidence) deliberately REIMPLEMENTS the
 * resolver's evidence rule rather than importing it, so a bug in the resolver
 * cannot hide inside its own oracle.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import aliasesJson from '../src/aliases.json' with { type: 'json' };
import { lookupGauge, type GaugeAlias } from '../src/lookupGauge.js';

declare const process: { env: Record<string, string | undefined> };
const exhaustive = process.env.EXHAUSTIVE ? describe : describe.skip;

const A = aliasesJson as Record<string, GaugeAlias>;
const keys = Object.keys(A);
const gaugeOf: Record<string, string> = {};
for (const k of keys) gaugeOf[k] = `${A[k]!.source ?? 'usgs'}:${A[k]!.site}`;
const id = (r: ReturnType<typeof lookupGauge>) => (r ? `${r.source ?? 'usgs'}:${r.site}` : 'NULL');

// ── independent oracle ───────────────────────────────────────────────────────
const normQ = (t: string) => t.trim().toLowerCase().replace(/[,;:/|?!.]+/g, ' ').replace(/\s+/g, ' ').trim();
const FORKS: Array<[RegExp, string]> = [
  [/\bmiddle fork\b/g, 'mf'], [/\bnorth fork\b/g, 'nf'], [/\bsouth fork\b/g, 'sf'],
  [/\bm f\b/g, 'mf'], [/\bn f\b/g, 'nf'], [/\bs f\b/g, 'sf'],
];
const contractQ = (t: string) => { let r = t; for (const [p, x] of FORKS) r = r.replace(p, x); return r; };
function spansAll(text: string, phrase: string): Array<[number, number]> {
  const out: Array<[number, number]> = []; let from = 0;
  for (;;) {
    const i = text.indexOf(phrase, from); if (i === -1) break;
    const L = i === 0 || text[i - 1] === ' ';
    const R = i + phrase.length === text.length || text[i + phrase.length] === ' ';
    if (L && R) out.push([i, i + phrase.length]); from = i + 1;
  }
  return out;
}
function evidence(q: string): Set<string> {
  const out = new Set<string>();
  for (const form of new Set([normQ(q), contractQ(normQ(q))])) {
    const ms: { c: string; s: number; e: number }[] = [];
    for (const c of keys) for (const [s0, e0] of spansAll(form, c)) ms.push({ c, s: s0, e: e0 });
    const top = ms.filter((m) => !ms.some((o) => o !== m && o.s <= m.s && o.e >= m.e && o.e - o.s > m.e - m.s));
    for (const m of top) out.add(gaugeOf[m.c]!);
  }
  return out;
}
const legitimatelyResolves = (q: string, got: string) => {
  const nk = normQ(q), ck = contractQ(nk);
  if ((nk in A && gaugeOf[nk] === got) || (ck in A && gaugeOf[ck] === got)) return true;
  const ev = evidence(q);
  return ev.size === 1 && ev.has(got);
};

// ── run everything once; each invariant asserts its own bucket ───────────────
const JOIN = { comma: ', ', and: ' and ', amp: ' & ', plus: ' plus ', at: ' at ', space: ' ' } as const;
const CONJ = new Set(['comma', 'and', 'amp', 'plus']);
const TEMPLATES = ['what is the flow for {}', '{} please', 'hey {}', 'current {} level', '{} right now thanks',
  'is {} running', 'send {}', '{} tomorrow', '{} cfs?', 'how high is {}', 'checking {} today', '{} status'];
const JUNK = ['', ' ', 'hello', 'thanks', 'help', 'stop', 'test', 'yes', 'no', 'flow', 'river', 'gauge',
  'what rivers do you have', 'how does this work', '???', '...', 'and', ',', 'at', 'the', 'of the at',
  'asdfghjkl', 'qwerty', '🌊🚣', 'salmonella', 'grandiose canyon', 'kingsbury', 'a'.repeat(300)];

const viol: Record<string, string[]> = {};
const V = (rule: string, msg: string) => (viol[rule] ??= []).push(msg);

exhaustive('resolver invariants over the full query space', () => {
  beforeAll(() => {
    // R1: alias + trivia
    for (const k of keys) for (const q of [k, k.toUpperCase(), ` ${k} `, `${k}?`, `${k}.`, `${k}!`, `${k}??`, `\n${k}\n`]) {
      if (id(lookupGauge(q, A)) !== gaugeOf[k]) V('R1', `"${q}"`);
    }
    // R2: filler
    for (const k of keys) for (const t of TEMPLATES) {
      const got = id(lookupGauge(t.replace('{}', k), A));
      if (got !== gaugeOf[k] && got !== 'NULL') V('R2', `"${t.replace('{}', k)}" -> ${got}`);
      if (got === 'NULL') V('R2b', t.replace('{}', k));
    }
    // R3/R4/R5 + symmetry over EVERY ordered pair
    const res = new Map<string, string>();
    for (const a of keys) for (const b of keys) {
      if (a === b) continue;
      for (const [jn, js] of Object.entries(JOIN)) {
        const q = a + js + b;
        const got = id(lookupGauge(q, A));
        res.set(`${jn}|${a}|${b}`, got);
        if (got !== 'NULL' && got !== gaugeOf[a] && got !== gaugeOf[b]) V('R3', `"${q}" -> ${got}`);
        if (gaugeOf[a] === gaugeOf[b]) {
          if (got !== gaugeOf[a]) V('R4', `"${q}" -> ${got}`);
        } else if (CONJ.has(jn) && got !== 'NULL' && !legitimatelyResolves(q, got)) {
          V('R5', `"${q}" -> ${got}`);
        }
      }
    }
    for (const a of keys) for (const b of keys) {
      if (a >= b || gaugeOf[a] === gaugeOf[b]) continue;
      for (const jn of CONJ) {
        const js = JOIN[jn as keyof typeof JOIN];
        const r1 = res.get(`${jn}|${a}|${b}`)!, r2 = res.get(`${jn}|${b}|${a}`)!;
        if ((r1 === 'NULL') === (r2 === 'NULL')) continue;
        const legit1 = r1 !== 'NULL' && legitimatelyResolves(a + js + b, r1);
        const legit2 = r2 !== 'NULL' && legitimatelyResolves(b + js + a, r2);
        if (!legit1 && !legit2) V('R6', `${jn}: "${a}" / "${b}": ${r1} vs ${r2}`);
      }
    }
    // R7: raw ids, with and without trailing punctuation
    for (const v of Object.values(A)) {
      const src = v.source ?? 'usgs';
      if (src !== 'usgs' && src !== 'wsc') continue;
      for (const q of [v.site, `${v.site}?`, `${v.site}.`]) {
        if (id(lookupGauge(q, A)) !== `${src}:${v.site}`) V('R7', `"${q}"`);
      }
    }
    // R8: junk
    for (const q of JUNK) { const got = id(lookupGauge(q, A)); if (got !== 'NULL') V('R8', `"${q.slice(0, 40)}" -> ${got}`); }
  }, 600_000);

  test('R1 every alias survives case, whitespace, and terminal punctuation', () => expect(viol['R1'] ?? []).toEqual([]));
  test('R2 filler words never flip the river', () => expect(viol['R2'] ?? []).toEqual([]));
  test('R2b filler words never cause a miss', () => expect(viol['R2b'] ?? []).toEqual([]));
  test('R3 no query ever resolves to a gauge neither named', () => expect(viol['R3'] ?? []).toEqual([]));
  test('R4 pairs naming one gauge always resolve to it', () => expect(viol['R4'] ?? []).toEqual([]));
  test('R5 conjunction + two gauges refuses unless evidence is unanimous', () => expect(viol['R5'] ?? []).toEqual([]));
  test('R6 conjunction refusal is order-symmetric', () => expect(viol['R6'] ?? []).toEqual([]));
  test('R7 raw ids pass through, trailing punctuation included', () => expect(viol['R7'] ?? []).toEqual([]));
  test('R8 junk and adversarial input never resolves', () => expect(viol['R8'] ?? []).toEqual([]));
});

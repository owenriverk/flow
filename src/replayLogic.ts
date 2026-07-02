/**
 * Pure logic behind the nightly CI query-replay job (scripts/replay.ts).
 * Everything here is unit-tested; the script is a thin I/O shell.
 *
 * The idea: every query a real paddler ever sent is a regression test.
 * Nightly, CI re-resolves the whole corpus through the DETERMINISTIC lookup
 * (no AI) using the checked-out commit's aliases, and diffs against last
 * night's resolutions. Any change on a phrasing a paddler once used = alert.
 *
 * Why there is no explicit "exclude AI-resolved queries" step: a query that
 * only ever resolved via the AI fallback is a STABLE deterministic miss
 * (null last night, null tonight) — the diff can never flag it. And the
 * Sunday digest keys off query_log's `resolved` flag, so AI-carried queries
 * don't pollute the never-resolved list; they get their own digest section
 * instead, because "resolves only via AI" is exactly the signal that an
 * alias is worth adding.
 *
 * No rebaseline machinery either: CI always runs code and aliases from the
 * same commit, so an intentional alias edit shows up as a diff exactly once,
 * in a job attached to the commit that caused it.
 */

import { lookupGauge, type GaugeAlias } from './lookupGauge.js';

export interface CorpusRow {
  query: string;
  resolved: boolean;
}

export interface ReplaySnapshot {
  resolutions: Record<string, string | null>;
  digestLastSent?: string | null;
}

export interface ResolutionChange {
  query: string;
  before: string | null;
  after: string | null;
}

/** Rows arrive newest-first; keep each query's most recent row, capped. */
export function dedupeLatest(rows: CorpusRow[], cap: number): CorpusRow[] {
  const seen = new Set<string>();
  const out: CorpusRow[] = [];
  for (const row of rows) {
    const key = row.query.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ query: key, resolved: row.resolved });
    if (out.length >= cap) break;
  }
  return out;
}

/** Deterministic resolution of the whole corpus: query -> "source:site" | null. */
export function computeResolutions(
  rows: CorpusRow[],
  aliases: Record<string, GaugeAlias>,
): Record<string, string | null> {
  const resolutions: Record<string, string | null> = {};
  for (const row of rows) {
    const ref = lookupGauge(row.query, aliases);
    resolutions[row.query] = ref ? `${ref.source ?? 'usgs'}:${ref.site}` : null;
  }
  return resolutions;
}

/** Changes on queries present in BOTH snapshots. Brand-new queries baseline
 *  silently; queries that stopped arriving are dropped silently. */
export function diffResolutions(
  prev: Record<string, string | null>,
  curr: Record<string, string | null>,
): ResolutionChange[] {
  const changes: ResolutionChange[] = [];
  for (const [query, after] of Object.entries(curr)) {
    if (!(query in prev)) continue;
    const before = prev[query] ?? null;
    if (before !== after) changes.push({ query, before, after });
  }
  return changes.sort((a, b) => a.query.localeCompare(b.query));
}

/** Sunday (UTC) and not already sent in the last 6 days. */
export function shouldSendDigest(now: Date, lastSentIso: string | null | undefined): boolean {
  if (now.getUTCDay() !== 0) return false;
  if (!lastSentIso) return true;
  const last = Date.parse(lastSentIso);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last > 6 * 24 * 3_600_000;
}

export interface Digest {
  neverResolved: string[];
  aiCarried: string[];
}

/** Alias candidates: queries nothing resolves, and queries only the AI
 *  fallback carries (resolved=true in the log, deterministic miss tonight). */
export function buildDigest(
  rows: CorpusRow[],
  resolutions: Record<string, string | null>,
): Digest {
  const neverResolved: string[] = [];
  const aiCarried: string[] = [];
  for (const row of rows) {
    if (resolutions[row.query] !== null) continue;
    (row.resolved ? aiCarried : neverResolved).push(row.query);
  }
  return { neverResolved: neverResolved.sort(), aiCarried: aiCarried.sort() };
}

export function formatDigest(digest: Digest): string {
  const lines: string[] = ['Weekly lookup digest — alias candidates', ''];
  if (digest.aiCarried.length > 0) {
    lines.push(
      'Carried by the AI fallback only (an alias would make these robust):',
      ...digest.aiCarried.map((q) => `  - ${q}`),
      '',
    );
  }
  if (digest.neverResolved.length > 0) {
    lines.push(
      'Never resolved by anything (misspellings, uncovered runs, or noise):',
      ...digest.neverResolved.map((q) => `  - ${q}`),
      '',
    );
  }
  if (digest.aiCarried.length === 0 && digest.neverResolved.length === 0) {
    lines.push('Every logged query resolves deterministically. Nothing to do.');
  }
  return lines.join('\n');
}

export function formatChanges(changes: ResolutionChange[]): string {
  return [
    'Query replay found resolution changes on real historical queries:',
    '',
    ...changes.map((c) => `  "${c.query}": ${c.before ?? 'NOT FOUND'} -> ${c.after ?? 'NOT FOUND'}`),
    '',
    'If this was an intentional alias edit, this one red run is the receipt.',
    'If not, a lookup regression just shipped — check the latest commits to',
    'src/aliases.json and src/lookupGauge.ts.',
  ].join('\n');
}

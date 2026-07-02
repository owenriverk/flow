/**
 * Nightly query replay + Sunday digest — thin I/O shell around
 * src/replayLogic.ts (which holds all the tested logic). Runs in GitHub
 * Actions via `npx tsx scripts/replay.ts` with the Supabase SERVICE-ROLE key
 * (Actions secret; the anon key is public and deliberately cannot read
 * query_log or replay_snapshot).
 *
 * Exit 1 (= red run + GitHub failure email) when any real historical query
 * resolves differently than last night. The new snapshot is written either
 * way: one alert per change, attached to the run that detected it — the
 * transition-only philosophy the Worker checks use.
 */

import aliasesJson from '../src/aliases.json' with { type: 'json' };
import type { GaugeAlias } from '../src/lookupGauge.js';
import {
  buildDigest,
  computeResolutions,
  dedupeLatest,
  diffResolutions,
  formatChanges,
  formatDigest,
  shouldSendDigest,
  type CorpusRow,
  type ReplaySnapshot,
} from '../src/replayLogic.js';

const CORPUS_CAP = 2000;
const FETCH_ROWS = 5000; // newest-first raw rows to dedupe down from

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required env: ${name}`);
    process.exit(2);
  }
  return value;
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function fetchCorpus(): Promise<CorpusRow[]> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/query_log?select=query,resolved&channel=neq.canary` +
      `&order=created_at.desc&limit=${FETCH_ROWS}`,
    { headers },
  );
  if (!res.ok) throw new Error(`query_log read failed: HTTP ${res.status}`);
  return dedupeLatest((await res.json()) as CorpusRow[], CORPUS_CAP);
}

async function fetchSnapshot(): Promise<ReplaySnapshot | null> {
  const res = await fetch(`${supabaseUrl}/rest/v1/replay_snapshot?select=snapshot&id=eq.1`, {
    headers,
  });
  if (!res.ok) throw new Error(`replay_snapshot read failed: HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ snapshot: ReplaySnapshot }>;
  return rows[0]?.snapshot ?? null;
}

async function writeSnapshot(snapshot: ReplaySnapshot): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/replay_snapshot?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: 1, snapshot, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`replay_snapshot write failed: HTTP ${res.status}`);
}

/** Digest goes out via the same SMTP creds the email canary uses; if they are
 *  not configured the digest is printed to the job log instead of emailed. */
async function sendDigestEmail(text: string): Promise<void> {
  const host = process.env.CANARY_SMTP_HOST;
  const user = process.env.CANARY_SMTP_USER;
  const pass = process.env.CANARY_SMTP_PASS;
  const to = process.env.OWNER_EMAIL ?? 'okurthdev@gmail.com';
  if (!host || !user || !pass) {
    console.log('SMTP not configured — digest below instead of emailed:\n');
    console.log(text);
    return;
  }
  const { default: nodemailer } = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.CANARY_SMTP_PORT ?? '465'),
    secure: (process.env.CANARY_SMTP_PORT ?? '465') === '465',
    auth: { user, pass },
  });
  await transporter.sendMail({ from: user, to, subject: '[LateBoof] Weekly lookup digest', text });
  console.log(`digest emailed to ${to}`);
}

const aliases = aliasesJson as Record<string, GaugeAlias>;
const now = new Date();

const corpus = await fetchCorpus();
console.log(`corpus: ${corpus.length} distinct queries (cap ${CORPUS_CAP})`);

const resolutions = computeResolutions(corpus, aliases);
const previous = await fetchSnapshot();
const changes = previous ? diffResolutions(previous.resolutions, resolutions) : [];

let digestLastSent = previous?.digestLastSent ?? null;
if (shouldSendDigest(now, digestLastSent)) {
  await sendDigestEmail(formatDigest(buildDigest(corpus, resolutions)));
  digestLastSent = now.toISOString();
}

await writeSnapshot({ resolutions, digestLastSent });
console.log(previous ? 'snapshot updated' : 'first run — baseline recorded, no comparison');

if (changes.length > 0) {
  console.error(formatChanges(changes));
  process.exit(1);
}
console.log('replay: no resolution changes');

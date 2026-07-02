/**
 * Email-loop canary — the primary delivery check for the Flow bot.
 *
 * Sends a real gauge query to the bot's inbox with the shared-secret subject
 * marker (so the Worker logs it as channel 'canary', not real traffic), then
 * IMAP-polls the sending mailbox until the bot's reply lands.
 *
 * The DELIVERY assertion is only "a reply arrived within 15 minutes":
 *   - an UNAVAILABLE-format reply still counts as delivery-OK (a USGS outage
 *     on the canary gauge is the gauge sweep's problem, not a delivery alarm)
 *   - the search covers every folder (Gmail's All Mail, spam, etc.) and
 *     matches by the unique run id in the subject, so a spam-foldered reply
 *     is not a false red
 *
 * Failure = non-zero exit = a red Action run + GitHub's failure email. The
 * Worker's nightly watchdog (canary_last_seen) covers the case where this
 * workflow silently stops being scheduled at all.
 */

import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';

const POLL_INTERVAL_MS = 60_000;
const DEADLINE_MS = 15 * 60_000;

function env(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    console.error(`missing required env: ${name}`);
    process.exit(2);
  }
  return value;
}

const to = env('CANARY_TO', 'flow@lateboof.com');
const query = env('CANARY_QUERY', 'selway');
const secret = env('CANARY_SECRET');
const smtp = {
  host: env('CANARY_SMTP_HOST'),
  port: Number(env('CANARY_SMTP_PORT', '465')),
  user: env('CANARY_SMTP_USER'),
  pass: env('CANARY_SMTP_PASS'),
};
const imap = {
  host: env('CANARY_IMAP_HOST'),
  user: env('CANARY_IMAP_USER'),
  pass: env('CANARY_IMAP_PASS'),
};

const runId = process.env.GITHUB_RUN_ID ?? String(Date.now());
const subject = `flow canary ${runId} [canary:${secret}]`;

async function send() {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  await transporter.sendMail({ from: smtp.user, to, subject, text: query });
  console.log(`sent "${query}" to ${to} (subject run id ${runId})`);
}

/** Look for the bot's reply in EVERY selectable mailbox — replies from a fresh
 *  domain routinely land in spam, and Gmail keeps copies in All Mail. */
async function findReply(client) {
  const boxes = await client.list();
  for (const box of boxes) {
    if (box.flags?.has('\\Noselect')) continue;
    const lock = await client.getMailboxLock(box.path);
    try {
      const uids = await client.search({ subject: `flow canary ${runId}`, since: new Date(Date.now() - 24 * 3600_000) });
      for (const uid of uids ?? []) {
        const msg = await client.fetchOne(uid, { envelope: true });
        const subj = msg?.envelope?.subject ?? '';
        // The reply is "Re: <our subject>"; our own sent copy is the exact subject.
        if (subj.startsWith('Re:')) {
          console.log(`reply found in "${box.path}": ${JSON.stringify(subj)}`);
          return true;
        }
      }
    } finally {
      lock.release();
    }
  }
  return false;
}

async function poll() {
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const client = new ImapFlow({
      host: imap.host,
      port: 993,
      secure: true,
      auth: { user: imap.user, pass: imap.pass },
      logger: false,
    });
    try {
      await client.connect();
      if (await findReply(client)) return true;
      console.log(`no reply yet (${Math.round((deadline - Date.now()) / 60000)} min left)`);
    } catch (err) {
      console.error(`imap poll error (will retry): ${err.message}`);
    } finally {
      await client.logout().catch(() => {});
    }
  }
  return false;
}

await send();
if (await poll()) {
  console.log('email-loop canary: delivery OK');
} else {
  console.error(`email-loop canary FAILED: no reply within ${DEADLINE_MS / 60000} minutes`);
  process.exit(1);
}

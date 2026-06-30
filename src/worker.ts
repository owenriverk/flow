/**
 * Cloudflare Email Worker entry point.
 *
 * Bound as the catch-all action on lateboof.com Email Routing. Decodes the inbound
 * MIME, then hands the plain-text body to the tested core. Reply paths:
 *   - InReach (body has an inreachlink token) → Garmin web-form POST.
 *   - normal email → message.reply() (also lets you test from a laptop).
 * Fuzzy run-name matching falls back to Workers AI, but only on a lookup miss and
 * only while under the daily call cap (keeps us inside the free neuron tier).
 *
 * Both reply paths are wrapped: on failure a notification goes to the owner's Gmail
 * (via the SEND_EMAIL binding) with enough info to manually respond to the paddler.
 *
 * This is the only file that touches the Workers runtime; everything it calls is
 * unit-tested.
 */

import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext';
import PostalMime from 'postal-mime';
import { handleInbound } from './handleInbound.js';
import { replyToInreach as defaultReplyToInreach } from './replyToInreach.js';
import { aiResolve, type AiBinding } from './aiResolve.js';
import { claimAiCall, type KvLike } from './budget.js';
import { fetchCachedReading } from './supabaseCache.js';
import aliasesJson from './aliases.json' with { type: 'json' };
import type { GaugeAlias } from './lookupGauge.js';

const aliases = aliasesJson as Record<string, GaugeAlias>;

// ~2.3 neurons/call → 1,000/day ≈ 2,300 neurons, well under the free 10k/day tier.
const MAX_AI_CALLS_PER_DAY = 1000;

const OWNER_EMAIL = 'okurthdev@gmail.com';

interface Env {
  AI: Ai;
  AI_BUDGET: KVNamespace;
  SEND_EMAIL: SendEmail;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const parsed = await new PostalMime().parse(message.raw);
    const body = parsed.text ?? '';

    // Send a plain-text alert to the owner. Errors here are swallowed so a broken
    // notification path can't mask the original failure.
    const notifyOwner = async (subject: string, text: string): Promise<void> => {
      const msg = createMimeMessage();
      msg.setSender({ name: 'LateBoof', addr: message.to });
      msg.setRecipient(OWNER_EMAIL);
      msg.setSubject(subject);
      msg.addMessage({ contentType: 'text/plain', data: text });
      await env.SEND_EMAIL.send(new EmailMessage(message.to, OWNER_EMAIL, msg.asRaw()));
    };

    const replyByEmail = async (text: string): Promise<void> => {
      const originalId = message.headers.get('Message-ID') ?? '';
      const originalSubject = message.headers.get('Subject') ?? 'river flow';
      const msg = createMimeMessage();
      if (originalId) {
        msg.setHeader('In-Reply-To', originalId);
        msg.setHeader('References', originalId);
      }
      msg.setSender({ name: 'Flow', addr: message.to });
      msg.setRecipient(message.from);
      msg.setSubject(originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`);
      msg.addMessage({ contentType: 'text/plain', data: text });
      await message.reply(new EmailMessage(message.to, message.from, msg.asRaw()));
    };

    // Wrapped reply paths — catch errors, notify owner, then swallow so the worker
    // exits cleanly rather than logging a second unhandled-rejection.

    const safeReplyToInreach = async (token: string, text: string): Promise<void> => {
      try {
        await defaultReplyToInreach(token, text);
      } catch (err) {
        console.error('replyToInreach failed:', err);
        await notifyOwner(
          '[LateBoof] InReach reply failed',
          [
            'Could not deliver reply to paddler via the Garmin web form.',
            '',
            `From:       ${message.from}`,
            `Reply link: https://inreachlink.com/${token}`,
            '',
            'Reply text that was not delivered:',
            '---',
            text,
            '---',
            '',
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ].join('\n'),
        ).catch((e) => console.error('notifyOwner failed:', e));
      }
    };

    const safeReplyByEmail = async (text: string): Promise<void> => {
      try {
        await replyByEmail(text);
      } catch (err) {
        console.error('replyByEmail failed:', err);
        await notifyOwner(
          '[LateBoof] Email reply failed',
          [
            'Could not reply by email to the original sender.',
            '',
            `From: ${message.from}`,
            '',
            'Reply text that was not delivered:',
            '---',
            text,
            '---',
            '',
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ].join('\n'),
        ).catch((e) => console.error('notifyOwner failed:', e));
      }
    };

    // AI fuzzy match, gated by the daily budget. Only invoked on a lookup miss.
    const resolveFuzzy = async (text: string): Promise<string | null> => {
      const allowed = await claimAiCall(env.AI_BUDGET as unknown as KvLike, MAX_AI_CALLS_PER_DAY);
      if (!allowed) return null;
      return aiResolve(text, aliases, env.AI as unknown as AiBinding);
    };

    ctx.waitUntil(
      handleInbound(body, {
        aliases,
        replyToInreach: safeReplyToInreach,
        replyByEmail: safeReplyByEmail,
        resolveFuzzy,
        fetchCached: (source, site) =>
          fetchCachedReading(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, source, site),
        onNoReplyPath: (query) => console.error('no reply path for query:', query),
      }).catch((err) => console.error('inbound handling failed:', err)),
    );
  },
};

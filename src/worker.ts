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
 * This is the only file that touches the Workers runtime; everything it calls is
 * unit-tested.
 */

import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext';
import PostalMime from 'postal-mime';
import { handleInbound } from './handleInbound.js';
import { aiResolve, type AiBinding } from './aiResolve.js';
import { claimAiCall, type KvLike } from './budget.js';
import aliasesJson from './aliases.json' with { type: 'json' };
import type { GaugeAlias } from './lookupGauge.js';

const aliases = aliasesJson as Record<string, GaugeAlias>;

// ~2.3 neurons/call → 1,000/day ≈ 2,300 neurons, well under the free 10k/day tier.
const MAX_AI_CALLS_PER_DAY = 1000;

interface Env {
  AI: Ai;
  AI_BUDGET: KVNamespace;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const parsed = await new PostalMime().parse(message.raw);
    const body = parsed.text ?? '';

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

    // AI fuzzy match, gated by the daily budget. Only invoked on a lookup miss.
    const resolveFuzzy = async (text: string): Promise<string | null> => {
      const allowed = await claimAiCall(env.AI_BUDGET as unknown as KvLike, MAX_AI_CALLS_PER_DAY);
      if (!allowed) return null;
      return aiResolve(text, aliases, env.AI as unknown as AiBinding);
    };

    ctx.waitUntil(
      handleInbound(body, {
        aliases,
        replyByEmail,
        resolveFuzzy,
        onNoReplyPath: (query) => console.error('no reply path for query:', query),
      }).catch((err) => console.error('inbound handling failed:', err)),
    );
  },
};

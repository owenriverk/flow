/**
 * Channel-agnostic glue between a decoded inbound email body and the reply.
 * The Cloudflare Worker decodes the MIME and calls this; everything here is testable
 * with injected deps (no Worker runtime, no network).
 *
 *   body ─▶ parseInbound ─▶ { query, token }
 *                              │
 *                  handleQuery(query) ─▶ reply text ─▶ onResolved(query, reply, channel)
 *                              │
 *          token? ─▶ replyToInreach(token, reply)    (InReach: Garmin web form)
 *          else   ─▶ replyByEmail(reply)             (normal email: message.reply)
 *          else   ─▶ onNoReplyPath(query)            (no way to answer)
 *
 * The two reply paths let the same bot serve InReach (token in the body) and any
 * ordinary email sender — which also means you can test the whole pipeline from a
 * laptop without spending InReach message credits.
 */

import { parseInbound } from './parseInbound.js';
import { handleQuery as defaultHandleQuery } from './handleQuery.js';
import { replyToInreach as defaultReplyToInreach } from './replyToInreach.js';
import type { GaugeAlias, GaugeSource } from './lookupGauge.js';
import type { Reading } from './formatReply.js';

export type ReplyChannel = 'inreach' | 'email' | 'none';

export interface InboundDeps {
  aliases: Record<string, GaugeAlias>;
  handleQueryFn?: (text: string) => Promise<string>;
  replyToInreach?: (token: string, text: string) => Promise<void>;
  replyByEmail?: (text: string) => Promise<void>;
  resolveFuzzy?: (text: string) => Promise<string | null>;
  fetchCached?: (source: GaugeSource, site: string) => Promise<Reading | null>;
  onNoReplyPath?: (query: string) => void;
  /** Fired after the reply is computed, before delivery -- e.g. for query logging. */
  onResolved?: (query: string, reply: string, channel: ReplyChannel) => void;
}

export async function handleInbound(body: string, deps: InboundDeps): Promise<void> {
  const { query, token } = parseInbound(body);

  const handleQueryFn =
    deps.handleQueryFn ??
    ((text: string) =>
      defaultHandleQuery(text, {
        aliases: deps.aliases,
        resolveFuzzy: deps.resolveFuzzy,
        fetchCached: deps.fetchCached,
      }));
  const reply = await handleQueryFn(query);

  const channel: ReplyChannel = token ? 'inreach' : deps.replyByEmail ? 'email' : 'none';
  deps.onResolved?.(query, reply, channel);

  if (token) {
    const replyToInreach = deps.replyToInreach ?? defaultReplyToInreach;
    await replyToInreach(token, reply);
  } else if (deps.replyByEmail) {
    await deps.replyByEmail(reply);
  } else {
    deps.onNoReplyPath?.(query);
  }
}

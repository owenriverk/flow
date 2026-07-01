/**
 * Computes the In-Reply-To / References headers for a plain-email reply, per
 * RFC 5322 §3.6.4.
 *
 * References must carry the *whole* ancestor chain -- the inbound message's own
 * References (if it's itself a reply) plus its own Message-ID appended -- not just
 * the immediate parent. Setting it to only the immediate parent works for a first
 * reply (no ancestors to inherit) but breaks any later reply in the same thread:
 * Gmail rejects it with "provided References header is invalid" because it doesn't
 * match the chain it computed from the thread.
 */

export interface ReplyHeaders {
  inReplyTo?: string;
  references?: string;
}

export function buildReplyHeaders(inboundMessageId: string, inboundReferences: string): ReplyHeaders {
  if (!inboundMessageId) return {};
  const references = inboundReferences ? `${inboundReferences} ${inboundMessageId}` : inboundMessageId;
  return { inReplyTo: inboundMessageId, references };
}

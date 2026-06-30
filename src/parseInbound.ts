/**
 * Parse the plain-text body of an InReach email into the query + the reply token.
 *
 * Real InReach body (the Worker decodes quoted-printable upstream via a MIME parser):
 *
 *   Middle Kings at Rodger's          <- the query (everything before the footer)
 *
 *   View the location or send a reply to Owen Kurth:
 *   https://inreachlink.com/gyWtLmrv-FK21I9GXuUZgFA   <- reply token lives here
 *   Do not reply directly to this message.
 *   This message was sent to you using the inReach ...
 *
 * The token feeds replyToInreach() — there is no email reply path (Garmin's
 * no.reply address bounces; the web form is the only way back to the device).
 */

export interface ParsedInbound {
  query: string;
  token: string | null;
}

const FOOTER = /View the location or send a reply/i;
const REPLY_LINK = /https?:\/\/inreachlink\.com\/([A-Za-z0-9_-]+)/i;

export function parseInbound(body: string): ParsedInbound {
  const link = body.match(REPLY_LINK);
  const token = link ? link[1]! : null;

  const cut = body.search(FOOTER);
  const beforeFooter = cut >= 0 ? body.slice(0, cut) : body;

  return { query: beforeFooter.trim(), token };
}

/**
 * Heuristic-only spam shape check, used purely to decide whether a failed reply is
 * worth an owner notification -- NEVER to skip lookup or the reply attempt itself.
 * A real query is always a short place name; spam tends to be long, carry a URL, or
 * span multiple lines. This is a noise filter for alerting, not a content filter:
 * every message still gets looked up and replied to exactly as before.
 */

const MAX_LEGIT_LENGTH = 60;
const URL_PATTERN = /https?:\/\/|www\./i;
const HTML_TAG_PATTERN = /<[a-z][\s\S]*>/i;

export function looksLikeSpam(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > MAX_LEGIT_LENGTH) return true;
  if (trimmed.includes('\n')) return true;
  if (URL_PATTERN.test(trimmed)) return true;
  if (HTML_TAG_PATTERN.test(trimmed)) return true;
  return false;
}

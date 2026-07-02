/**
 * The single source of truth for reply/query channels. Three modules used to
 * declare their own hand-synced unions (statusTracking, handleInbound,
 * queryLog); drift between them — or between them and query_log's CHECK
 * constraint in Supabase (migrations 007/008) — was invisible to the compiler.
 * Now it's a type error. Adding a channel: extend Channel here, extend the
 * CHECK constraint in a new migration, done.
 *
 *   'inreach' — reply delivered via Garmin's web form
 *   'email'   — reply delivered via message.reply()
 *   'none'    — no reply path existed for the inbound message
 *   'canary'  — the nightly synthetic email from the GitHub Action; identified
 *               at the adapter layer (worker.ts) so it never pollutes real
 *               paddler telemetry. The channel-agnostic core never sees it.
 */

export type Channel = 'inreach' | 'email' | 'none' | 'canary';

/** Channels a reply is actually delivered (and health-tracked) on. */
export type DeliveryChannel = Exclude<Channel, 'none'>;

/** What the channel-agnostic core can compute — canary is adapter-only. */
export type CoreReplyChannel = Exclude<Channel, 'canary'>;

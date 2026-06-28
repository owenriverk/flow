/**
 * One error type across every gauge data source. The `kind` drives the reply
 * the paddler gets:
 *   not_found    ─▶ "not found — check the id"        (bad/unknown station)
 *   unavailable  ─▶ "try again in a few minutes"      (timeout / 5xx / parse)
 */

export type GaugeErrorKind = 'not_found' | 'unavailable';

export class GaugeError extends Error {
  override name = 'GaugeError';
  constructor(
    readonly kind: GaugeErrorKind,
    message: string,
  ) {
    super(message);
  }
}

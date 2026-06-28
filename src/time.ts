/**
 * Parse an upstream reading timestamp into an instant + its local UTC offset.
 *
 * USGS sends an offset ("...-04:00"); WSC sometimes sends a bare local-looking
 * string with no zone, which `new Date()` would wrongly read as the host's
 * local time. When no zone is present we pin it to UTC so the instant is at
 * least deterministic.
 *
 *   "2026-06-27T16:45:00.000-04:00"  -> offset -240
 *   "2026-06-27T16:45:00Z"           -> offset 0
 *   "2026-06-27T16:45:00"            -> treated as UTC, offset 0
 */

function parseOffsetMinutes(dateTime: string): number {
  if (dateTime.endsWith('Z')) return 0;
  const m = dateTime.match(/([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

export function parseObserved(dateTime: string): { observedAt: Date; offsetMinutes: number } {
  const hasZone = /(Z|[+-]\d{2}:\d{2})$/.test(dateTime);
  const normalized = hasZone ? dateTime : `${dateTime}Z`;
  return { observedAt: new Date(normalized), offsetMinutes: parseOffsetMinutes(normalized) };
}

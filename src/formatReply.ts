/**
 * Render a gauge reading into the terse reply a paddler reads on a tiny
 * satellite-messenger screen. Hard contract: <= 160 chars (InReach truncates
 * past that). The flow value is sacred -- if anything has to be cut to fit, it
 * is the name line, never the number.
 *
 *   Gauley R, Summersville, WV   <- display line  (the only truncatable part)
 *   USGS 03189100                <- site id
 *   2,800 cfs / 4.21 ft          <- flow value    (never cut)
 *   16:45 Jun 27                 <- local reading time
 */

import type { GaugeRef } from './lookupGauge.js';

export type DischargeUnit = 'cfs' | 'cms';
export type StageUnit = 'ft' | 'm';

export interface Reading {
  discharge?: number; // value in dischargeUnit
  stage?: number; // value in stageUnit
  dischargeUnit?: DischargeUnit; // defaults to cfs
  stageUnit?: StageUnit; // defaults to ft
  observedAt: Date; // the instant of the reading
  offsetMinutes: number; // site-local UTC offset, e.g. -240 for EDT
  usgsName?: string; // site name from USGS, used when no curated name exists
}

const MAX_LEN = 160;
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// cfs reads as whole numbers; cms can be small, so allow one decimal.
const dischargeFmt: Record<DischargeUnit, Intl.NumberFormat> = {
  cfs: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }),
  cms: new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }),
};

function flowLine(r: Reading): string {
  const parts: string[] = [];
  if (r.discharge !== undefined) {
    const unit = r.dischargeUnit ?? 'cfs';
    parts.push(`${dischargeFmt[unit].format(r.discharge)} ${unit}`);
  }
  if (r.stage !== undefined) {
    parts.push(`${r.stage.toFixed(2)} ${r.stageUnit ?? 'ft'}`);
  }
  return parts.length > 0 ? parts.join(' / ') : 'no current reading';
}

function timeLine(r: Reading): string {
  const local = new Date(r.observedAt.getTime() + r.offsetMinutes * 60_000);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} ${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}`;
}

function displayName(ref: GaugeRef, r: Reading): string {
  if ('name' in ref) return `${ref.name}, ${ref.location}`;
  return r.usgsName ?? '';
}

export function formatReply(ref: GaugeRef, reading: Reading): string {
  const idLabel = { usgs: 'USGS', wsc: 'WSC', cdec: 'CDEC', dreamflows: 'Dreamflows', noaa: 'NOAA' }[ref.source];
  const fixed = [`${idLabel} ${ref.site}`, flowLine(reading), timeLine(reading)].join('\n');
  const name = displayName(ref, reading);
  if (name === '') return fixed;

  const full = `${name}\n${fixed}`;
  if (full.length <= MAX_LEN) return full;

  // Truncate only the name so the number and time survive intact.
  const room = MAX_LEN - (fixed.length + 1); // +1 for the '\n' after the name
  const cutName = name.slice(0, Math.max(0, room)).trimEnd();
  return cutName === '' ? fixed : `${cutName}\n${fixed}`;
}

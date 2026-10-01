import { describe, expect, test } from 'vitest';
import { formatReply, replySafe, type Reading } from '../src/formatReply.js';
import type { GaugeAlias, GaugeRef } from '../src/lookupGauge.js';
import aliasesJson from '../src/aliases.json' with { type: 'json' };

// 2026-06-27T16:45 local at UTC-4 (EDT)
const observedAt = new Date('2026-06-27T20:45:00Z');
const offsetMinutes = -240;

describe('formatReply', () => {
  test('formats a curated USGS gauge with both discharge and stage', () => {
    const ref: GaugeRef = {
      site: '03189100', source: 'usgs', name: 'Gauley R', location: 'Summersville, WV',
    };
    const reading: Reading = { discharge: 2800, stage: 4.21, observedAt, offsetMinutes };
    expect(formatReply(ref, reading)).toBe(
      'Gauley R, Summersville, WV\nUSGS 03189100\n2,800 cfs / 4.21 ft\n16:45 Jun 27',
    );
  });

  test('labels a WSC station with WSC, not USGS', () => {
    const ref: GaugeRef = {
      site: '08CE001', source: 'wsc', name: 'Stikine R', location: 'Telegraph Creek, BC',
    };
    const reading: Reading = { discharge: 12000, stage: 6.5, observedAt, offsetMinutes };
    expect(formatReply(ref, reading)).toContain('WSC 08CE001');
    expect(formatReply(ref, reading)).not.toContain('USGS');
  });

  test('renders native metric units (cms / m) for a Canadian reading', () => {
    const ref: GaugeRef = {
      site: '08CE001', source: 'wsc', name: 'Stikine R', location: 'Telegraph Creek, BC',
    };
    const reading: Reading = {
      discharge: 1590, stage: 4.99, dischargeUnit: 'cms', stageUnit: 'm', observedAt, offsetMinutes,
    };
    expect(formatReply(ref, reading)).toContain('1,590 cms / 4.99 m');
  });

  test('shows cms to one decimal for low metric flows', () => {
    const ref: GaugeRef = { site: '08CH001', source: 'wsc', name: 'Chilko R', location: 'Redstone, BC' };
    const reading: Reading = { discharge: 56.2, dischargeUnit: 'cms', observedAt, offsetMinutes };
    expect(formatReply(ref, reading)).toContain('56.2 cms');
  });

  test('falls back to the upstream site name for a raw id lookup', () => {
    const ref: GaugeRef = { site: '03451500', source: 'usgs' };
    const reading: Reading = {
      discharge: 1450, stage: 3.1, observedAt, offsetMinutes,
      usgsName: 'GREEN RIVER NEAR TUXEDO, NC',
    };
    expect(formatReply(ref, reading)).toBe(
      'GREEN RIVER NEAR TUXEDO, NC\nUSGS 03451500\n1,450 cfs / 3.10 ft\n16:45 Jun 27',
    );
  });

  test('omits stage when only discharge is present', () => {
    const ref: GaugeRef = {
      site: '03189100', source: 'usgs', name: 'Gauley R', location: 'Summersville, WV',
    };
    const reading: Reading = { discharge: 2800, observedAt, offsetMinutes };
    expect(formatReply(ref, reading)).toContain('2,800 cfs');
    expect(formatReply(ref, reading)).not.toContain('ft');
  });

  test('shows stage only when there is no discharge sensor', () => {
    const ref: GaugeRef = {
      site: '01646500', source: 'usgs', name: 'Potomac R', location: 'Little Falls, MD',
    };
    const reading: Reading = { stage: 2.95, observedAt, offsetMinutes };
    const out = formatReply(ref, reading);
    expect(out).toContain('2.95 ft');
    expect(out).not.toContain('cfs');
  });

  test('states no current reading when both values are missing', () => {
    const ref: GaugeRef = {
      site: '03189100', source: 'usgs', name: 'Gauley R', location: 'Summersville, WV',
    };
    const reading: Reading = { observedAt, offsetMinutes };
    expect(formatReply(ref, reading)).toContain('no current reading');
  });

  test('offline replies warn about stale data with an hour-scale age', () => {
    const ref: GaugeRef = {
      site: '54', source: 'dreamflows', name: 'Feather / Middle Fork — Bald Rock', location: 'At Milsap Bar, CA',
    };
    const reading: Reading = {
      discharge: 480,
      observedAt: new Date(Date.now() - 3 * 3_600_000),
      offsetMinutes: 0,
    };
    const out = formatReply(ref, reading, { offline: true });
    expect(out).toContain('no fresh data; cached 3 hr ago');
    expect(out.length).toBeLessThanOrEqual(160);
  });

  test('offline ages past 48 hours read in days, not hours', () => {
    const ref: GaugeRef = {
      site: '111', source: 'dreamflows', name: 'Mokelumne / North Fork — Fantasy Falls', location: 'Above Salt Springs, CA',
    };
    const reading: Reading = {
      discharge: 480,
      observedAt: new Date(Date.now() - 14 * 24 * 3_600_000),
      offsetMinutes: 0,
    };
    const out = formatReply(ref, reading, { offline: true });
    expect(out).toContain('no fresh data; cached 14 days ago');
  });

  test('guarantees <=160 chars, truncating the name but never the flow value', () => {
    const ref: GaugeRef = {
      site: '03189100', source: 'usgs',
      name: 'Gauley River Above Below The Very Long Dam Near Somewhere Quite Far',
      location: 'A Ridiculously Over-Described Location, West Virginia, United States',
    };
    const reading: Reading = { discharge: 2800, stage: 4.21, observedAt, offsetMinutes };
    const out = formatReply(ref, reading);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out).toContain('2,800 cfs / 4.21 ft');
    expect(out).toContain('USGS 03189100');
  });
});

describe('reply text stays single-segment SMS', () => {
  test('the website em dash becomes a plain hyphen in the reply', () => {
    const ref: GaugeRef = {
      site: '69', source: 'dreamflows', name: 'American / North Fork — Royal Gorge', location: 'Above Lake Clementine, CA',
    };
    const out = formatReply(ref, { discharge: 480, observedAt, offsetMinutes });
    expect(out.split('\n')[0]).toBe('American / North Fork - Royal Gorge, Above Lake Clementine, CA');
  });

  // One character outside GSM-7 re-encodes the whole SMS as UCS-2 (70-char
  // segments). Guard the whole roster so a future name cannot reintroduce it.
  test('every roster name and location is plain ASCII once reply-safe', () => {
    const aliases = aliasesJson as Record<string, GaugeAlias>;
    const offenders = Object.values(aliases)
      .map((a) => replySafe(`${a.name}, ${a.location}`))
      .filter((line) => /[^\x20-\x7e]/.test(line));
    expect([...new Set(offenders)]).toEqual([]);
  });
});

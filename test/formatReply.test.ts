import { describe, expect, test } from 'vitest';
import { formatReply, type Reading } from '../src/formatReply.js';
import type { GaugeRef } from '../src/lookupGauge.js';

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

import { describe, expect, test } from 'vitest';
import { fetchReading } from '../src/dreamflows.js';
import { GaugeError } from '../src/errors.js';

// realtime.csv zero-pads RiverId to 3 digits — our configs store unpadded ids.
const CSV = [
  'header1', 'header2', 'header3', 'header4', 'header5', 'header6', 'header7',
  '054,"Mi. Feather","At Milsap Bar",2026-07-04,14:00,,,237,cfs',
  '069,"No. American","Inflow Lake Clementine",2026-07-04,13:15,,,117,cfs',
  '100,"Kings","At Rodgers Crossing",2026-07-04,13:00,90,5,655,cfs',
  '665,"Cherry Creek","Above Cherry Lake",2026-07-04,14:00,,,Unkn,cfs',
].join('\n');

const fetchFn = (async () => new Response(CSV, { status: 200 })) as typeof fetch;

describe('dreamflows CSV id matching', () => {
  test('unpadded config id matches a zero-padded CSV row (the Royal Gorge/Bald Rock bug)', async () => {
    const r = await fetchReading('54', { fetchFn });
    expect(r.discharge).toBe(237);
    const r2 = await fetchReading('69', { fetchFn });
    expect(r2.discharge).toBe(117);
  });

  test('3-digit ids still match exactly', async () => {
    const r = await fetchReading('100', { fetchFn });
    expect(r.discharge).toBe(655);
  });

  test('a row with a non-numeric flow value is unavailable, not not_found', async () => {
    await expect(fetchReading('665', { fetchFn })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  test('a missing row is not_found', async () => {
    const err = await fetchReading('999', { fetchFn }).catch((e) => e);
    expect(err).toBeInstanceOf(GaugeError);
    expect(err.kind).toBe('not_found');
  });
});

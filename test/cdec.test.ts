import { describe, expect, test, vi } from 'vitest';
import { fetchReading, CdecError } from '../src/cdec.js';

interface Rec {
  value: number;
  units: string;
  obsDate?: string;
}
function rec(value: number, units = 'CFS', obsDate = '2026-6-27 23:00'): Rec {
  return { value, units, obsDate };
}
function okFetch(records: Rec[]) {
  return vi.fn(async () => new Response(JSON.stringify(records), { status: 200 }));
}

describe('cdec.fetchReading', () => {
  test('reads the latest CFS value as discharge, parsing the Pacific timestamp', async () => {
    const fetchFn = okFetch([rec(1200, 'CFS', '2026-6-27 22:00'), rec(1180, 'CFS', '2026-6-27 23:00')]);
    const r = await fetchReading('FRK', { fetchFn });
    expect(r.discharge).toBe(1180);
    expect(r.stage).toBeUndefined();
    expect(r.offsetMinutes).toBe(-480); // CDEC is PST year-round
    expect(r.observedAt.toISOString()).toBe('2026-06-28T07:00:00.000Z'); // 23:00 PST
  });

  test('skips the -9999 missing sentinel and uses the last real value', async () => {
    const fetchFn = okFetch([rec(1180, 'CFS', '2026-6-27 22:00'), rec(-9999, 'CFS', '2026-6-27 23:00')]);
    const r = await fetchReading('FRK', { fetchFn });
    expect(r.discharge).toBe(1180);
  });

  test('maps a FEET sensor to stage, not discharge', async () => {
    const fetchFn = okFetch([rec(3.42, 'FEET', '2026-6-27 23:00')]);
    const r = await fetchReading('XYZ', { fetchFn, sensor: 1 });
    expect(r.stage).toBe(3.42);
    expect(r.discharge).toBeUndefined();
  });

  test('throws not_found when the station returns no records', async () => {
    const fetchFn = okFetch([]);
    await expect(fetchReading('ZZZ', { fetchFn })).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('throws unavailable when every value is the missing sentinel', async () => {
    const fetchFn = okFetch([rec(-9999), rec(-9999)]);
    await expect(fetchReading('FRK', { fetchFn })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  test('throws unavailable on HTTP 503', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 503 }));
    await expect(fetchReading('FRK', { fetchFn })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  test('throws unavailable (CdecError) on non-JSON', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(fetchReading('FRK', { fetchFn })).rejects.toBeInstanceOf(CdecError);
  });

  test('aborts and throws unavailable on timeout', async () => {
    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_res, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    await expect(fetchReading('FRK', { fetchFn, timeoutMs: 20 })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});

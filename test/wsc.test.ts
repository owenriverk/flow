import { describe, expect, test, vi } from 'vitest';
import { fetchReading, WscError } from '../src/wsc.js';

/** Build a minimal MSC GeoMet hydrometric-realtime FeatureCollection. */
function features(props: Record<string, unknown> | null) {
  return {
    type: 'FeatureCollection',
    features: props === null ? [] : [{ type: 'Feature', properties: props }],
  };
}

function okFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

describe('wsc.fetchReading', () => {
  test('reports native metric units (cms / m), no conversion, with name and time', async () => {
    const fetchFn = okFetch(
      features({
        STATION_NUMBER: '08CE001',
        STATION_NAME: 'STIKINE RIVER AT TELEGRAPH CREEK',
        DISCHARGE: 100,
        LEVEL: 1.98,
        DATETIME: '2026-06-27T16:45:00Z',
      }),
    );
    const r = await fetchReading('08CE001', { fetchFn });
    expect(r.discharge).toBe(100);
    expect(r.dischargeUnit).toBe('cms');
    expect(r.stage).toBe(1.98);
    expect(r.stageUnit).toBe('m');
    expect(r.usgsName).toBe('STIKINE RIVER AT TELEGRAPH CREEK');
    expect(r.observedAt.toISOString()).toBe('2026-06-27T16:45:00.000Z');
    expect(r.offsetMinutes).toBe(0);
  });

  test('handles a discharge-only station', async () => {
    const fetchFn = okFetch(
      features({ DISCHARGE: 50, LEVEL: null, DATETIME: '2026-06-27T16:45:00Z' }),
    );
    const r = await fetchReading('10EB001', { fetchFn });
    expect(r.discharge).toBe(50);
    expect(r.dischargeUnit).toBe('cms');
    expect(r.stage).toBeUndefined();
  });

  test('handles a level-only station', async () => {
    const fetchFn = okFetch(
      features({ DISCHARGE: null, LEVEL: 3.0, DATETIME: '2026-06-27T16:45:00Z' }),
    );
    const r = await fetchReading('08EE001', { fetchFn });
    expect(r.discharge).toBeUndefined();
    expect(r.stage).toBe(3.0);
    expect(r.stageUnit).toBe('m');
  });

  test('prefers DATETIME_LST (local time with offset) over the UTC DATETIME', async () => {
    const fetchFn = okFetch(
      features({
        DISCHARGE: 100,
        DATETIME: '2026-06-28T01:40:00Z',
        DATETIME_LST: '2026-06-27T17:40:00-08:00',
      }),
    );
    const r = await fetchReading('08CE001', { fetchFn });
    expect(r.offsetMinutes).toBe(-480); // shows local river time, not UTC
    expect(r.observedAt.toISOString()).toBe('2026-06-28T01:40:00.000Z'); // same instant
  });

  test('treats a zone-less datetime as UTC rather than host-local', async () => {
    const fetchFn = okFetch(
      features({ DISCHARGE: 10, DATETIME: '2026-06-27T16:45:00' }),
    );
    const r = await fetchReading('08CH001', { fetchFn });
    expect(r.observedAt.toISOString()).toBe('2026-06-27T16:45:00.000Z');
  });

  test('throws not_found when the station has no data (empty features)', async () => {
    const fetchFn = okFetch(features(null));
    await expect(fetchReading('99XX999', { fetchFn })).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  test('throws unavailable on HTTP 503', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 503 }));
    await expect(fetchReading('08CE001', { fetchFn })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  test('throws unavailable (WscError) on malformed JSON', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(fetchReading('08CE001', { fetchFn })).rejects.toBeInstanceOf(WscError);
  });

  test('aborts and throws unavailable when WSC exceeds the timeout', async () => {
    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    await expect(fetchReading('08CE001', { fetchFn, timeoutMs: 20 })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});

import { describe, expect, test, vi } from 'vitest';
import { fetchReading, UsgsError } from '../src/usgs.js';

/** Build a minimal USGS IV JSON payload with the requested series. */
function payload(series: Array<{ code: string; value: string; dateTime?: string }>) {
  return {
    value: {
      timeSeries: series.map((s) => ({
        sourceInfo: { siteName: 'GAULEY RIVER NEAR SUMMERSVILLE, WV' },
        variable: { variableCode: [{ value: s.code }], noDataValue: -999999 },
        values: [
          {
            value: [{ value: s.value, dateTime: s.dateTime ?? '2026-06-27T16:45:00.000-04:00' }],
          },
        ],
      })),
    },
  };
}

function okFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

describe('fetchReading', () => {
  test('parses discharge, stage, site name and local time/offset', async () => {
    const fetchFn = okFetch(payload([
      { code: '00060', value: '2800' },
      { code: '00065', value: '4.21' },
    ]));
    const r = await fetchReading('03189100', { fetchFn });
    expect(r.discharge).toBe(2800);
    expect(r.stage).toBe(4.21);
    expect(r.usgsName).toBe('GAULEY RIVER NEAR SUMMERSVILLE, WV');
    expect(r.offsetMinutes).toBe(-240);
    expect(r.observedAt.toISOString()).toBe('2026-06-27T20:45:00.000Z');
  });

  test('handles a stage-only gauge (no discharge sensor)', async () => {
    const fetchFn = okFetch(payload([{ code: '00065', value: '2.95' }]));
    const r = await fetchReading('01646500', { fetchFn });
    expect(r.discharge).toBeUndefined();
    expect(r.stage).toBe(2.95);
  });

  test('treats the USGS no-data sentinel (-999999) as missing', async () => {
    const fetchFn = okFetch(payload([
      { code: '00060', value: '-999999' },
      { code: '00065', value: '4.21' },
    ]));
    const r = await fetchReading('03189100', { fetchFn });
    expect(r.discharge).toBeUndefined();
    expect(r.stage).toBe(4.21);
  });

  test('throws a not_found error on HTTP 400 (bad/unknown site id)', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 400 }));
    await expect(fetchReading('99999999', { fetchFn })).rejects.toMatchObject({
      name: 'UsgsError',
      kind: 'not_found',
    });
  });

  test('throws an unavailable error on HTTP 503 (USGS down)', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 503 }));
    await expect(fetchReading('03189100', { fetchFn })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  test('throws an unavailable error on malformed JSON', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>not json</html>', { status: 200 }));
    await expect(fetchReading('03189100', { fetchFn })).rejects.toBeInstanceOf(UsgsError);
  });

  test('aborts and throws unavailable when USGS exceeds the timeout', async () => {
    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    await expect(
      fetchReading('03189100', { fetchFn, timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

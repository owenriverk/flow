import { describe, expect, test, vi } from 'vitest';
import { fetchReading, EnvdataError } from '../src/envdata.js';

function okFetch(body: unknown) {
  return vi.fn(async (..._args: Parameters<typeof fetch>) =>
    new Response(JSON.stringify(body), { status: 200 }),
  );
}

function withFlowSeries(name: string, series: Array<[number, number]> | null) {
  return {
    name,
    dataStart: '2026-06-26T00:00:00+12:00',
    dataEnd: '2026-07-03T16:00:00+12:00',
    data: [{ measurement: 'Flow', units: series ? 'm3/sec' : null, latestValue: null, data: series }],
  };
}

describe('envdata.fetchReading', () => {
  test('reports native cms from the last point in the series, with site name', async () => {
    const fetchFn = okFetch(
      withFlowSeries('Wairaurahiri at Lake Hauroko', [
        [1783080000000, 54.6],
        [1783087200000, 45.005],
      ]),
    );
    const r = await fetchReading('Wairaurahiri at Lake Hauroko', { fetchFn });
    expect(r.discharge).toBe(45.005);
    expect(r.dischargeUnit).toBe('cms');
    expect(r.usgsName).toBe('Wairaurahiri at Lake Hauroko');
    expect(r.observedAt.toISOString()).toBe('2026-07-03T14:00:00.000Z');
    expect(r.offsetMinutes).toBe(720); // NZST +12:00
  });

  test('sends the site name, "Flow" measurement, and a 7-day interval', async () => {
    const fetchFn = okFetch(withFlowSeries('Wairaurahiri at Lake Hauroko', [[1783087200000, 45]]));
    await fetchReading('Wairaurahiri at Lake Hauroko', { fetchFn });
    const calledUrl = String(fetchFn.mock.calls[0]![0]);
    expect(calledUrl).toContain('s=Wairaurahiri%20at%20Lake%20Hauroko');
    expect(calledUrl).toContain('m=Flow');
    expect(calledUrl).toContain('i=7');
  });

  test('throws unavailable when the site name is unknown (data: null, still HTTP 200)', async () => {
    const fetchFn = okFetch(withFlowSeries('Nonexistent River XYZ', null));
    await expect(fetchReading('Nonexistent River XYZ', { fetchFn })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  test('throws unavailable on an empty series', async () => {
    const fetchFn = okFetch(withFlowSeries('Some Site', []));
    await expect(fetchReading('Some Site', { fetchFn })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  test('throws unavailable on HTTP 503', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 503 }));
    await expect(fetchReading('Wairaurahiri at Lake Hauroko', { fetchFn })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  test('throws unavailable (EnvdataError) on malformed JSON', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(fetchReading('Wairaurahiri at Lake Hauroko', { fetchFn })).rejects.toBeInstanceOf(
      EnvdataError,
    );
  });

  test('aborts and throws unavailable when envdata exceeds the timeout', async () => {
    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    await expect(
      fetchReading('Wairaurahiri at Lake Hauroko', { fetchFn, timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

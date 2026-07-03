import { describe, expect, test, vi } from 'vitest';
import { fetchReading, FlowrateError } from '../src/flowrate.js';

function okFetch(body: unknown) {
  return vi.fn(async (..._args: Parameters<typeof fetch>) =>
    new Response(JSON.stringify(body), { status: 200 }),
  );
}

describe('flowrate.fetchReading', () => {
  test('reports native cms, treating the bare timestamp as NZST (+12:00)', async () => {
    const fetchFn = okFetch({
      id: '32987309',
      river_id: '47',
      station_id: '61',
      timestamp: '2026-07-03 14:15:00',
      value: 93.5,
      timestamp_readable: '2:15pm 3 Jul',
      age_hours: 2,
    });
    const r = await fetchReading('61', { fetchFn });
    expect(r.discharge).toBe(93.5);
    expect(r.dischargeUnit).toBe('cms');
    expect(r.offsetMinutes).toBe(720); // NZST +12:00
    expect(r.observedAt.toISOString()).toBe('2026-07-03T02:15:00.000Z');
  });

  test('requests the given station id', async () => {
    const fetchFn = okFetch({ timestamp: '2026-07-03 14:15:00', value: 1 });
    await fetchReading('61', { fetchFn });
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      'https://flowrate.co.nz/station/61/json/flow/current',
    );
  });

  test('throws not_found for an unknown station id (JSON literal false, HTTP 200)', async () => {
    const fetchFn = okFetch(false);
    await expect(fetchReading('999999', { fetchFn })).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('throws unavailable on HTTP 503', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 503 }));
    await expect(fetchReading('61', { fetchFn })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  test('throws unavailable (FlowrateError) on malformed JSON', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(fetchReading('61', { fetchFn })).rejects.toBeInstanceOf(FlowrateError);
  });

  test('aborts and throws unavailable when flowrate exceeds the timeout', async () => {
    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    await expect(fetchReading('61', { fetchFn, timeoutMs: 20 })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});

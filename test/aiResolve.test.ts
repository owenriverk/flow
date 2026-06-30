import { describe, expect, test, vi } from 'vitest';
import { aiResolve } from '../src/aiResolve.js';
import type { GaugeAlias } from '../src/lookupGauge.js';

const aliases: Record<string, GaugeAlias> = {
  'main salmon': { site: '13317000', name: 'Salmon R', location: 'White Bird, ID' },
  'green river ut': { site: '09315000', name: 'Green R', location: 'Green River, UT' },
  'middle kings': { site: 'KBC', name: 'SF Kings R', location: 'Boyden Cavern, CA', source: 'cdec', sensor: 20, dur: 'E' },
};

const ai = (response: string) => ({
  run: vi.fn((_model: string, _input: unknown) => Promise.resolve({ response })),
});

describe('aiResolve', () => {
  test('returns the run key the model picks', async () => {
    expect(await aiResolve('river of no return', aliases, ai('main salmon'))).toBe('main salmon');
  });

  test('normalizes a reply with quotes / whitespace / case', async () => {
    expect(await aiResolve('deso', aliases, ai('  "Green River UT" '))).toBe('green river ut');
  });

  test('handles the model echoing "key — label" by taking the key', async () => {
    expect(await aiResolve('kings', aliases, ai('middle kings — SF Kings R, Boyden Cavern, CA'))).toBe('middle kings');
  });

  test('returns null when the model says NONE', async () => {
    expect(await aiResolve('pizza delivery', aliases, ai('NONE'))).toBeNull();
  });

  test('rejects a hallucinated key not in the list (safety guard)', async () => {
    expect(await aiResolve('x', aliases, ai('gauley summersville'))).toBeNull();
  });

  test('never throws — returns null if the model call errors', async () => {
    const broken = { run: vi.fn(async () => { throw new Error('AI unavailable'); }) };
    expect(await aiResolve('main salmon', aliases, broken)).toBeNull();
  });

  test('gives the model the candidate run names', async () => {
    const a = ai('main salmon');
    await aiResolve('salmon', aliases, a);
    const content = JSON.stringify(a.run.mock.calls[0]![1]);
    expect(content).toContain('main salmon');
    expect(content).toContain('middle kings');
  });
});

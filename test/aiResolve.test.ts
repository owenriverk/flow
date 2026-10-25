import { describe, expect, test, vi } from 'vitest';
import { aiResolve, parseAiReply, plausibleMatch } from '../src/aiResolve.js';
import type { GaugeAlias } from '../src/lookupGauge.js';

const aliases: Record<string, GaugeAlias> = {
  'main salmon': { site: '13317000', name: 'Salmon R', location: 'White Bird, ID' },
  'green river ut': { site: '09315000', name: 'Green R', location: 'Green River, UT' },
  'middle kings': { site: 'KBC', name: 'SF Kings R', location: 'Boyden Cavern, CA', source: 'cdec', sensor: 20, dur: 'E' },
  'ruby horsethief': { site: '09163500', name: 'Colorado / Ruby–Horsethief', location: 'Near CO-UT State Line' },
  'gc stikine': { site: '08CE001', name: 'Stikine / Grand Canyon', location: 'At Telegraph Creek, BC', source: 'wsc' },
  'royal gorge': { site: '69', name: 'American / North Fork — Royal Gorge', location: 'Above Lake Clementine, CA', source: 'dreamflows' },
};

const ai = (response: string) => ({
  run: vi.fn((_model: string, _input: unknown) => Promise.resolve({ response })),
});

describe('aiResolve', () => {
  test('returns the run key the model picks', async () => {
    expect(await aiResolve('mian salmon', aliases, ai('main salmon'))).toBe('main salmon');
  });

  test('normalizes a reply with quotes / whitespace / case', async () => {
    expect(await aiResolve('green rivr', aliases, ai('  "Green River UT" '))).toBe('green river ut');
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

  // 2026-10-24, real SMS: "RIODELCO" (CDWR code for the Rio Grande near Del
  // Norte, not on the roster) came back as Ruby-Horsethief. Whatever the model
  // says, a pick that shares no word with the message is refused.
  test('refuses a wrong-river pick that shares no word with the message', async () => {
    expect(await aiResolve('RIODELCO', aliases, ai('ruby horsethief'))).toBeNull();
  });

  test('refuses a pick whose only overlap is a generic word', async () => {
    expect(await aiResolve('gore canyon', aliases, ai('royal gorge'))).toBeNull();
  });

  test('keeps a typo with a swapped letter pair', async () => {
    expect(await aiResolve('stikeen', aliases, ai('gc stikine'))).toBe('gc stikine');
  });

  test('reads only the first line when the model keeps generating', async () => {
    const rambling = 'main salmon\n\nMessage: "the middle fork of the salmon"\nRun key:';
    expect(await aiResolve('mian salmon', aliases, ai(rambling))).toBe('main salmon');
  });
});

describe('parseAiReply', () => {
  const keys = Object.keys(aliases);
  test.each([
    ['main salmon', 'main salmon'],
    ['Main Salmon\nMessage: more', 'main salmon'],
    ['NONE', null],
    ['', null],
  ])('%j -> %j', (reply, key) => {
    expect(parseAiReply(reply, keys)).toBe(key);
  });
});

describe('plausibleMatch', () => {
  test.each([
    ['stikeen', 'gc stikine', true], // swapped pair + substitution, 7 letters
    ['ruby horse thief flows', 'ruby horsethief', true],
    ['kings?', 'middle kings', true],
    ['RIODELCO', 'ruby horsethief', false],
    ['gore canyon', 'royal gorge', false],
    ['river canyon flows', 'gc stikine', false], // generic words only
    ['salmn', 'main salmon', true], // 5 letters, one deletion
    ['sal', 'main salmon', false], // too short for any typo budget
  ])('%j vs %j -> %s', (text, key, ok) => {
    expect(plausibleMatch(text, key, aliases)).toBe(ok);
  });
});

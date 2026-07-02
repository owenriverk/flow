import { describe, expect, test } from 'vitest';
import { looksLikeSpam } from '../src/spamFilter.js';

describe('looksLikeSpam', () => {
  test.each([
    'mf salmon',
    'grand canyon',
    'stikine',
    'middle fork of the salmon',
    '13317000',
  ])('does not flag a real-looking query: %s', (text) => {
    expect(looksLikeSpam(text)).toBe(false);
  });

  test('flags text over the length cap', () => {
    expect(looksLikeSpam('a'.repeat(61))).toBe(true);
    expect(looksLikeSpam('a'.repeat(60))).toBe(false);
  });

  test('flags a URL', () => {
    expect(looksLikeSpam('check this out https://example.com/promo')).toBe(true);
    expect(looksLikeSpam('visit www.example.com now')).toBe(true);
  });

  test('flags HTML content', () => {
    expect(looksLikeSpam('<a href="x">click here</a>')).toBe(true);
  });

  test('flags multi-line text', () => {
    expect(looksLikeSpam('line one\nline two')).toBe(true);
  });
});

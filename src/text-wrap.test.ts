import { describe, expect, it } from 'vitest';
import { normalizeTextLineBreaks, wrapText } from './text-wrap';

describe('text frame wrapping', () => {
  const measure = (text: string) => [...new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(text)].length;
  it('normalizes pasted line separators and preserves explicit empty lines', () => {
    expect(normalizeTextLineBreaks('A\r\nB\rC\u2028D\u2029')).toBe('A\nB\nC\nD\n');
    expect(wrapText('A\n\nB\n', 10, measure)).toBe('A\n\nB\n');
  });
  it('wraps at spaces and breaks long words without splitting graphemes', () => {
    expect(wrapText('ONE TWO THREE', 7, measure)).toBe('ONE TWO\nTHREE');
    expect(wrapText('ABCDE', 2, measure)).toBe('AB\nCD\nE');
    expect(wrapText('a\u0301b👩‍💻c', 2, measure)).toBe('a\u0301b\n👩‍💻c');
    expect(wrapText('A', .1, measure)).toBe('A');
    expect(wrapText('A\u00a0B', 10, measure)).toBe('A\u00a0B');
  });
});

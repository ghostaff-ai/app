import { describe, expect, it } from 'vitest';
import { normalizeLink, splitLinks } from '../src/services';

describe('links typed by a new organisation', () => {
  it('adds https:// to a bare domain and keeps a full URL', () => {
    expect(normalizeLink(' ana.example ')).toBe('https://ana.example');
    expect(normalizeLink('http://ana.example/x')).toBe('http://ana.example/x');
    expect(normalizeLink('   ')).toBe('');
  });

  it('splits on lines, spaces and commas', () => {
    expect(splitLinks('instagram.com/ana\n https://x.com/ana, drive.google.com/x  ')).toEqual([
      'https://instagram.com/ana',
      'https://x.com/ana',
      'https://drive.google.com/x',
    ]);
    expect(splitLinks('')).toEqual([]);
  });
});

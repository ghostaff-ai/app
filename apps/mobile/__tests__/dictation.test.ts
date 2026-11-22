import { appendDictation } from '@/lib/chat';

describe('appendDictation', () => {
  it('puts the transcript after what is written, with a space', () => {
    expect(appendDictation('Hola', 'qué tal')).toBe('Hola qué tal');
  });
  it('adds no second space or line break after trailing whitespace', () => {
    expect(appendDictation('Hola ', 'qué tal')).toBe('Hola qué tal');
    expect(appendDictation('Hola\n', 'qué tal')).toBe('Hola\nqué tal');
  });
  it('is just the transcript in an empty box', () => {
    expect(appendDictation('', 'qué tal')).toBe('qué tal');
    expect(appendDictation('  ', 'qué tal')).toBe('qué tal');
  });
});

import { COLOR_NAMES, DARK, LIGHT } from '../lib/palette';

// Light and dark are the same names with different values, so every Tailwind
// class works in both (tailwind.config.ts reads COLOR_NAMES).
describe('palette', () => {
  it('names the same colours in light and dark', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });

  it('gives Tailwind kebab-case names', () => {
    expect(COLOR_NAMES).toContain('on-accent');
    expect(COLOR_NAMES).toContain('surface');
  });
});

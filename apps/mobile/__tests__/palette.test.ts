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

  it('has the chat colours of chat-look.md', () => {
    expect(COLOR_NAMES).toEqual(
      expect.arrayContaining([
        'chat',
        'chat-pattern',
        'mine',
        'mine-muted',
        'mine-sunk',
        'theirs',
        'chat-accent',
        'on-chat-accent',
        'read',
        'chip',
      ]),
    );
    expect(LIGHT.mine).toBe('#E4DFFB');
    expect(DARK.mine).toBe('#352F63');
    expect(LIGHT.chatAccent).toBe('#4B3FC7');
    expect(DARK.chatAccent).toBe('#8F84FF');
  });
});

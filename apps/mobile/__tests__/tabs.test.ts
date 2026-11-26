import { TAB_SCREEN_TOP, tabBarSpace, tabScreenTop } from '@/lib/tabs';

// Measured on an iPhone SE (iOS 26) inside a tab: the status bar, and the floating tab bar.
const insets = { top: 20, bottom: 83 };

describe('tabBarSpace', () => {
  it('is the bottom inset NativeTabs measures on iOS: the floating bar and the home indicator', () => {
    expect(tabBarSpace('ios', false, insets)).toBe(83);
  });

  it('is nothing where the system already keeps the screen clear, or there is no bar below', () => {
    expect(tabBarSpace('android', false, insets)).toBe(0);
    expect(tabBarSpace('web', false, insets)).toBe(0);
    expect(tabBarSpace('web', true, insets)).toBe(0);
  });
});

describe('tabScreenTop', () => {
  it('leaves iOS scroll views to the system, but clears the status bar for a screen that does not scroll', () => {
    expect(tabScreenTop('ios', false, insets, true)).toBe(0);
    expect(tabScreenTop('ios', false, insets, false)).toBe(20);
  });

  it('always clears the status bar on Android', () => {
    expect(tabScreenTop('android', false, insets, true)).toBe(20);
    expect(tabScreenTop('android', false, insets, false)).toBe(20);
  });

  it('leaves room for the floating bar at the top of a narrow web page, and a fixed margin on a desktop', () => {
    expect(tabScreenTop('web', false, { top: 0, bottom: 0 }, false)).toBe(TAB_SCREEN_TOP);
    expect(tabScreenTop('web', true, insets, false)).toBe(24);
  });
});

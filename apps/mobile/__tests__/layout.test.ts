import { DESKTOP_MIN_WIDTH, isDesktopWidth } from '@/lib/layout';

describe('isDesktopWidth', () => {
  it('is a desktop only on the web, from the breakpoint up', () => {
    expect(isDesktopWidth('web', DESKTOP_MIN_WIDTH)).toBe(true);
    expect(isDesktopWidth('web', 1440)).toBe(true);
    expect(isDesktopWidth('web', DESKTOP_MIN_WIDTH - 1)).toBe(false);
  });

  it('keeps the phone layout on native, however wide (a tablet in landscape)', () => {
    expect(isDesktopWidth('ios', 1366)).toBe(false);
    expect(isDesktopWidth('android', 1280)).toBe(false);
  });
});

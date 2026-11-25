// When the chat may offer to turn notifications on (decision-notifications.md, part 2):
// only while the phone hasn't been asked, at most three times, a week apart.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadAskState, saveDecline, shouldAsk, type AskState } from '@/lib/push/softAsk';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-03-20T10:00:00Z');
const never: AskState = { declines: 0, lastDeclinedAt: null };
const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

describe('shouldAsk', () => {
  it.each(['granted', 'denied', 'unsupported'] as const)('is false when the permission is %s', (p) => {
    expect(shouldAsk(p, never, now)).toBe(false);
  });

  it('is true when undetermined with no declines', () => {
    expect(shouldAsk('undetermined', never, now)).toBe(true);
  });

  it('waits a week after a decline', () => {
    expect(shouldAsk('undetermined', { declines: 1, lastDeclinedAt: ago(6) }, now)).toBe(false);
    expect(shouldAsk('undetermined', { declines: 1, lastDeclinedAt: ago(7) }, now)).toBe(true);
  });

  it('stops after the third decline', () => {
    expect(shouldAsk('undetermined', { declines: 3, lastDeclinedAt: ago(30) }, now)).toBe(false);
    expect(shouldAsk('undetermined', { declines: 2, lastDeclinedAt: ago(30) }, now)).toBe(true);
  });
});

describe('the stored state', () => {
  beforeEach(() => AsyncStorage.clear());

  it('starts empty', async () => {
    expect(await loadAskState()).toEqual(never);
  });

  it('counts each decline and remembers when', async () => {
    await saveDecline(new Date(ago(10)));
    await saveDecline(now);
    expect(await loadAskState()).toEqual({ declines: 2, lastDeclinedAt: now.toISOString() });
  });

  it('starts over from something unreadable', async () => {
    await AsyncStorage.setItem('ghostaff.pushAsk', '{"declines":"many"}');
    expect(await loadAskState()).toEqual(never);
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Permission } from './pushClient';

// When the chat may offer to turn notifications on. The phone's own dialog is
// shown once per install (iOS) and a "no" there is only undone in Ajustes, so
// the chat asks first, in its own words, and only a "yes" there reaches it. A
// "no" is remembered on the phone: three at most, a week apart.

export interface AskState {
  declines: number;
  /** ISO time of the last «Ahora no». */
  lastDeclinedAt: string | null;
}

const KEY = 'ghostaff.pushAsk';
const MAX_DECLINES = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY: AskState = { declines: 0, lastDeclinedAt: null };

export function shouldAsk(permission: Permission, state: AskState, now: Date): boolean {
  // Granted: nothing to ask. Denied: the phone won't show its dialog again, so
  // asking would promise something we can't deliver. Unsupported: the web.
  if (permission !== 'undetermined') return false;
  if (state.declines >= MAX_DECLINES) return false;
  if (state.lastDeclinedAt !== null && now.getTime() - Date.parse(state.lastDeclinedAt) < WEEK_MS) return false;
  return true;
}

export async function loadAskState(): Promise<AskState> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null');
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'declines' in parsed &&
      typeof parsed.declines === 'number' &&
      'lastDeclinedAt' in parsed &&
      (parsed.lastDeclinedAt === null || typeof parsed.lastDeclinedAt === 'string')
    ) {
      return { declines: parsed.declines, lastDeclinedAt: parsed.lastDeclinedAt };
    }
  } catch {
    // Unreadable: start over.
  }
  return EMPTY;
}

export async function saveDecline(now: Date): Promise<void> {
  const { declines } = await loadAskState();
  await AsyncStorage.setItem(KEY, JSON.stringify({ declines: declines + 1, lastDeclinedAt: now.toISOString() } satisfies AskState)).catch(() => {});
}

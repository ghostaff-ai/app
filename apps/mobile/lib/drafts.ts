import AsyncStorage from '@react-native-async-storage/async-storage';

// What a person typed in a chat and didn't send, kept for when they come back,
// as in WhatsApp: in memory for this session, so it is there at once, and on
// the phone (the browser's storage on the web), so it survives closing the app.
// One per person, organisation and chat (draftKey).

const PREFIX = 'ghostaff.draft.';
/** Writes to the phone wait this long after the last keystroke. */
const WRITE_AFTER_MS = 400;

const memory = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** The key of one chat's draft for one person in one organisation. */
export const draftKey = (userId: string, orgId: string, chat: string) => `${userId}:${orgId}:${chat}`;

/** The draft already read this session, at once; undefined when it hasn't been read yet. */
export function peekDraft(key: string): string | undefined {
  return memory.get(key);
}

/** The draft, from memory or the phone; '' when there is none or it can't be read. */
export async function loadDraft(key: string): Promise<string> {
  const known = memory.get(key);
  if (known !== undefined) return known;
  try {
    const stored = (await AsyncStorage.getItem(PREFIX + key)) ?? '';
    // Typed meanwhile: that wins.
    if (!memory.has(key)) memory.set(key, stored);
    return memory.get(key) ?? stored;
  } catch {
    return '';
  }
}

/** Keeps the draft; an empty or blank one is forgotten. */
export function saveDraft(key: string, text: string): void {
  const value = text.trim() ? text : '';
  memory.set(key, value);
  const pending = timers.get(key);
  if (pending) clearTimeout(pending);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const write = value ? AsyncStorage.setItem(PREFIX + key, value) : AsyncStorage.removeItem(PREFIX + key);
      write.catch(() => {});
    }, WRITE_AFTER_MS),
  );
}

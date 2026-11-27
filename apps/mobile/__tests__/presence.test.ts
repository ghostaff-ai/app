import type { ChatMessage } from '@ghostaff/shared';
import { searchMessages } from '@/components/chat/ChatSearch';
import { firstLink, typingLine } from '@/lib/chat';

// Presence, search and links (chat-like-whatsapp.md, phase 4).

jest.mock('@/lib/theme', () => ({ usePalette: () => ({}) }));

const say = (id: string, text: string, voice = false): ChatMessage => ({
  id, threadId: 't', authorKind: 'person', authorUserId: 'a', authorAgentId: null, authorName: 'Álvaro',
  parts: [...(voice ? [{ type: 'voice', path: 'p', mediaType: 'audio/mp4', durationMs: 1, transcription: 'done' }] : []), { type: 'text', text }],
  state: 'done', steps: [], createdAt: new Date(2026, 10, 26, 10, Number(id)).toISOString(),
});

describe('who is typing', () => {
  it('says it as WhatsApp does', () => {
    expect(typingLine([])).toBeNull();
    expect(typingLine([{ name: 'Álvaro', kind: 'typing' }])).toBe('Álvaro está escribiendo…');
    expect(typingLine([{ name: 'Álvaro', kind: 'recording' }])).toBe('Álvaro está grabando un audio…');
    expect(typingLine([{ name: 'Álvaro', kind: 'typing' }, { name: 'Bea', kind: 'typing' }])).toBe('Álvaro y Bea están escribiendo…');
  });
});

describe('searching a chat', () => {
  it('finds every word, accents and case aside, a voice note by what was said, newest first', () => {
    const ms = [say('1', 'La feria de Valencia'), say('2', 'Pagamos la señal', true), say('3', 'Otra FERIA')];
    expect(searchMessages(ms, 'feria').map((m) => m.id)).toEqual(['3', '1']);
    expect(searchMessages(ms, 'senal pagamos').map((m) => m.id)).toEqual(['2']);
    expect(searchMessages(ms, '  ')).toEqual([]);
  });
});

describe('a link in a message', () => {
  it('is the first web address, without the punctuation after it', () => {
    expect(firstLink('Mira https://feriavalencia.com/evento, es esta.')).toBe('https://feriavalencia.com/evento');
    expect(firstLink('sin enlace')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { audioLines, completeMention, isAudioPart, mentionQuery, mentionSuggestions, messageText, splitMentions } from '../src/chat';

describe('messageText', () => {
  it('joins the text parts and skips the rest', () => {
    expect(messageText([{ type: 'text', text: 'Hola' }, { type: 'tool-gmail', state: 'done' }, { type: 'text', text: 'Hecho' }])).toBe('Hola\n\nHecho');
  });
});

describe('agent audio', () => {
  const audio = { type: 'audio', path: 'o/t/m.mp3', mediaType: 'audio/mpeg', durationMs: null, title: 'La Mesa 2026-11-30 (ES)' };
  it('knows an audio part, and not a voice note', () => {
    expect(isAudioPart(audio)).toBe(true);
    expect(isAudioPart({ type: 'voice', path: 'o/t/m.m4a', mediaType: 'audio/mp4', durationMs: 1000, transcription: 'done' })).toBe(false);
    expect(isAudioPart({ type: 'audio', path: 'o/t/m.mp3' })).toBe(false);
  });
  it('reads as a line for an agent, and is not text', () => {
    expect(audioLines([{ type: 'text', text: 'Hola' }, audio])).toEqual(['(Audio: La Mesa 2026-11-30 (ES))']);
    expect(messageText([audio])).toBe('');
  });
});

describe('splitMentions', () => {
  const names = ['Ana', 'Ana María', 'Redes'];
  it('marks known names after an @, longest first', () => {
    expect(splitMentions('@Redes, mira esto con @Ana María', names)).toEqual([
      { text: '@Redes', mention: true },
      { text: ', mira esto con ', mention: false },
      { text: '@Ana María', mention: true },
    ]);
  });
  it('ignores case, but not an @ inside a word or a longer word', () => {
    expect(splitMentions('hola @ana', names)).toEqual([
      { text: 'hola ', mention: false },
      { text: '@ana', mention: true },
    ]);
    expect(splitMentions('ana@redes.com y @Anabel', names)).toEqual([{ text: 'ana@redes.com y @Anabel', mention: false }]);
  });
  it('leaves text with no names alone', () => {
    expect(splitMentions('sin nadie', [])).toEqual([{ text: 'sin nadie', mention: false }]);
  });
});

describe('mentions while typing', () => {
  it('finds the half-typed name after an @', () => {
    expect(mentionQuery('pregunta a @Fin')).toBe('Fin');
    expect(mentionQuery('@')).toBe('');
    expect(mentionQuery('correo@ejemplo')).toBeNull();
    expect(mentionQuery('sin arroba')).toBeNull();
  });
  it('suggests names that start with it, and completes one', () => {
    expect(mentionSuggestions('an', ['Ana', 'Redes', 'Ana María'])).toEqual(['Ana', 'Ana María']);
    expect(completeMention('pregunta a @Fin', 'Finanzas')).toBe('pregunta a @Finanzas ');
  });
});

import { linkSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_OUTBOX_BYTES, outboxNote, pickOutbox, readOutbox } from '../src/outbox';

const AGENT = 1001;
const file = (name: string, size = 10, uid = AGENT) => ({ name, kind: 'file' as const, size, uid, links: 1 });

describe('what leaves ~/outbox/', () => {
  it('takes the agent’s mp3 and m4a files, in name order, titled by their name', () => {
    const { take, skipped } = pickOutbox([file('La Mesa (ES).mp3'), file('La Mesa (EN).MP3'), file('Borrador 3.m4a')], AGENT);
    expect(take).toEqual([
      { name: 'Borrador 3.m4a', title: 'Borrador 3', mediaType: 'audio/mp4' },
      { name: 'La Mesa (EN).MP3', title: 'La Mesa (EN)', mediaType: 'audio/mpeg' },
      { name: 'La Mesa (ES).mp3', title: 'La Mesa (ES)', mediaType: 'audio/mpeg' },
    ]);
    expect(skipped).toEqual([]);
  });

  it('skips, saying why, a link, someone else’s file, another type, an empty or too large one, and past four', () => {
    const { take, skipped } = pickOutbox(
      [
        { name: 'a.mp3', kind: 'link', size: 10, uid: AGENT, links: 1 },
        { name: 'a2.mp3', kind: 'file', size: 10, uid: AGENT, links: 2 },
        file('b.mp3', 10, 0),
        file('c.wav'),
        file('d.mp3', 0),
        file('e.mp3', MAX_OUTBOX_BYTES + 1),
        file('.f.mp3'),
        file('g.mp3'),
        file('h.mp3'),
        file('i.mp3'),
        file('j.mp3'),
        file('k.mp3'),
        file('.mp3'),
      ],
      AGENT,
    );
    expect(take.map((f) => f.name)).toEqual(['g.mp3', 'h.mp3', 'i.mp3', 'j.mp3']);
    expect(skipped.map((s) => s.name)).toEqual(['a.mp3', 'a2.mp3', 'b.mp3', 'c.wav', 'd.mp3', 'e.mp3', 'k.mp3']);
    expect(skipped.find((s) => s.name === 'k.mp3')!.why).toContain('como mucho 4');
  });

  it('reads the files from disk, never through a link or a hard link', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'outbox-')));
    const secret = join(root, 'secret');
    writeFileSync(secret, 'ya29.token');
    const dir = join(root, 'outbox');
    mkdirSync(dir);
    writeFileSync(join(dir, 'Episodio.mp3'), Buffer.from('ID3episodio'));
    symlinkSync(secret, join(dir, 'enlace.mp3'));
    linkSync(secret, join(dir, 'duro.mp3'));
    const uid = process.getuid!();
    const { files, skipped } = readOutbox(dir, uid);
    expect(files.map((f) => [f.title, f.bytes.toString()])).toEqual([['Episodio', 'ID3episodio']]);
    expect(skipped.map((s) => s.name).sort()).toEqual(['duro.mp3', 'enlace.mp3']);
  });

  it('nothing goes out when there is no folder, or it was replaced by a link', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'outbox-')));
    expect(readOutbox(join(root, 'outbox'), process.getuid!())).toEqual({ files: [], skipped: [] });
    mkdirSync(join(root, 'otra'));
    writeFileSync(join(root, 'otra', 'x.mp3'), 'ID3');
    symlinkSync(join(root, 'otra'), join(root, 'outbox'));
    expect(readOutbox(join(root, 'outbox'), process.getuid!()).files).toEqual([]);
  });

  it('says in the report what didn’t go out', () => {
    expect(outboxNote([], [])).toBeNull();
    expect(outboxNote([{ name: 'c.wav', why: 'solo salen mp3 o m4a' }], ['La Mesa (ES).mp3'])).toBe(
      'No han salido estos archivos de ~/outbox/:\n- «c.wav»: solo salen mp3 o m4a\n- «La Mesa (ES).mp3»: no se ha podido subir',
    );
  });
});

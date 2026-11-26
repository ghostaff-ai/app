// What an agent leaves for the people who work with it (docs/plans/ongoing/agent-audio.md):
// an audio it made in its run (La Mesa's episode, a Productor draft), dropped in
// ~/outbox/ and named for its title. When Claude Code ends, root reads the folder
// here and main.ts uploads each file to the engine with the run's nonce; the
// engine posts them in the agent's chat after the report.
//
// The agent owns the folder and may have left anything in it, so root takes only
// regular files the agent owns, never through a link: a link, or a hard link to
// one of root's files, could otherwise hand root's secrets to the chat.

import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import { extname, join } from 'node:path';

export const outboxDir = (home: string) => join(home, 'outbox');

/** The engine's limits (apps/engine/src/agentAudio.ts): checked here first, so the agent hears why in its chat. */
export const MAX_OUTBOX_FILES = 4;
export const MAX_OUTBOX_BYTES = 25 * 1024 * 1024;
const TYPES: Record<string, string> = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4' };

/** A name in the folder, as lstat saw it. */
export interface OutboxEntry {
  name: string;
  kind: 'file' | 'link' | 'other';
  size: number;
  uid: number;
  /** Hard links to it: more than one, and it may be one of root's files under another name. */
  links: number;
}

export interface OutboxFile {
  name: string;
  /** The file's name without its extension: what a person reads above the player. */
  title: string;
  mediaType: string;
}

export interface Skipped {
  name: string;
  why: string;
}

/** Which of the folder's entries go out, in name order, and why each other one doesn't. Pure. */
export function pickOutbox(entries: OutboxEntry[], agentUid: number): { take: OutboxFile[]; skipped: Skipped[] } {
  const take: OutboxFile[] = [];
  const skipped: Skipped[] = [];
  for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (e.name.startsWith('.')) continue; // an editor's or a tool's leftovers, not meant for anyone
    const ext = extname(e.name).toLowerCase();
    const title = e.name.slice(0, e.name.length - ext.length).replace(/\s+/g, ' ').trim();
    if (e.kind !== 'file' || e.uid !== agentUid || e.links !== 1) skipped.push({ name: e.name, why: 'no es un archivo tuyo (un enlace o una carpeta)' });
    else if (!TYPES[ext]) skipped.push({ name: e.name, why: 'solo salen mp3 o m4a' });
    else if (!title || title.length > 120) skipped.push({ name: e.name, why: 'su nombre tiene que tener entre 1 y 120 caracteres' });
    else if (e.size === 0) skipped.push({ name: e.name, why: 'está vacío' });
    else if (e.size > MAX_OUTBOX_BYTES) skipped.push({ name: e.name, why: 'pasa de 25 MB' });
    else if (take.length >= MAX_OUTBOX_FILES) skipped.push({ name: e.name, why: `salen como mucho ${MAX_OUTBOX_FILES} por ejecución` });
    else take.push({ name: e.name, title, mediaType: TYPES[ext]! });
  }
  return { take, skipped };
}

/**
 * The files to upload, read by root without following a link, and the ones skipped. No folder (the agent left
 * nothing, or removed it), or a folder replaced by a link: nothing goes out.
 */
export function readOutbox(dir: string, agentUid: number): { files: (OutboxFile & { bytes: Buffer })[]; skipped: Skipped[] } {
  let entries: OutboxEntry[];
  try {
    const self = lstatSync(dir);
    if (!self.isDirectory() || realpathSync(dir) !== dir) return { files: [], skipped: [{ name: 'outbox', why: 'no es una carpeta' }] };
    entries = readdirSync(dir).map((name) => {
      const s = lstatSync(join(dir, name));
      return { name, kind: s.isSymbolicLink() ? 'link' : s.isFile() ? 'file' : 'other', size: s.size, uid: s.uid, links: s.nlink };
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { files: [], skipped: [] };
    throw e;
  }
  const { take, skipped } = pickOutbox(entries, agentUid);
  const files: (OutboxFile & { bytes: Buffer })[] = [];
  for (const f of take) {
    let fd: number | null = null;
    try {
      fd = openSync(join(dir, f.name), constants.O_RDONLY | constants.O_NOFOLLOW);
      // Checked again on what was opened: the agent's processes may still be running.
      const s = fstatSync(fd);
      if (!s.isFile() || s.uid !== agentUid || s.nlink !== 1 || s.size > MAX_OUTBOX_BYTES) {
        skipped.push({ name: f.name, why: 'ha cambiado mientras lo leía' });
        continue;
      }
      const bytes = Buffer.alloc(s.size);
      let at = 0;
      while (at < bytes.length) {
        const n = readSync(fd, bytes, at, bytes.length - at, at);
        if (n === 0) break;
        at += n;
      }
      files.push({ ...f, bytes: bytes.subarray(0, at) });
    } catch {
      skipped.push({ name: f.name, why: 'no se ha podido leer' });
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }
  return { files, skipped };
}

/** What the report adds when an audio didn't go out, so the people in the chat know. Null when all did. */
export function outboxNote(skipped: Skipped[], failed: string[]): string | null {
  const lines = [...skipped.map((s) => `«${s.name}»: ${s.why}`), ...failed.map((name) => `«${name}»: no se ha podido subir`)];
  return lines.length ? `No han salido estos archivos de ~/outbox/:\n${lines.map((l) => `- ${l}`).join('\n')}` : null;
}

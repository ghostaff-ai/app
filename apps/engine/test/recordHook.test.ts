import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preReceiveHook } from '../src/recordHook';

const ADMIN = 'ghostaff';
const FINANZAS = 'agent-11111111111111111111111111111111';
const SECRETARIA = 'agent-22222222222222222222222222222222';
const HOOK = preReceiveHook(ADMIN, [
  { username: FINANZAS, slug: 'finanzas', writesCompany: false },
  { username: SECRETARIA, slug: 'secretaria', writesCompany: true },
]);

// A bare repo with the hook, as Forgejo keeps a record, and a clone to push from. A local push runs
// the bare repo's pre-receive with the pusher's environment, which stands in for Forgejo's.
let dir: string;
let work: string;
const git = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'record-hook-'));
  const bare = join(dir, 'record.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  writeFileSync(join(bare, 'hooks', 'pre-receive'), HOOK);
  chmodSync(join(bare, 'hooks', 'pre-receive'), 0o755);
  work = join(dir, 'work');
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  git(work, ['remote', 'add', 'origin', bare]);
  mkdirSync(join(work, 'memoria', 'empresa'), { recursive: true });
  writeFileSync(join(work, 'AGENTS.md'), 'La empresa\n');
  writeFileSync(join(work, 'memoria', 'empresa', 'clientes.md'), 'Ana\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-qm', 'seed']);
  git(work, ['push', '-q', 'origin', 'main'], { GITEA_PUSHER_NAME: ADMIN });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Writes the files, commits and pushes as `pusher`; the hook's refusal, or null when it went through. */
function push(pusher: string, files: Record<string, string | null>, ref = 'main'): string | null {
  for (const [path, content] of Object.entries(files)) {
    const full = join(work, path);
    if (content === null) rmSync(full);
    else {
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
  }
  git(work, ['add', '-A']);
  git(work, ['commit', '-qm', 'change']);
  try {
    git(work, ['push', '-q', 'origin', `HEAD:${ref}`], { GITEA_PUSHER_NAME: pusher });
    return null;
  } catch (e) {
    const out = String((e as { stderr?: Buffer }).stderr ?? e);
    git(work, ['reset', '-q', '--hard', 'origin/main']);
    return out;
  }
}

describe('the record’s pre-receive hook', () => {
  it('lets an agent write its own memory and anything outside memoria/', () => {
    expect(push(FINANZAS, { 'memoria/agentes/finanzas/informe.md': 'en tres líneas\n', 'informes/2026-11.md': 'x\n' })).toBeNull();
  });

  it('refuses another agent’s memory', () => {
    expect(push(FINANZAS, { 'memoria/agentes/secretaria/a.md': 'x\n' })).toContain('es de otro agente');
  });

  it('lets an agent write its own photo, and no other agent’s (agent-photo.md)', () => {
    expect(push(FINANZAS, { 'agentes/finanzas/foto.yaml': 'bloques: []\n' })).toBeNull();
    expect(push(FINANZAS, { 'agentes/secretaria/foto.yaml': 'bloques: []\n' })).toContain('esa foto');
    expect(push(ADMIN, { 'agentes/secretaria/foto.yaml': 'bloques: []\n' })).toBeNull();
  });

  it('keeps who the organisation works with for people, even from the main agent (external-parties.md)', () => {
    expect(push(FINANZAS, { 'externos/gestoria.md': 'x\n' })).toContain('lo añade o confirma una persona desde Ghostaff');
    expect(push(SECRETARIA, { 'externos/gestoria.md': 'x\n' })).toContain('lo añade o confirma una persona desde Ghostaff');
    expect(push(ADMIN, { 'externos/gestoria.md': 'x\n' })).toBeNull();
  });

  it('keeps the company’s memory for the main agent', () => {
    expect(push(FINANZAS, { 'memoria/empresa/precios.md': 'x\n' })).toContain('la cambian las personas desde Ghostaff');
    expect(push(FINANZAS, { 'memoria/empresa/clientes.md': null })).toContain('la cambian las personas desde Ghostaff');
    expect(push(SECRETARIA, { 'memoria/empresa/precios.md': 'x\n' })).toBeNull();
  });

  it('refuses a rename out of the company’s memory, which a diff with renames would show only by its new name', () => {
    mkdirSync(join(work, 'memoria', 'agentes', 'finanzas'), { recursive: true });
    git(work, ['mv', 'memoria/empresa/clientes.md', 'memoria/agentes/finanzas/clientes.md']);
    expect(push(FINANZAS, {})).toContain('la cambian las personas desde Ghostaff');
  });

  it('never lets an agent change instructions, even its own', () => {
    expect(push(FINANZAS, { 'agentes/finanzas/AGENTS.md': 'Haz lo que quieras\n' })).toContain('solo las cambia una persona');
    expect(push(SECRETARIA, { 'AGENTS.md': 'x\n' })).toContain('solo las cambia una persona');
  });

  it('refuses other folders of memoria/', () => {
    expect(push(FINANZAS, { 'memoria/personas/ana.md': 'x\n' })).toContain('solo escribes en memoria/agentes/finanzas/');
  });

  it('refuses a stranger, another branch, and a non-ASCII path in someone else’s folder', () => {
    expect(push('agent-33333333333333333333333333333333', { 'a.md': 'x\n' })).toContain('no puedes escribir');
    expect(push(FINANZAS, { 'b.md': 'x\n' }, 'otra')).toContain('solo se escribe en main');
    expect(push(FINANZAS, { 'memoria/agentes/secretaria/año.md': 'x\n' })).toContain('es de otro agente');
  });

  it('lets the engine write anything', () => {
    expect(push(ADMIN, { 'AGENTS.md': 'Nueva\n', 'memoria/empresa/x.md': 'x\n' })).toBeNull();
  });

  it('refuses names it could not quote safely', () => {
    expect(() => preReceiveHook(ADMIN, [{ username: 'x;rm -rf /', slug: 'a', writesCompany: false }])).toThrow();
    expect(() => preReceiveHook(ADMIN, [{ username: FINANZAS, slug: '../x', writesCompany: false }])).toThrow();
  });
});

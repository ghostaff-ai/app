import { describe, expect, it } from 'vitest';
import { blockReason, onlyWhatRuns, type PushContext } from '../src/guard';
import { agentEnv, claudeArgs, crashText, newDecisions, noteworthy, passwdIds, readSpec, redact, resultOf } from '../src/lib';

const SPEC = {
  run: '40000000-0000-0000-0000-000000000001',
  slug: 'legal',
  prompt: 'Eres el agente «Legal».',
  model: 'claude-opus-5-5',
  tools: ['Bash', 'Read', 'WebSearch'],
  maxTurns: 200,
  record: { repo: 'ordago-app/business', token: 'ghs_secret_token' },
  author: { name: 'Legal (Ghostaff)', email: 'bot@example.com' },
  claudeToken: 'sk-ant-oat01-secret',
  decisionsDir: 'por-decidir',
};

describe('the spec', () => {
  it('is read when whole, and refused when anything would reach a command line unchecked', () => {
    expect(readSpec(SPEC).slug).toBe('legal');
    expect(() => readSpec({ ...SPEC, tools: ['Bash; rm -rf /'] })).toThrow();
    expect(() => readSpec({ ...SPEC, model: '--dangerously-skip-permissions' })).toThrow();
    expect(() => readSpec({ ...SPEC, record: { repo: 'a/b --upload-pack=x', token: 't' } })).toThrow();
    expect(() => readSpec({ ...SPEC, claudeToken: '' })).toThrow();
  });

  it('runs Claude Code with the agent’s model, tools and turns, never asking', () => {
    expect(claudeArgs(SPEC)).toEqual([
      '-p', '--model', 'claude-opus-5-5', '--permission-mode', 'dontAsk', '--allowedTools', 'Bash,Read,WebSearch',
      '--max-turns', '200', '--output-format', 'stream-json', '--verbose',
    ]);
  });

  it('gives Claude Code only its credential, HOME, PATH and LANG', () => {
    expect(Object.keys(agentEnv('tok', '/home/agente')).sort()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'LANG', 'PATH']);
  });
});

describe('the end of a run', () => {
  it('reads the last stream-json event', () => {
    expect(resultOf('{"type":"result","is_error":false,"result":"  Hecho.  "}')).toEqual({ ok: true, text: 'Hecho.' });
    expect(resultOf('{"type":"result","is_error":true,"result":"Se acabaron los turnos"}')).toEqual({ ok: false, text: 'Se acabaron los turnos' });
    expect(resultOf('{"type":"assistant"}')).toEqual({ ok: false, text: null });
    expect(resultOf('not json')).toEqual({ ok: false, text: null });
  });

  it('has something to tell unless it says exactly SIN NOVEDAD', () => {
    expect(noteworthy('SIN NOVEDAD')).toBe(false);
    expect(noteworthy('`SIN NOVEDAD`')).toBe(false);
    expect(noteworthy('**SIN NOVEDAD**\n')).toBe(false);
    expect(noteworthy('SIN NOVEDAD en Murcia, pero Valencia cambia.')).toBe(true);
    expect(noteworthy(null)).toBe(false);
  });

  it('lists only the decisions this agent opened in this run', () => {
    const files = [
      { name: 'legal-murcia.yaml', content: 'propone: legal\npregunta: ¿Avisamos a Murcia?\n' },
      { name: 'legal-vieja.yaml', content: 'propone: legal\npregunta: Vieja\n' },
      { name: 'seo-titulo.yaml', content: 'propone: seo\npregunta: ¿Título?\n' },
      { name: 'legal-rota.yaml', content: 'propone: [legal\n' },
      { name: 'legal-sin-pregunta.yaml', content: 'propone: legal\n' },
      { name: 'README.md', content: '' },
    ];
    expect(newDecisions(files, new Set(['legal-vieja.yaml']), 'legal')).toEqual([
      { id: 'legal-murcia', question: '¿Avisamos a Murcia?' },
      { id: 'legal-sin-pregunta', question: 'legal-sin-pregunta' },
    ]);
  });

  it('never prints or reports a secret', () => {
    expect(redact('push with ghs_secret_token failed', [SPEC.record.token])).toBe('push with [secreto] failed');
    expect(crashText(new Error(`bad sk-ant-oat01-secret`), [SPEC.claudeToken])).toBe('Error: bad [secreto]');
  });

  it('finds the agent’s user', () => {
    expect(passwdIds('root:x:0:0:root:/root:/bin/bash\nagente:x:1001:1001::/home/agente:/bin/bash\n', 'agente')).toEqual({
      uid: 1001,
      gid: 1001,
      home: '/home/agente',
    });
  });
});

describe('the guard', () => {
  const ctx: PushContext = { record: '/home/agente/registro', defaultBranch: 'main', currentBranch: () => 'main' };
  const blocked = (cmd: string, cwd = ctx.record, c = ctx) => blockReason(cmd, cwd, c);

  it('lets the agent commit and push to the record’s default branch', () => {
    expect(blocked('git add -A && git commit -m "legal: revisión 2027" && git push')).toBeNull();
    expect(blocked('git push origin main')).toBeNull();
    expect(blocked('git -C /home/agente/registro push origin HEAD:main')).toBeNull();
    expect(blocked('git commit -m "no uses git push --force nunca"')).toBeNull();
  });

  it('blocks a push anywhere else, forced, or from elsewhere', () => {
    expect(blocked('git push origin otra-rama')).toMatch(/main/);
    expect(blocked('git push', ctx.record, { ...ctx, currentBranch: () => 'rama' })).toMatch(/main/);
    expect(blocked('git push --force origin main')).toMatch(/forzado/);
    expect(blocked('git push origin +main')).toMatch(/forzado/);
    expect(blocked('git push --delete origin main')).toMatch(/forzado/);
    expect(blocked('git push https://github.com/otro/repo main')).toMatch(/origin/);
    expect(blocked('cd /tmp/x && git push origin main')).toMatch(/registro/);
    expect(blocked('git push origin main', '/tmp/otro')).toMatch(/registro/);
  });

  it('blocks skipping hooks and changing remotes or credentials', () => {
    expect(blocked('git commit --no-verify -m x')).toMatch(/hooks/);
    expect(blocked('git config core.hooksPath /dev/null')).toMatch(/hooks/);
    expect(blocked('git remote set-url origin https://github.com/otro/repo')).toMatch(/remoto/);
    expect(blocked('git -c credential.helper= push origin main')).toMatch(/credenciales/);
  });

  it('reads what runs, not what is only written', () => {
    expect(onlyWhatRuns("echo 'git push --force'")).toBe("echo ''");
    expect(blocked("bash -c 'git push --force origin main'")).toMatch(/forzado/);
  });
});

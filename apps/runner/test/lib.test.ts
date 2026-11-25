import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blockReason, onlyWhatRuns, type PushContext } from '../src/guard';
import { agentEnv, claudeArgs, crashText, decisionFiles, engineClosedRun, newDecisions, tokenNearExpiry, noteworthy, passwdIds, readSpec, redact, resultOf, usageOf } from '../src/lib';

const SPEC = {
  run: '40000000-0000-0000-0000-000000000001',
  slug: 'legal',
  prompt: 'Eres el agente «Legal».',
  model: 'claude-opus-5-5',
  tools: ['Bash', 'Read', 'WebSearch'],
  maxTurns: 200,
  record: {
    repo: 'ordago-app/business',
    cloneUrl: 'https://github.com/ordago-app/business.git',
    username: 'x-access-token',
    token: 'ghs_secret_token',
    expiresAt: '2026-11-21T11:00:00Z',
  },
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

  it('clones only from GitHub or our record store, as a plain git user', () => {
    const own = {
      ...SPEC.record,
      repo: 'records/6f1d2c3b-0000-4000-8000-000000000001',
      cloneUrl: 'http://10.132.0.5:3000/records/6f1d2c3b-0000-4000-8000-000000000001.git',
      username: 'agent-0b6a4c1e111142228333944455556666',
    };
    expect(readSpec({ ...SPEC, record: own }).record.cloneUrl).toBe(own.cloneUrl);
    expect(() => readSpec({ ...SPEC, record: { ...own, cloneUrl: 'ext::sh -c touch% /tmp/x' } })).toThrow();
    expect(() => readSpec({ ...SPEC, record: { ...own, cloneUrl: 'http://10.0.0.5:3000/otra/cosa.git' } })).toThrow();
    expect(() => readSpec({ ...SPEC, record: { ...own, cloneUrl: 'https://evil.example/records/x.git --upload-pack=x' } })).toThrow();
    expect(() => readSpec({ ...SPEC, record: { ...own, username: '-c core.sshCommand=x' } })).toThrow();
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

  it('points gcloud and bq at the token file and the organisation’s project, never the token itself', () => {
    const env = agentEnv('tok', '/home/agente', { tokenFile: '/tmp/ghostaff-gcloud-x/token', project: 'ordago-prod' });
    expect(env).toMatchObject({ CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: '/tmp/ghostaff-gcloud-x/token', CLOUDSDK_CORE_PROJECT: 'ordago-prod', CLOUDSDK_CORE_DISABLE_PROMPTS: '1' });
    expect(Object.values(env).join(' ')).not.toContain('ya29');
    expect(agentEnv('tok', '/home/agente', { tokenFile: '/t', project: null }).CLOUDSDK_CORE_PROJECT).toBeUndefined();
  });

  it('reads the organisation’s Google Cloud, and refuses anything odd in it', () => {
    const google = { account: 'org-0123456789abcdef01234567@ghostaff-tenants-beta.iam.gserviceaccount.com', project: 'ordago-prod', token: 'ya29.a0AfB_byC-token', expiresAt: '2026-11-21T11:00:00Z' };
    expect(readSpec({ ...SPEC, google }).google).toEqual(google);
    expect(readSpec({ ...SPEC, google: null }).google).toBeNull();
    expect(readSpec({ ...SPEC, google: { ...google, project: null } }).google?.project).toBeNull();
    expect(() => readSpec({ ...SPEC, google: { ...google, project: 'ordago-prod; rm -rf /' } })).toThrow();
    expect(() => readSpec({ ...SPEC, google: { ...google, token: 'ya29 token\nX=1' } })).toThrow();
    expect(() => readSpec({ ...SPEC, google: { ...google, account: 'someone@gmail.com' } })).toThrow();
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

  it('reads only regular decision files, never through a symlink the agent left', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decisiones-'));
    writeFileSync(join(dir, 'legal-murcia.yaml'), 'propone: legal\npregunta: ¿Murcia?\n');
    const outside = join(mkdtempSync(join(tmpdir(), 'fuera-')), 'secreto.yaml');
    writeFileSync(outside, 'propone: legal\npregunta: contenido de root\n');
    symlinkSync(outside, join(dir, 'legal-enlace.yaml'));
    mkdirSync(join(dir, 'carpeta.yaml'));
    expect(decisionFiles(dir).map((f) => f.name)).toEqual(['legal-murcia.yaml']);
    const linkedDir = join(mkdtempSync(join(tmpdir(), 'enlace-')), 'por-decidir');
    symlinkSync(dir, linkedDir);
    expect(decisionFiles(linkedDir)).toEqual([]);
    expect(decisionFiles(join(dir, 'no-existe'))).toEqual([]);
  });

  it('a decision’s question never carries a secret', () => {
    const files = [{ name: 'legal-x.yaml', content: 'propone: legal\npregunta: el token es ghs_secret_token\n' }];
    expect(newDecisions(files, new Set(), 'legal', [SPEC.record.token])).toEqual([{ id: 'legal-x', question: 'el token es [secreto]' }]);
  });

  it('renews the record token five minutes before it ends', () => {
    expect(tokenNearExpiry('2026-11-21T11:00:00Z', Date.parse('2026-11-21T10:54:00Z'))).toBe(false);
    expect(tokenNearExpiry('2026-11-21T11:00:00Z', Date.parse('2026-11-21T10:56:00Z'))).toBe(true);
  });

  it('skips its report only when the engine closed the run itself', () => {
    expect(engineClosedRun(409, { error: 'no_subscription' })).toBe(true);
    expect(engineClosedRun(409, { error: 'no_record' })).toBe(true);
    expect(engineClosedRun(409, { error: 'already_taken' })).toBe(false);
    expect(engineClosedRun(409, { error: 'gone' })).toBe(false);
    expect(engineClosedRun(409, null)).toBe(false);
    expect(engineClosedRun(403, { error: 'no_subscription' })).toBe(false);
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

describe('what Claude Code used', () => {
  it('reads the limits from a rate_limit_event and the tokens from the result, nothing from other lines', () => {
    const info = { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1, status: 'allowed' } } };
    expect(usageOf(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: info }))).toEqual({ rateLimit: info });
    expect(usageOf(JSON.stringify({ type: 'result', usage: { input_tokens: 1 } }))).toEqual({ usage: { input_tokens: 1 } });
    expect(usageOf(JSON.stringify({ type: 'assistant' }))).toEqual({});
    expect(usageOf('not json')).toEqual({});
  });
});

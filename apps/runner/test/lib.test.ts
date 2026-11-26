import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blockReason, onlyWhatRuns, type PushContext, readPushRules } from '../src/guard';
import { agentEnv, claudeArgs, cloneArgs, crashText, credentialKey, credentialKeyOf, pushRules, decisionFiles, endingOf, engineClosedRun, newDecisions, tokenNearExpiry, noteworthy, passwdIds, readSpec, redact, resultOf, usageOf } from '../src/lib';

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

  it('takes the other repos only from GitHub, each into its own folder, and none from an older engine', () => {
    const apps = {
      repo: 'ordago-app/ordago-apps',
      dir: 'ordago-apps',
      cloneUrl: 'https://github.com/ordago-app/ordago-apps.git',
      write: false,
      token: 'ghs_apps',
      expiresAt: '2026-11-21T11:00:00Z',
    };
    expect(readSpec(SPEC).repos).toBeUndefined();
    expect(readSpec({ ...SPEC, repos: [apps] }).repos).toEqual([apps]);
    expect(() => readSpec({ ...SPEC, repos: [{ ...apps, cloneUrl: 'https://github.com/otro/repo.git' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, repos: [{ ...apps, cloneUrl: 'http://10.0.0.5:3000/records/x.git' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, repos: [{ ...apps, dir: '../registro' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, repos: [{ ...apps, dir: '..' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, repos: [{ ...apps, dir: '--upload-pack=x' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, repos: [apps, { ...apps, repo: 'ordago-app/web', cloneUrl: 'https://github.com/ordago-app/web.git' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, repos: [{ ...apps, write: 'yes' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, repos: [{ ...apps, token: '' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, repos: apps })).toThrow();
    expect(readSpec({ ...SPEC, repos: [{ ...apps, write: true, main: true }] }).repos![0]!.main).toBe(true);
    expect(() => readSpec({ ...SPEC, repos: [{ ...apps, write: false, main: true }] })).toThrow();
    expect(() => readSpec({ ...SPEC, repos: [{ ...apps, write: true, main: 'yes' }] })).toThrow();
  });

  it('tells the guard which cloned repos the agent may push to, and whether main too', () => {
    const r = (repo: string, write: boolean, main?: boolean) => ({ repo, dir: repo.split('/')[1]!, write, ...(main === undefined ? {} : { main }) });
    const repos = [r('o/apps', true), r('o/reels', true, true), r('o/web', false), r('o/roto', true)];
    expect(pushRules(repos, '/home/agente', new Set(['o/apps', 'o/reels', 'o/web']))).toEqual([
      { repo: 'o/apps', dir: '/home/agente/repos/apps', main: false },
      { repo: 'o/reels', dir: '/home/agente/repos/reels', main: true },
    ]);
  });

  it('clones a read-only repo shallow, and one the agent writes with its history', () => {
    const url = 'https://github.com/ordago-app/ordago-apps.git';
    expect(cloneArgs({ cloneUrl: url, write: false }, '/home/agente/repos/ordago-apps')).toEqual([
      'clone', '--quiet', '--depth', '1', '--single-branch', url, '/home/agente/repos/ordago-apps',
    ]);
    expect(cloneArgs({ cloneUrl: url, write: true }, '/d')).toEqual(['clone', '--quiet', '--filter=blob:none', url, '/d']);
  });

  it('knows a repo the same way whether git names it with .git, a slash or other case', () => {
    const key = credentialKeyOf('https://github.com/ordago-app/ordago-apps.git');
    expect(credentialKey('https', 'github.com', 'ordago-app/ordago-apps.git')).toBe(key);
    expect(credentialKey('https', 'GitHub.com', 'Ordago-App/ordago-apps/')).toBe(key);
    expect(credentialKey('http', 'github.com', 'ordago-app/ordago-apps.git')).not.toBe(key);
    expect(credentialKey('https', 'github.com', 'ordago-app/business.git')).not.toBe(key);
    expect(credentialKeyOf('http://10.132.0.5:3000/records/org-1.git')).toBe(credentialKey('http', '10.132.0.5:3000', 'records/org-1.git'));
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

  it('reads the organisation’s secrets, none from an older engine, and refuses a variable that would replace one it relies on', () => {
    const eleven = { env: 'ELEVENLABS_API_KEY', value: 'sk_eleven_1234567890' };
    expect(readSpec(SPEC).secrets).toBeUndefined();
    expect(readSpec({ ...SPEC, secrets: [eleven, { env: 'CORREO_GMAIL_PASSWORD', value: 'abcd efgh ijkl mnop' }] }).secrets).toHaveLength(2);
    for (const env of ['HOME', 'PATH', 'LANG', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_BASE_URL', 'CLOUDSDK_AUTH_ACCESS_TOKEN_FILE', 'CLOUDSDK_CORE_PROJECT', 'GIT_SSH_COMMAND', 'LD_PRELOAD', 'NODE_OPTIONS', 'BASH_ENV', 'GOOGLE_APPLICATION_CREDENTIALS', 'GHOSTAFF_RUNS']) {
      expect(() => readSpec({ ...SPEC, secrets: [{ ...eleven, env }] }), env).toThrow();
    }
    expect(() => readSpec({ ...SPEC, secrets: [{ ...eleven, env: 'elevenlabs_key' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, secrets: [{ ...eleven, env: 'X=1 Y' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, secrets: [eleven, { ...eleven, value: 'otro_valor_largo' }] })).toThrow();
    // Too short for redact to hide it, or something an environment cannot hold.
    expect(() => readSpec({ ...SPEC, secrets: [{ ...eleven, value: 'corto' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, secrets: [{ ...eleven, value: 'sk_eleven\0_1234' }] })).toThrow();
    expect(() => readSpec({ ...SPEC, secrets: eleven })).toThrow();
  });

  it('gives Claude Code the organisation’s secrets as variables, never over one the runner sets', () => {
    const env = agentEnv('tok', '/home/agente', null, null, [
      { env: 'ELEVENLABS_API_KEY', value: 'sk_eleven_1234567890' },
      { env: 'HOME', value: '/tmp/otra-casa' },
      { env: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-otro-token' },
      { env: 'GHOSTAFF_RUNS', value: 'http://evil.example:1' },
    ]);
    expect(env).toEqual({ ELEVENLABS_API_KEY: 'sk_eleven_1234567890', CLAUDE_CODE_OAUTH_TOKEN: 'tok', HOME: '/home/agente', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' });
  });

  it('hides a secret’s value from what is printed and reported, spaces and all', () => {
    const secrets = ['abcd efgh ijkl mnop', 'sk_eleven_1234567890'];
    expect(redact('{"type":"user","content":"CORREO_GMAIL_PASSWORD=abcd efgh ijkl mnop\nELEVENLABS_API_KEY=sk_eleven_1234567890"}', secrets)).toBe(
      '{"type":"user","content":"CORREO_GMAIL_PASSWORD=[secreto]\nELEVENLABS_API_KEY=[secreto]"}',
    );
  });
});

describe('the end of a run', () => {
  it('reads the last stream-json event', () => {
    expect(resultOf('{"type":"result","is_error":false,"result":"  Hecho.  "}')).toEqual({ ok: true, text: 'Hecho.' });
    expect(resultOf('{"type":"result","is_error":true,"result":"Se acabaron los turnos"}')).toEqual({ ok: false, text: 'Se acabaron los turnos' });
    expect(resultOf('{"type":"assistant"}')).toEqual({ ok: false, text: null });
    expect(resultOf('not json')).toEqual({ ok: false, text: null });
  });

  it('reads how the run ended from its result event: turns and subtype, nothing else', () => {
    expect(endingOf('{"type":"result","subtype":"error_max_turns","num_turns":400,"is_error":true}')).toEqual({ turns: 400, ending: 'error_max_turns' });
    expect(endingOf('{"type":"result","subtype":"success","num_turns":12}')).toEqual({ turns: 12, ending: 'success' });
    expect(endingOf('{"type":"result","subtype":"<script>","num_turns":"12"}')).toEqual({});
    expect(endingOf('{"type":"assistant","num_turns":3}')).toEqual({});
    expect(endingOf('not json')).toEqual({});
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

  it('lets the agent push from a repo it writes to any branch but production’s, unless that repo allows main', () => {
    const apps = '/home/agente/repos/ordago-apps';
    const reels = '/home/agente/repos/ordago-reels';
    const c: PushContext = {
      ...ctx,
      currentBranch: (d) => (d === apps ? 'develop' : 'main'),
      writable: [
        { repo: 'ordago-app/ordago-apps', dir: apps, main: false },
        { repo: 'ordago-app/ordago-reels', dir: reels, main: true },
      ],
    };
    expect(blocked(`git -C ${apps} push origin HEAD:develop`, ctx.record, c)).toBeNull();
    expect(blocked(`git -C ${apps} push`, ctx.record, c)).toBeNull();
    expect(blocked(`git -C ${apps} push origin seo/titulo-portada`, ctx.record, c)).toBeNull();
    expect(blocked(`git -C ${apps} push origin HEAD:main`, ctx.record, c)).toMatch(/producción/);
    expect(blocked(`git -C ${apps} push origin beta`, ctx.record, c)).toMatch(/producción/);
    expect(blocked(`git -C ${apps} push origin refs/heads/main`, ctx.record, c)).toMatch(/producción/);
    expect(blocked(`git -C ${apps} push --force origin develop`, ctx.record, c)).toMatch(/forzado/);
    expect(blocked(`git -C ${apps} push origin +develop`, ctx.record, c)).toMatch(/forzado/);
    expect(blocked(`git -C ${apps} push https://github.com/otro/repo develop`, ctx.record, c)).toMatch(/origin/);
    expect(blocked(`cd ${apps} && git push origin develop`, ctx.record, c)).toMatch(/sin `cd`/);
    expect(blocked(`git -C ${reels} push origin main`, ctx.record, c)).toBeNull();
    // A repo it only reads, or any other folder: no push at all.
    expect(blocked('git -C /home/agente/repos/ordago-web push origin develop', ctx.record, c)).toMatch(/ordago-apps/);
    // The record keeps its own rule.
    expect(blocked('git push origin develop', ctx.record, c)).toMatch(/rama principal del registro/);
  });

  it('reads the push rules the runner wrote, and nothing it cannot trust', () => {
    const dir = mkdtempSync(join(tmpdir(), 'push-'));
    const file = join(dir, 'push.json');
    expect(readPushRules(file)).toEqual([]);
    writeFileSync(file, JSON.stringify([{ repo: 'o/apps', dir: '/home/agente/repos/apps', main: false }, { repo: 'o/x', dir: 'relativo', main: false }, { dir: '/a' }]));
    expect(readPushRules(file)).toEqual([{ repo: 'o/apps', dir: '/home/agente/repos/apps', main: false }]);
    writeFileSync(file, 'no es json');
    expect(readPushRules(file)).toEqual([]);
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

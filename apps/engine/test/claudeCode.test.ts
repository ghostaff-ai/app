import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { childEnv, outputForLog, parseSignInOutput, Slots, spawnInTerminal, stripTerminal } from '../src/claudeCode';

// What `claude setup-token` 2.1.317 printed in a pty on this machine, up to a
// wrong code pasted in (the PKCE challenge and state replaced).
const recorded = readFileSync(join(import.meta.dirname, 'fixtures', 'setup-token.out'), 'utf8');
const beforeCode = recorded.slice(0, recorded.indexOf('OAuth error'));
const URL_START = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TOKEN = `sk-ant-oat01-${'Ab3_-'.repeat(20)}AA`;

describe("reading Claude Code's sign-in", () => {
  it('finds the sign-in link in what it printed, whole', () => {
    const seen = parseSignInOutput(beforeCode);
    expect(seen.url?.startsWith(URL_START)).toBe(true);
    expect(seen.url).toContain('state=STATE');
    expect(seen.token).toBeNull();
    expect(seen.badCode).toBe(false);
  });

  it('notices a code it refused', () => {
    expect(parseSignInOutput(recorded).badCode).toBe(true);
    // 2.1.330's wording.
    expect(parseSignInOutput("\x1b[31m✘ OAuth error: That code wasn't accepted. It may be incomplete, expired…").badCode).toBe(true);
  });

  it("reads 2.1.330's shorter link too (what the engine image runs)", () => {
    const link = 'https://claude.ai/oauth/authorize?IAsKtmrIqYK0NhfAcppmbJAaUxLGHJKaKpfyLLKOv_K8';
    expect(parseSignInOutput(`\x1b]8;id=y8cmvb;${link}\x07\x1b[2m${link}\x1b[22m\x1b]8;;\x07\r\n`).url).toBe(link);
  });

  it('finds the link without the hyperlink escape too, and only on Anthropic', () => {
    expect(parseSignInOutput(`Open \x1b[38;2;1;2;3m${URL_START}&state=x\x1b[39m\r\n`).url).toBe(`${URL_START}&state=x`);
    expect(parseSignInOutput('https://evil.example/oauth/authorize?x=1\n').url).toBeNull();
    expect(parseSignInOutput('\x1b]8;id=a;https://claude.com.evil.example/oauth\x07x\x1b]8;;\x07').url).toBeNull();
    expect(parseSignInOutput('http://claude.com/cai/oauth/authorize\n').url).toBeNull();
  });

  it('finds the token among colours, cursor moves and line ends', () => {
    const out =
      `${beforeCode}\x1b[?2026h\x1b[2K\x1b[1A\r\n\x1b[38;2;78;186;101m✓\x1b[39m Long-lived authentication token created successfully!\r\n\r\n` +
      `Your OAuth token (valid for 1 year):\r\n\r\n\x1b[1m${TOKEN}\x1b[22m\r\n\r\nStore this token securely.\x1b[?2026l`;
    const seen = parseSignInOutput(out);
    expect(seen.token).toBe(TOKEN);
    expect(seen.url?.startsWith(URL_START)).toBe(true);
  });

  it('a token cut by the end of what arrived so far is not taken', () => {
    expect(parseSignInOutput('sk-ant-oat01-short\r\n').token).toBeNull();
    expect(parseSignInOutput(`Your OAuth token:\r\n\r\n${TOKEN.slice(0, 60)}`).token).toBeNull();
    expect(parseSignInOutput(`Your OAuth token:\r\n\r\n${TOKEN}\r`).token).toBe(TOKEN);
  });

  it('strips terminal escapes to readable text', () => {
    expect(stripTerminal('\x1b[1mHola\x1b[22m\x1b]0;title\x07\x1b(B\x1b7 ya\r\n').replace(/\s+/g, ' ').trim()).toBe('Hola ya');
  });
});

describe("Claude Code's environment", () => {
  it('carries none of the engine’s secrets, and never an API key', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-x';
    const env = childEnv('/tmp/h', { CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
    expect(env.HOME).toBe('/tmp/h');
    expect(env.BROWSER).toBe('true');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe('a token at the very end', () => {
  it('is taken once Claude Code has ended, not while it runs', () => {
    expect(parseSignInOutput(`token:\r\n${TOKEN}`).token).toBeNull();
    expect(parseSignInOutput(`token:\r\n${TOKEN}`, { final: true }).token).toBe(TOKEN);
  });
});

const hasScript = (() => {
  try {
    execFileSync('script', ['--version'], { stdio: 'ignore' });
    return process.platform === 'linux';
  } catch {
    return false;
  }
})();

describe.runIf(hasScript)('a program in a terminal under script (the real thing, without Claude Code)', () => {
  it('hands over all its output, the last bytes included, before saying it ended', async () => {
    const home = mkdtempSync(join(tmpdir(), 'claude-test-'));
    try {
      const p = spawnInTerminal(home, `printf 'Your token:\\r\\n${TOKEN}'`);
      let out = '';
      p.onOutput((c) => (out += c));
      await new Promise<void>((r) => p.onExit(() => r()));
      expect(parseSignInOutput(out, { final: true }).token).toBe(TOKEN);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('stopping it leaves nothing running in its terminal', async () => {
    const home = mkdtempSync(join(tmpdir(), 'claude-test-'));
    const marker = `${Math.floor(Math.random() * 1e6) + 1000}`;
    const running = () =>
      readdirSync('/proc')
        .filter((d) => /^\d+$/.test(d))
        .filter((d) => {
          try {
            return readFileSync(`/proc/${d}/cmdline`, 'utf8').includes(marker);
          } catch {
            return false;
          }
        });
    try {
      // A child that ignores the polite signal and lives in the terminal's own session.
      const p = spawnInTerminal(home, `sh -c 'trap "" TERM HUP; sleep ${marker} & trap "" TERM HUP; sleep ${marker}'`);
      p.onOutput(() => {});
      await new Promise((r) => setTimeout(r, 500));
      expect(running().length).toBeGreaterThan(0);
      await p.kill();
      expect(running()).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 15_000);
});

describe('slots for Claude Code', () => {
  it('gives out at most its size, and the next in line gets one when it is given back', async () => {
    const slots = new Slots(1);
    const first = slots.tryTake();
    expect(first).not.toBeNull();
    expect(slots.tryTake()).toBeNull();
    const waiting = slots.take(1_000);
    first?.();
    first?.(); // giving it back twice frees it once
    const second = await waiting;
    expect(slots.tryTake()).toBeNull();
    second();
    expect(slots.tryTake()).not.toBeNull();
  });

  it('a wait that runs out says busy', async () => {
    const slots = new Slots(1);
    slots.tryTake();
    await expect(slots.take(10)).rejects.toThrow('busy');
  });
});

describe('outputForLog', () => {
  it('blanks tokens, the pasted code and long code-like runs', () => {
    const raw = '\x1b[32mPaste code here:\x1b[0m abcdEFGH1234567890abcdEFGH#xyz\r\nYour token: sk-ant-oat01-AAAAAAAAAAAAAAAAAAAAAAAA\r\nOAuth error: invalid_grant';
    const out = outputForLog(raw, ['abcdEFGH1234567890abcdEFGH#xyz']);
    expect(out).not.toContain('abcdEFGH');
    expect(out).not.toContain('AAAAAAAA');
    expect(out).toContain('sk-ant-[hidden]');
    expect(out).toContain('invalid_grant');
  });
});

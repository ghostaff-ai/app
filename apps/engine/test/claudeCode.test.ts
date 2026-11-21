import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { childEnv, parseSignInOutput, stripTerminal } from '../src/claudeCode';

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

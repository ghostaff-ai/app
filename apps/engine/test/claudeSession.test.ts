import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { type SignInProcess, Slots } from '../src/claudeCode';
import { claudeSession, type ClaudeSessionDeps, MAX_MESSAGE } from '../src/claudeSession';
import type { ConnectionRecord, Membership, Store } from '../src/connections';
import { NO_TOOLS } from '../src/tools';
import { aiSecretName, MemoryVault } from '../src/vault';

const ORG = '10000000-0000-0000-0000-000000000001';
const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=s1';
const TOKEN = `sk-ant-oat01-${'x'.repeat(90)}Wxyz`;
const CODE = 'abcdefghijklmnop#s1';

class FakeClaude implements SignInProcess {
  written: string[] = [];
  killed = false;
  private out: ((s: string) => void)[] = [];
  private exit: ((c: number | null) => void)[] = [];
  onOutput(cb: (s: string) => void) {
    this.out.push(cb);
  }
  onExit(cb: (c: number | null) => void) {
    this.exit.push(cb);
  }
  write(s: string) {
    this.written.push(s);
  }
  async kill() {
    this.killed = true;
  }
  print(s: string) {
    for (const cb of this.out) cb(s);
  }
  end(code: number) {
    for (const cb of this.exit) cb(code);
  }
}

function setup(over: Partial<ClaudeSessionDeps> = {}) {
  const members: Record<string, Membership> = {
    [`${ORG}/ana`]: { role: 'owner', displayName: 'Ana' },
    [`${ORG}/bea`]: { role: 'member', displayName: 'Bea' },
  };
  const rows: ConnectionRecord[] = [];
  const store: Store = {
    membership: async (o, u) => members[`${o}/${u}`] ?? null,
    insert: async (r) => {
      rows.push(r);
      return { provider: r.provider, method: r.method, hint: r.hint };
    },
    aiConnections: async () => [],
    remove: async () => {},
  };
  const vault = new MemoryVault();
  const claude = new FakeClaude();
  const homes = { made: 0, removed: 0 };
  const sent: Record<string, unknown>[] = [];
  let closed = 0;
  const deps: ClaudeSessionDeps = {
    store,
    vault,
    userFromToken: async (t) => (t.startsWith('token-') ? t.slice(6) : null),
    spawn: vi.fn(() => claude),
    makeHome: async () => {
      homes.made++;
      return { path: '/tmp/fake-home', remove: async () => void homes.removed++ };
    },
    now: () => new Date('2026-11-21T10:00:00Z'),
    slots: new Slots(4),
    signIns: new Map(),
    enterDelayMs: 0,
    ...over,
  };
  const session = claudeSession(deps, { send: (m) => sent.push(m), close: () => void closed++ });
  const say = (m: unknown) => session.onMessage(JSON.stringify(m));
  /** Another socket on the same engine, as a reconnect opens. */
  const socket = () => {
    const heard: Record<string, unknown>[] = [];
    let shut = 0;
    const s = claudeSession(deps, { send: (m) => heard.push(m), close: () => void shut++ });
    return { heard, say: (m: unknown) => s.onMessage(JSON.stringify(m)), session: s, closed: () => shut };
  };
  return { deps, session, say, socket, sent, rows, vault, claude, homes, closed: () => closed };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('connecting a Claude subscription', () => {
  it('an owner signs in: the link is passed on, the code fed in, the token kept in the vault and only its hint in the row', async () => {
    const t = setup();
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await flush();
    expect(t.deps.spawn).toHaveBeenCalledWith('/tmp/fake-home');
    t.claude.print(`Welcome\r\n\x1b]8;id=x;${URL}\x07${URL}\x1b]8;;\x07\r\nPaste code here if prompted >`);
    expect(t.sent).toEqual([{ type: 'url', url: URL, id: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) }]);

    t.say({ type: 'code', code: ` ${CODE} ` });
    expect(t.claude.written).toEqual([CODE]);
    await flush();
    // Enter goes on its own, or Claude Code takes it as part of a paste.
    expect(t.claude.written).toEqual([CODE, '\r']);
    expect(t.sent.at(-1)).toEqual({ type: 'working' });

    t.claude.print(`\r\nYour OAuth token (valid for 1 year):\r\n\r\n${TOKEN}\r\n\r\nStore this token securely.`);
    await flush();
    expect(t.rows).toHaveLength(1);
    expect(await t.vault.get(aiSecretName(ORG, t.rows[0]!.id))).toBe(TOKEN);
    expect(t.rows[0]).toMatchObject({ kind: 'ai', provider: 'claude', method: 'subscription', hint: 'Wxyz', connected_by_name: 'Ana', settings: {} });
    expect(JSON.stringify(t.rows)).not.toContain(TOKEN);
    expect(t.sent.at(-1)).toEqual({ type: 'done', connection: { provider: 'claude', method: 'subscription', hint: 'Wxyz' } });
    expect(JSON.stringify(t.sent)).not.toContain(TOKEN);
    await flush();
    expect(t.claude.killed).toBe(true);
    expect(t.homes).toEqual({ made: 1, removed: 1 });
    expect(t.closed()).toBe(1);
  });

  it('a member who is not an owner is refused, and Claude Code never starts', async () => {
    const t = setup();
    t.say({ type: 'start', token: 'token-bea', orgId: ORG });
    await flush();
    expect(t.sent).toEqual([{ type: 'error', code: 'not_owner' }]);
    expect(t.deps.spawn).not.toHaveBeenCalled();
    expect(t.closed()).toBe(1);
  });

  it('without a valid sign-in it is refused', async () => {
    const t = setup();
    t.say({ type: 'start', token: 'nope', orgId: ORG });
    await flush();
    expect(t.sent).toEqual([{ type: 'error', code: 'unauthorized' }]);
    expect(t.deps.spawn).not.toHaveBeenCalled();
  });

  it('a code before the link, or anything out of turn, ends it', async () => {
    const t = setup();
    t.say({ type: 'code', code: CODE });
    expect(t.sent).toEqual([{ type: 'error', code: 'bad_request' }]);
    expect(t.deps.spawn).not.toHaveBeenCalled();
  });

  it('a code Claude Code refuses is said so, and nothing is stored', async () => {
    const t = setup();
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await flush();
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    t.say({ type: 'code', code: CODE });
    t.claude.print('\x1b[38;2;255;107;128mOAuth error: Invalid code. Please make sure the full code was copied');
    expect(t.sent.at(-1)).toEqual({ type: 'error', code: 'bad_code' });
    expect(t.vault.secrets.size).toBe(0);
    expect(t.rows).toHaveLength(0);
    expect(t.claude.killed).toBe(true);
  });

  it('something that is not a code is not typed into Claude Code', async () => {
    const t = setup();
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await flush();
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    t.say({ type: 'code', code: 'abc\x03; rm -rf /' });
    expect(t.claude.written).toEqual([]);
    expect(t.sent.at(-1)).toEqual({ type: 'error', code: 'bad_code' });
  });

  it('gives up when the token does not come within its time', async () => {
    vi.useFakeTimers();
    const t = setup({ tokenTimeoutMs: 90_000 });
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await vi.advanceTimersByTimeAsync(0);
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    t.say({ type: 'code', code: CODE });
    await vi.advanceTimersByTimeAsync(89_000);
    expect(t.sent.at(-1)).toEqual({ type: 'working' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.sent.at(-1)).toEqual({ type: 'error', code: 'timeout' });
    expect(t.claude.killed).toBe(true);
    expect(t.homes.removed).toBe(1);
  });

  it('the whole session ends after its limit, even waiting for the person', async () => {
    vi.useFakeTimers();
    const t = setup({ sessionTimeoutMs: 600_000 });
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await vi.advanceTimersByTimeAsync(0);
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    await vi.advanceTimersByTimeAsync(600_001);
    expect(t.sent.at(-1)).toEqual({ type: 'error', code: 'timeout' });
    expect(t.claude.killed).toBe(true);
  });

  it('says Claude Code is unavailable when it prints no link in time', async () => {
    vi.useFakeTimers();
    const t = setup({ urlTimeoutMs: 30_000 });
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(t.sent).toEqual([{ type: 'error', code: 'claude_unavailable' }]);
    expect(t.claude.killed).toBe(true);
  });

  it('says so when Claude Code exits before the link', async () => {
    const t = setup();
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await flush();
    t.claude.end(1);
    expect(t.sent).toEqual([{ type: 'error', code: 'claude_unavailable' }]);
  });

  it('the person leaving before the link kills Claude Code and cleans its HOME', async () => {
    const t = setup();
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await flush();
    t.session.onClose();
    await flush();
    expect(t.claude.killed).toBe(true);
    expect(t.homes.removed).toBe(1);
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    t.claude.print(TOKEN); // too late: nothing is sent or stored
    await flush();
    expect(t.sent).toEqual([]);
    expect(t.vault.secrets.size).toBe(0);
  });

  it('the person leaving after the code was sent ends it, as before', async () => {
    const t = setup();
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await flush();
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    t.say({ type: 'code', code: CODE });
    t.session.onClose();
    await flush();
    expect(t.claude.killed).toBe(true);
  });
});

describe('a sign-in that outlives its socket (the person leaves the app to sign in)', () => {
  const toLink = async (t: ReturnType<typeof setup>) => {
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await flush();
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    return t.sent[0]?.id as string;
  };

  it('the socket dropping while it waits for the code leaves Claude Code running', async () => {
    const t = setup();
    await toLink(t);
    t.session.onClose();
    await flush();
    expect(t.claude.killed).toBe(false);
    expect(t.homes.removed).toBe(0);
  });

  it('the same person resumes on a new socket, and the code reaches Claude Code', async () => {
    const t = setup();
    const id = await toLink(t);
    t.session.onClose();
    const again = t.socket();
    again.say({ type: 'resume', token: 'token-ana', orgId: ORG, id });
    again.say({ type: 'code', code: CODE }); // sent before the resume is checked: it waits its turn
    await flush();
    expect(again.heard).toEqual([{ type: 'resumed' }, { type: 'working' }]);
    await flush();
    expect(t.claude.written).toEqual([CODE, '\r']);
    t.claude.print(`\r\n${TOKEN}\r\n`);
    await flush();
    expect(again.heard.at(-1)).toMatchObject({ type: 'done' });
    expect(await t.vault.get(aiSecretName(ORG, t.rows[0]!.id))).toBe(TOKEN);
    expect(again.closed()).toBe(1);
  });

  it('a second resume replaces the first socket', async () => {
    const t = setup();
    const id = await toLink(t);
    t.session.onClose();
    const one = t.socket();
    one.say({ type: 'resume', token: 'token-ana', orgId: ORG, id });
    await flush();
    const two = t.socket();
    two.say({ type: 'resume', token: 'token-ana', orgId: ORG, id });
    await flush();
    expect(one.closed()).toBe(1);
    one.session.onClose(); // the old socket closing does not end the sign-in
    two.say({ type: 'code', code: CODE });
    expect(t.claude.written).toEqual([CODE]);
    expect(two.heard.at(-1)).toEqual({ type: 'working' });
  });

  it('someone else, or another organisation, cannot resume it', async () => {
    const t = setup();
    const id = await toLink(t);
    t.session.onClose();
    const bea = t.socket();
    bea.say({ type: 'resume', token: 'token-bea', orgId: ORG, id });
    await flush();
    expect(bea.heard).toEqual([{ type: 'error', code: 'expired' }]);
    const elsewhere = t.socket();
    elsewhere.say({ type: 'resume', token: 'token-ana', orgId: '10000000-0000-0000-0000-000000000002', id });
    await flush();
    expect(elsewhere.heard).toEqual([{ type: 'error', code: 'expired' }]);
    const unsigned = t.socket();
    unsigned.say({ type: 'resume', token: 'nope', orgId: ORG, id });
    await flush();
    expect(unsigned.heard).toEqual([{ type: 'error', code: 'unauthorized' }]);
    expect(t.claude.killed).toBe(false);
    expect(t.claude.written).toEqual([]);
  });

  it('an unknown id has expired', async () => {
    const t = setup();
    const s = t.socket();
    s.say({ type: 'resume', token: 'token-ana', orgId: ORG, id: 'x'.repeat(43) });
    await flush();
    expect(s.heard).toEqual([{ type: 'error', code: 'expired' }]);
    expect(s.closed()).toBe(1);
  });

  it('the whole limit still ends a detached sign-in, and its id expires', async () => {
    vi.useFakeTimers();
    const t = setup({ sessionTimeoutMs: 600_000 });
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await vi.advanceTimersByTimeAsync(0);
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    const id = t.sent[0]?.id as string;
    t.session.onClose();
    await vi.advanceTimersByTimeAsync(600_001);
    expect(t.claude.killed).toBe(true);
    expect(t.homes.removed).toBe(1);
    expect(t.deps.signIns?.size).toBe(0);
    const late = t.socket();
    late.say({ type: 'resume', token: 'token-ana', orgId: ORG, id });
    await vi.advanceTimersByTimeAsync(0);
    expect(late.heard).toEqual([{ type: 'error', code: 'expired' }]);
  });
});

describe('the sign-in, against what can go wrong', () => {
  const toCode = async (t: ReturnType<typeof setup>) => {
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await flush();
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    t.say({ type: 'code', code: CODE });
  };

  it('takes a token that is the very last thing Claude Code printed before ending', async () => {
    const t = setup();
    await toCode(t);
    t.claude.print(`\r\n${TOKEN}`); // nothing after it yet: not taken while it runs
    await flush();
    expect(t.vault.secrets.size).toBe(0);
    t.claude.end(0);
    await flush();
    expect(await t.vault.get(aiSecretName(ORG, t.rows[0]!.id))).toBe(TOKEN);
    expect(t.sent.at(-1)).toMatchObject({ type: 'done' });
  });

  it('ending without a token after the code is a refused code', async () => {
    const t = setup();
    await toCode(t);
    t.claude.end(1);
    expect(t.sent.at(-1)).toEqual({ type: 'error', code: 'bad_code' });
  });

  it('never takes something printed before the code for the token', async () => {
    const t = setup();
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await flush();
    t.claude.print(`\x1b]8;id=x;${URL}\x07 ${TOKEN}\r\n`);
    t.say({ type: 'code', code: CODE });
    t.claude.print(`${CODE}\r\n`); // the terminal's echo
    await flush();
    expect(t.vault.secrets.size).toBe(0);
    expect(t.sent.at(-1)).toEqual({ type: 'working' });
  });

  it('refuses a pasted Anthropic key or token as the code', async () => {
    const t = setup();
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await flush();
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    t.say({ type: 'code', code: TOKEN });
    expect(t.claude.written).toEqual([]);
    expect(t.sent.at(-1)).toEqual({ type: 'error', code: 'bad_code' });
  });

  it('an open socket that never says who it is, is closed', async () => {
    vi.useFakeTimers();
    const t = setup({ startTimeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(t.sent).toEqual([{ type: 'error', code: 'unauthorized' }]);
    expect(t.closed()).toBe(1);
  });

  it('an oversized message is not even read', async () => {
    const t = setup();
    t.session.onMessage(`{"type":"start","token":"${'x'.repeat(MAX_MESSAGE)}"}`);
    expect(t.sent).toEqual([{ type: 'error', code: 'bad_request' }]);
    expect(t.deps.spawn).not.toHaveBeenCalled();
  });

  it('a save that hangs ends as a failure', async () => {
    vi.useFakeTimers();
    const vault = new MemoryVault();
    vault.put = () => new Promise(() => {});
    const t = setup({ vault, saveTimeoutMs: 20_000 });
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await vi.advanceTimersByTimeAsync(0);
    t.claude.print(`\x1b]8;id=x;${URL}\x07`);
    t.say({ type: 'code', code: CODE });
    t.claude.print(`\r\n${TOKEN}\r\n`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(20_001);
    expect(t.sent.at(-1)).toEqual({ type: 'error', code: 'failed' });
    expect(t.closed()).toBe(1);
  });

  it('waits for a free Claude Code slot, and gives it back at the end', async () => {
    vi.useFakeTimers();
    const slots = new Slots(1);
    const busy = slots.tryTake();
    const t = setup({ slots });
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.deps.spawn).not.toHaveBeenCalled();
    busy?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.deps.spawn).toHaveBeenCalled();
    t.session.onClose();
    await vi.advanceTimersByTimeAsync(0);
    expect(slots.tryTake()).not.toBeNull();
  });

  it('says Claude Code is unavailable when no slot frees up', async () => {
    vi.useFakeTimers();
    const slots = new Slots(1);
    slots.tryTake();
    const t = setup({ slots });
    t.say({ type: 'start', token: 'token-ana', orgId: ORG });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(t.sent).toEqual([{ type: 'error', code: 'claude_unavailable' }]);
    expect(t.deps.spawn).not.toHaveBeenCalled();
  });
});

describe('the sign-in over a real WebSocket', () => {
  it('runs through the engine route, the Supabase token in the first message', async () => {
    const claude = new FakeClaude();
    const rows: ConnectionRecord[] = [];
    const vault = new MemoryVault();
    const app = createApp({
      store: {
        membership: async () => ({ role: 'owner', displayName: 'Ana' }),
        insert: async (r) => {
          rows.push(r);
          return { id: r.id, provider: r.provider, hint: r.hint };
        },
        aiConnections: async () => [],
        remove: async () => {},
      },
      vault,
      checks: {} as never,
      userFromToken: async (t) => (t === 'token-ana' ? 'ana' : null),
      chat: { chat: {} as never, writerFor: async () => async () => {}, toolsFor: async () => NO_TOOLS },
      accounts: {} as never,
      actions: {} as never,
      claudeSignIn: {
        spawn: () => claude,
        makeHome: async () => ({ path: '/tmp/fake-home', remove: async () => {} }),
      },
    });
    const server = serve({ fetch: app.fetch, port: 0 });
    app.injectWebSocket(server);
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    try {
      // A message over the size limit closes the socket before anything is read.
      const big = new WebSocket(`ws://127.0.0.1:${port}/connections/ai/claude/session`);
      await new Promise((r) => big.addEventListener('open', r));
      const bigClosed = new Promise<number>((r) => big.addEventListener('close', (e) => r(e.code)));
      big.send('x'.repeat(MAX_MESSAGE + 1));
      expect(await bigClosed).toBe(1009);

      const ws = new WebSocket(`ws://127.0.0.1:${port}/connections/ai/claude/session`);
      const heard: Record<string, unknown>[] = [];
      const closed = new Promise<void>((r) => ws.addEventListener('close', () => r()));
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(String(e.data));
        heard.push(m);
        if (m.type === 'url') ws.send(JSON.stringify({ type: 'code', code: CODE }));
        if (m.type === 'working') claude.print(`\r\n${TOKEN}\r\n`);
      });
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'start', token: 'token-ana', orgId: ORG }));
        setTimeout(() => claude.print(`\x1b]8;id=x;${URL}\x07`), 50);
      });
      await closed;
      expect(heard.map((m) => m.type)).toEqual(['url', 'working', 'done']);
      expect(claude.written[0]).toBe(CODE);
      expect(await vault.get(aiSecretName(ORG, rows[0]!.id))).toBe(TOKEN);
      expect(rows[0]?.hint).toBe('Wxyz');
    } finally {
      server.close();
    }
  });
});

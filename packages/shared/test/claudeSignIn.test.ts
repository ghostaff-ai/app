import { describe, expect, it } from 'vitest';
import type { ClaudeSessionEvent } from '../src/models';
import { connectClaudeSubscription } from '../src/services';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static last: FakeSocket;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  /** The phone drops it. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  hear(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const ROW = {
  id: 'c1',
  org_id: 'o1',
  kind: 'ai',
  provider: 'claude',
  method: 'subscription',
  hint: 'wxyz',
  settings: {},
  status: 'ok',
  checked_at: '2026-11-21T10:00:00Z',
  connected_by_name: 'Ana',
  updated_at: '2026-11-21T10:00:00Z',
};

describe('connecting a Claude subscription', () => {
  it('opens the WebSocket, sends the token first, then the code, and hears the connection', () => {
    const heard: ClaudeSessionEvent[] = [];
    const s = connectClaudeSubscription({ url: 'https://engine.example/', token: 'tok' }, 'o1', (e) => heard.push(e), {
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    const ws = FakeSocket.last;
    expect(ws.url).toBe('wss://engine.example/connections/ai/claude/session');
    ws.open();
    expect(ws.sent).toEqual([{ type: 'start', token: 'tok', orgId: 'o1' }]);
    ws.hear({ type: 'url', url: 'https://claude.com/cai/oauth/authorize?x=1' });
    s.sendCode('  the-code#state ');
    expect(ws.sent.at(-1)).toEqual({ type: 'code', code: 'the-code#state' });
    ws.hear({ type: 'working' });
    ws.hear({ type: 'done', connection: ROW });
    ws.onclose?.();
    expect(heard.map((e) => e.type)).toEqual(['url', 'working', 'done']);
    expect(heard[2]).toMatchObject({ connection: { provider: 'claude', method: 'subscription', hint: 'wxyz', connectedByName: 'Ana' } });
  });

  it('a refusal is heard once, and a socket that just drops reads as unreachable', () => {
    const heard: ClaudeSessionEvent[] = [];
    connectClaudeSubscription({ url: 'http://localhost:8787', token: 't' }, 'o1', (e) => heard.push(e), {
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    expect(FakeSocket.last.url).toBe('ws://localhost:8787/connections/ai/claude/session');
    FakeSocket.last.hear({ type: 'error', code: 'not_owner' });
    FakeSocket.last.onclose?.();
    expect(heard).toEqual([{ type: 'error', code: 'not_owner' }]);

    const dropped: ClaudeSessionEvent[] = [];
    connectClaudeSubscription({ url: 'http://localhost:8787', token: 't' }, 'o1', (e) => dropped.push(e), {
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    FakeSocket.last.onclose?.();
    expect(dropped).toEqual([{ type: 'error', code: 'unreachable' }]);
  });

  it('cancelling closes it and says nothing more', () => {
    const heard: ClaudeSessionEvent[] = [];
    const s = connectClaudeSubscription({ url: 'http://e', token: 't' }, 'o1', (e) => heard.push(e), {
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    s.cancel();
    FakeSocket.last.onclose?.();
    expect(FakeSocket.last.closed).toBe(true);
    expect(heard).toEqual([]);
  });

  const WS = { WebSocket: FakeSocket as unknown as typeof WebSocket };
  const toCodeStep = (heard: ClaudeSessionEvent[]) => {
    const s = connectClaudeSubscription({ url: 'https://engine.example', token: 'tok' }, 'o1', (e) => heard.push(e), WS);
    const first = FakeSocket.last;
    first.open();
    first.hear({ type: 'url', url: 'https://claude.ai/oauth/authorize?x', id: 'resume-id' });
    return { s, first };
  };

  it('the socket dropping while it waits for the code is not an error', () => {
    const heard: ClaudeSessionEvent[] = [];
    toCodeStep(heard).first.drop();
    expect(heard.map((e) => e.type)).toEqual(['url']);
  });

  it('a code sent after the socket dropped opens a new one, resumes, then sends the code', () => {
    const heard: ClaudeSessionEvent[] = [];
    const { s, first } = toCodeStep(heard);
    first.drop();
    s.sendCode(' the-code#state ', { url: 'https://engine.example', token: 'fresh' });
    const again = FakeSocket.last;
    expect(again).not.toBe(first);
    again.open();
    expect(again.sent).toEqual([{ type: 'resume', token: 'fresh', orgId: 'o1', id: 'resume-id' }]);
    again.hear({ type: 'resumed' });
    expect(again.sent.at(-1)).toEqual({ type: 'code', code: 'the-code#state' });
    again.hear({ type: 'working' });
    again.hear({ type: 'done', connection: ROW });
    expect(heard.map((e) => e.type)).toEqual(['url', 'working', 'done']);
  });

  it('coming back to the app reconnects, so the code goes straight in', () => {
    const heard: ClaudeSessionEvent[] = [];
    const { s, first } = toCodeStep(heard);
    first.drop();
    s.reconnect();
    const again = FakeSocket.last;
    again.open();
    again.hear({ type: 'resumed' });
    s.sendCode('the-code#state');
    expect(again.sent).toEqual([
      { type: 'resume', token: 'tok', orgId: 'o1', id: 'resume-id' },
      { type: 'code', code: 'the-code#state' },
    ]);
    s.reconnect(); // already connected: nothing more
    expect(FakeSocket.last).toBe(again);
  });

  it('a sign-in the engine no longer has says expired', () => {
    const heard: ClaudeSessionEvent[] = [];
    const { s, first } = toCodeStep(heard);
    first.drop();
    s.sendCode('the-code#state');
    FakeSocket.last.open();
    FakeSocket.last.hear({ type: 'error', code: 'expired' });
    expect(heard.at(-1)).toEqual({ type: 'error', code: 'expired' });
  });

  it('the engine unreachable while sending the code is an error', () => {
    const heard: ClaudeSessionEvent[] = [];
    const { s, first } = toCodeStep(heard);
    first.drop();
    s.sendCode('the-code#state');
    FakeSocket.last.drop();
    expect(heard.at(-1)).toEqual({ type: 'error', code: 'unreachable' });
  });
});

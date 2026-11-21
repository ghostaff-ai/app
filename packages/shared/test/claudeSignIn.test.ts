import { describe, expect, it } from 'vitest';
import type { ClaudeSessionEvent } from '../src/models';
import { connectClaudeSubscription } from '../src/services';

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.closed = true;
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
});

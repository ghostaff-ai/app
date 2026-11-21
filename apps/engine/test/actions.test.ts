import type { ActionPart } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import { type ActionRecord, type ActionStore, approveAction, previewOf, rejectAction } from '../src/actions';
import { createApp } from '../src/app';
import type { Membership } from '../src/connections';
import type { AgentTools } from '../src/tools';

const ORG = '10000000-0000-0000-0000-000000000001';
const ACTION = '50000000-0000-0000-0000-000000000001';

function setup(opts: { state?: 'working' | 'done'; fails?: boolean } = {}) {
  const members: Record<string, Membership> = {
    ana: { role: 'owner', displayName: 'Ana' },
    bea: { role: 'member', displayName: 'Bea' },
  };
  const record: ActionRecord = {
    id: ACTION,
    orgId: ORG,
    threadId: 't',
    messageId: 'm',
    tool: 'instagram_publish',
    input: { kind: 'reel' },
    label: 'Publicar en Instagram',
    status: 'pending',
    messageState: opts.state ?? 'done',
  };
  const cards: Array<Partial<ActionPart>> = [];
  const ran: Array<{ name: string; input: unknown }> = [];
  const actions: ActionStore = {
    membership: async (o, u) => (o === ORG ? (members[u] ?? null) : null),
    action: async (id) => (id === ACTION ? record : null),
    claim: async (_id, to) => {
      if (record.status !== 'pending') return false;
      record.status = to;
      return true;
    },
    settle: async (_id, status, result) => {
      record.status = status;
      cards.push({ status, result });
    },
    updateCard: async (_m, _a, patch) => {
      cards.push(patch);
    },
  };
  const tools: AgentTools = {
    specs: [],
    accounts: [],
    stepFor: () => '',
    writes: () => true,
    actionFor: () => '',
    run: async (name, input) => {
      ran.push({ name, input });
      return opts.fails ? { content: 'Instagram no deja hacerlo.', isError: true } : { content: '{"published":true,"link":"https://ig/p/1"}', isError: false };
    },
  };
  const app = createApp({
    store: {} as never,
    vault: {} as never,
    checks: {} as never,
    userFromToken: async (t) => (t.startsWith('token-') ? t.slice(6) : null),
    serviceAccount: '',
    chat: {} as never,
    accounts: {} as never,
    actions: { actions, toolsFor: async () => tools },
  });
  const press = (user: string, what: 'approve' | 'reject', id = ACTION) =>
    app.request(`/actions/${id}/${what}`, { method: 'POST', headers: { Authorization: `Bearer token-${user}` } });
  return { record, cards, ran, press, deps: { actions, toolsFor: async () => tools } };
}

describe('approving what an agent proposes', () => {
  it('an owner approves: it runs once, from the stored action, and the card says how it went', async () => {
    const { press, ran, cards, record } = setup();
    const res = await press('ana', 'approve');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'done', result: '{"published":true,"link":"https://ig/p/1"}' });
    expect(ran).toEqual([{ name: 'instagram_publish', input: { kind: 'reel' } }]);
    expect(cards[0]).toEqual({ status: 'running', decidedBy: 'Ana' });
    expect(cards.at(-1)).toMatchObject({ status: 'done', decidedBy: 'Ana' });
    expect(record.status).toBe('done');
    expect((await press('ana', 'approve')).status).toBe(409);
    expect(ran).toHaveLength(1);
  });

  it('a member cannot approve, and hears what an outsider hears', async () => {
    const { press, ran } = setup();
    const member = await press('bea', 'approve');
    const outsider = await press('zoe', 'approve');
    expect(member.status).toBe(403);
    expect(await outsider.json()).toEqual(await member.json());
    expect(ran).toHaveLength(0);
  });

  it('a failure is recorded as failed, with the tool\'s words', async () => {
    const { deps, record } = setup({ fails: true });
    expect(await approveAction(deps, 'ana', ACTION)).toEqual({ status: 'failed', result: 'Instagram no deja hacerlo.' });
    expect(record.status).toBe('failed');
  });

  it('rejecting runs nothing; nothing is decided while the agent is still writing', async () => {
    const rejected = setup();
    expect(await rejectAction(rejected.deps, 'ana', ACTION)).toEqual({ status: 'rejected' });
    expect(rejected.ran).toHaveLength(0);
    expect((await rejected.press('ana', 'approve')).status).toBe(409);

    const writing = setup({ state: 'working' });
    expect((await writing.press('ana', 'approve')).status).toBe(409);
    expect((await writing.press('ana', 'approve', 'not-a-uuid')).status).toBe(400);
  });

  it('the card shows the input field by field, long values cut', () => {
    expect(previewOf({ caption: 'Hola', media: ['https://a/1.jpg'] })).toBe('caption: Hola\nmedia: ["https://a/1.jpg"]');
    expect(previewOf({ text: 'x'.repeat(500) }).length).toBeLessThan(420);
  });
});

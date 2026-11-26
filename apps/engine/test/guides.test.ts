import type { AccountAskPart, ChatMessage, GuideLanding, GuidePart, GuideStep, MessagePart } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { type ChatAgent, type ChatDeps, type ChatStore, type ChatThreadHead, type Level, toTurns, type Writer } from '../src/chat';
import type { AskRecord, AskStore } from '../src/accountAsks';
import type { Membership } from '../src/connections';
import type { GuidedStore } from '../src/guidedAccounts';
import { FALLBACK_STEP, SHOW_STEP } from '../src/guideModel';
import { GUIDE_TOOL, type GuideRecord, type GuideStore } from '../src/guides';
import { NO_TOOLS } from '../src/tools';
import { guidedSecretName, MemoryVault } from '../src/vault';

const ORG = '10000000-0000-0000-0000-000000000001';
const REDES = '20000000-0000-0000-0000-000000000002';
const THREAD = '30000000-0000-0000-0000-000000000001';
const MESSAGE = '40000000-0000-0000-0000-000000000001';
const redes: ChatAgent = { id: REDES, orgId: ORG, name: 'Redes', ghost: 'redes', department: 'marketing' };

const wordpress: GuideLanding = {
  auth: 'basic',
  suffix: '/wp-json',
  check: { path: '/wp/v2/users/me?context=edit', expect: { field: 'roles', includes: 'editor' } },
};

const PASSWORD = 'abcd efgh ijkl mnop';
const VALUES = { base_url: 'miweb.com ', username: 'redes@panaderia.ghostaff.ai', password: PASSWORD };

const openUsers: GuideStep = { blocks: [{ type: 'title', text: 'Abre Usuarios' }, { type: 'confirm' }] };

let n = 0;
function msg(p: Partial<ChatMessage> & { text: string }): ChatMessage {
  n += 1;
  return {
    id: `m${n}`,
    threadId: THREAD,
    authorKind: 'person',
    authorUserId: 'ana',
    authorAgentId: null,
    authorName: 'Ana',
    parts: [{ type: 'text', text: p.text }],
    state: 'done',
    steps: [],
    createdAt: new Date(2026, 10, 24, 10, n).toISOString(),
    ...p,
  };
}

/** The guides in memory: every move is the conditional update the database makes. */
function memoryGuides() {
  const rows = new Map<string, GuideRecord>();
  const cards: Array<{ messageId: string; guideId: string; patch: Partial<GuidePart>; add?: MessagePart }> = [];
  let clock = 0;
  const members: Record<string, Membership> = {
    ana: { role: 'owner', displayName: 'Ana' },
    luis: { role: 'member', displayName: 'Luis' },
    bea: { role: 'member', displayName: 'Bea' },
  };
  const store: GuideStore = {
    create: async (g) => {
      const id = `60000000-0000-0000-0000-00000000000${rows.size + 1}`;
      rows.set(id, {
        ...g,
        id,
        history: [],
        status: 'open',
        blockedReason: null,
        undo: null,
        completedBy: null,
        decidedBy: null,
        resumedAt: null,
        updatedAt: `t${clock++}`,
        messageState: 'done',
      });
      return id;
    },
    guide: async (id) => {
      const r = rows.get(id);
      return r ? structuredClone(r) : null;
    },
    update: async (id, cond, patch) => {
      const r = rows.get(id);
      if (!r || r.status !== cond.status) return false;
      if (cond.updatedAt !== undefined && r.updatedAt !== cond.updatedAt) return false;
      if (cond.notResumed && r.resumedAt) return false;
      Object.assign(r, structuredClone(patch), { updatedAt: `t${clock++}` });
      return true;
    },
    // As the database does it: resumed_at alone, with updated_at left as it was.
    claimResume: async (id) => {
      const r = rows.get(id);
      if (!r || r.status !== 'done' || r.resumedAt) return false;
      r.resumedAt = new Date().toISOString();
      return true;
    },
    releaseResume: async (id) => {
      const r = rows.get(id);
      if (r && r.status === 'done') r.resumedAt = null;
    },
    pending: async (orgId) =>
      [...rows.values()]
        .filter((r) => r.orgId === orgId && r.status === 'checked')
        .map((r) => ({
          id: r.id,
          app: r.app,
          agentId: r.agentId,
          agentName: 'Redes',
          completedByName: (r.completedBy && members[r.completedBy]?.displayName) || 'Alguien',
          checkedAt: r.history.flatMap((e) => (e.type === 'checked' && e.at ? [e.at] : []))[0] ?? r.updatedAt,
        })),
    updateCard: async (messageId, guideId, patch, add) => {
      cards.push({ messageId, guideId, patch, ...(add ? { add } : {}) });
    },
    membership: async (_org, userId) => members[userId] ?? null,
    identity: async () => ({ orgSlug: 'panaderia', agent: { slug: 'redes', name: 'Redes' } }),
  };
  const seed = async (landing: GuideLanding = wordpress) =>
    store.create({ orgId: ORG, threadId: THREAD, messageId: MESSAGE, agentId: REDES, app: 'WordPress', goal: 'Redes publica borradores en tu web', why: 'Para publicar', landing, startedBy: 'luis' });
  return { store, rows, cards, seed };
}

function memoryAccesses() {
  const created: Array<Parameters<GuidedStore['createAccess']>[0]> = [];
  /** The guide whose access the next createAccess replaces, as the store reports it. */
  const replacing: { guideId: string | null } = { guideId: null };
  /** The accesses that exist, by connection id; `removeFails` makes the next row removal throw. */
  const rows = new Map<string, { orgId: string; guideId: string; app: string }>();
  const flags = { removeFails: false };
  const store: GuidedStore = {
    accesses: async () => [],
    find: async (id) => rows.get(id) ?? null,
    removeAccess: async (id) => {
      if (flags.removeFails) throw new Error('database down');
      rows.delete(id);
    },
    createAccess: async (a) => {
      created.push(a);
      const replacedGuideId = replacing.guideId;
      replacing.guideId = null;
      return { id: `70000000-0000-0000-0000-00000000000${created.length}`, replacedGuideId };
    },
  };
  return { store, created, replacing, rows, flags };
}

/** Asking for an account, in memory, as accountAsks.ts records it. */
function memoryAsks() {
  const states = new Map<string, 'ok' | 'failing'>();
  const rows = new Map<string, AskRecord>();
  const proposed: Array<Parameters<AskStore['propose']>[0]> = [];
  const store: AskStore = {
    accountStates: async () => new Map(states),
    propose: async (a) => {
      proposed.push(a);
      const id = `80000000-0000-0000-0000-00000000000${rows.size + 1}`;
      rows.set(id, { id, orgId: a.orgId, threadId: a.threadId, messageId: a.messageId, agentId: a.agentId, connector: a.connector, name: a.name, need: a.need, status: 'open', messageState: 'done' });
      return id;
    },
    ask: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
    claim: async (id) => {
      const r = rows.get(id);
      if (!r || r.status !== 'open') return false;
      r.status = 'done';
      return true;
    },
    reopen: async (id) => {
      rows.get(id)!.status = 'open';
    },
    updateCard: async () => {},
    memberName: async (_o, u) => ({ ana: 'Ana', luis: 'Luis' })[u] ?? null,
  };
  return { store, states, rows, proposed };
}

function setup(
  opts: {
    write?: Writer;
    messages?: ChatMessage[];
    levels?: Record<string, Level>;
    /** Each person's level on the guide's conversation, when it differs from their level on the agent (a personal chat). */
    threadLevels?: Record<string, Level>;
    noAccount?: boolean;
    fetchStatus?: number;
    asks?: AskStore;
  } = {},
) {
  const levels = opts.levels ?? { ana: 'talk', luis: 'talk', bea: 'read' };
  const threadLevels = opts.threadLevels ?? levels;
  const guides = memoryGuides();
  const accesses = memoryAccesses();
  const vault = new MemoryVault();
  const messages = opts.messages ?? [msg({ text: 'Publica un borrador en mi web' })];
  const updates: Array<{ id: string; text?: string; state?: string; cards?: unknown[] }> = [];
  const asked: Array<Parameters<Writer>[0]> = [];
  const fetched: string[] = [];
  let working: string | null = null;
  const threads: ChatThreadHead[] = [{ id: THREAD, orgId: ORG, agentId: REDES, title: 'Web' }];
  const chat: ChatStore = {
    levelFor: async (_a, u) => levels[u] ?? 'none',
    threadLevelFor: async (_t, u) => threadLevels[u] ?? 'none',
    thread: async (id) => threads.find((t) => t.id === id) ?? null,
    agent: async (id) => (id === REDES ? redes : null),
    orgAgents: async () => [redes],
    orgName: async () => 'Panadería',
    memberNames: async () => ['Ana', 'Luis', 'Bea'],
    recentMessages: async () => messages,
    conversation: async () => ({ summary: null, messages }),
    saveSummary: async () => true,
    searchMessages: async () => [],
    startReply: async () => {
      if (working) return null;
      working = MESSAGE;
      return working;
    },
    updateReply: async (id, patch) => {
      updates.push({ id, ...patch });
      if (patch.state && patch.state !== 'working') {
        working = null;
        messages.push(msg({ id, authorKind: 'agent', authorAgentId: REDES, authorUserId: null, authorName: 'Redes', text: patch.text ?? '' }));
      }
    },
    touchThread: async () => {},
    personalChat: async () => THREAD,
    aiAccounts: async () => (opts.noAccount ? [] : [{ id: 'key-1', provider: 'anthropic' }]),
    recordAiUse: async () => {},
    proposeAction: async () => 'action-1',
    deleteMessage: async () => {},
  };
  let write: Writer =
    opts.write ??
    (async ({ onText }) => {
      onText('Vale.');
    });
  const chatDeps: ChatDeps = {
    chat,
    flushMs: 0,
    writerFor: async () => async (req) => {
      asked.push(req);
      await write(req);
    },
    toolsFor: async () => NO_TOOLS,
    guides: guides.store,
    asks: opts.asks,
  };
  const f = (async (input: Parameters<typeof fetch>[0]) => {
    fetched.push(String(input));
    if (opts.fetchStatus && opts.fetchStatus !== 200) return new Response('{}', { status: opts.fetchStatus });
    return new Response(JSON.stringify({ id: 7, roles: ['editor'] }), { status: 200 });
  }) as typeof fetch;
  const app = createApp({
    store: {} as never,
    vault,
    checks: {} as never,
    userFromToken: async (t) => (t.startsWith('token-') ? t.slice(6) : null),
    chat: chatDeps,
    accounts: {} as never,
    actions: {} as never,
    guides: { chat: chatDeps, store: guides.store, accesses: accesses.store, vault, fetch: f },
  });
  const call = (user: string, path: string, body?: unknown, method = 'POST') =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer token-${user}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  return {
    call,
    get: (user: string, path: string) => call(user, path, undefined, 'GET'),
    guides,
    accesses,
    vault,
    updates,
    asked,
    fetched,
    messages,
    answerWith: (w: Writer) => {
      write = w;
    },
  };
}

/** A writer that sends one step through the guide's tool, as the model would. */
const stepping =
  (step: unknown): Writer =>
  async ({ tools, onTool }) => {
    onTool(SHOW_STEP);
    await tools.run(SHOW_STEP, step);
  };

const START = {
  app: 'WordPress',
  goal: 'Redes publica borradores en tu web',
  why: 'Para publicar el borrador que me pides',
  auth: 'basic',
  base_suffix: '/wp-json',
  check_path: '/wp/v2/users/me?context=edit',
  expect: { field: 'roles', includes: 'editor' },
};

describe('starting a guide from the chat', () => {
  it('offers every agent the tool and the prompt line on when to use it, beside asking for an account', async () => {
    const asks = { accountStates: async () => new Map() } as unknown as AskStore;
    const s = setup({ asks });
    await s.call('luis', `/threads/${THREAD}/reply`);
    expect(s.asked[0]?.tools.specs.map((x) => x.name)).toEqual(expect.arrayContaining([GUIDE_TOOL, 'ask_for_account']));
    expect(s.asked[0]?.system).toContain(
      `Usa ask_for_account cuando la app está en el catálogo y se conecta con un botón; usa ${GUIDE_TOOL} cuando hace falta que la persona haga algo en la app (crearte un usuario, una clave), por ejemplo un WordPress que no está en WordPress.com.`,
    );
    const alone = setup();
    await alone.call('luis', `/threads/${THREAD}/reply`);
    expect(alone.asked[0]?.system).toContain(`WordPress que no está en WordPress.com, usa ${GUIDE_TOOL}`);
  });

  it('one guide per message: the card in the message, the row recorded, the second refused', async () => {
    const told: unknown[] = [];
    const s = setup({
      write: async ({ tools, onText }) => {
        told.push(await tools.run(GUIDE_TOOL, START));
        told.push(await tools.run(GUIDE_TOOL, { ...START, app: 'Shopify' }));
        onText('Cuando tenga el acceso, publico el borrador.');
      },
    });
    await s.call('luis', `/threads/${THREAD}/reply`);
    expect(told[0]).toEqual({ isError: false, content: 'Guía mostrada: termina el mensaje diciendo qué harás cuando tengas el acceso' });
    expect(told[1]).toMatchObject({ isError: true });
    const [id] = [...s.guides.rows.keys()];
    expect(s.guides.rows.size).toBe(1);
    expect(s.updates.at(-1)).toMatchObject({
      state: 'done',
      cards: [{ type: 'guide', guideId: id, app: 'WordPress', why: 'Para publicar el borrador que me pides', status: 'open' }],
    });
    expect(s.guides.rows.get(id!)).toMatchObject({
      orgId: ORG,
      threadId: THREAD,
      messageId: MESSAGE,
      agentId: REDES,
      app: 'WordPress',
      goal: 'Redes publica borradores en tu web',
      landing: wordpress,
      startedBy: 'luis',
      status: 'open',
    });
  });

  it('a landing that does not hold tells the model why and records nothing', async () => {
    const told: unknown[] = [];
    const s = setup({
      write: async ({ tools, onText }) => {
        told.push(await tools.run(GUIDE_TOOL, { ...START, auth: 'cookie' }));
        told.push(await tools.run(GUIDE_TOOL, { ...START, app: '' }));
        onText('No he podido.');
      },
    });
    await s.call('luis', `/threads/${THREAD}/reply`);
    expect(told[0]).toMatchObject({ isError: true, content: expect.stringContaining('auth') });
    expect(told[1]).toMatchObject({ isError: true });
    expect(s.guides.rows.size).toBe(0);
  });

  it('reads its own card back as a line, so it knows where the guide stands', () => {
    const card = (status: GuidePart['status'], extra: Partial<GuidePart> = {}) =>
      toTurns(
        [
          msg({ text: 'Publica en mi web' }),
          msg({
            authorKind: 'agent',
            authorAgentId: REDES,
            authorUserId: null,
            authorName: 'Redes',
            text: 'Necesito acceso.',
            parts: [{ type: 'text', text: 'Necesito acceso.' }, { type: 'guide', guideId: 'g', app: 'WordPress', why: '', status, ...extra }],
          }),
        ],
        REDES,
      )[1]?.content;
    expect(card('open')).toBe('Necesito acceso.\n\n[Pedí acceso a WordPress con una guía: todavía no está hecha.]');
    expect(card('rejected', { decidedBy: 'Ana' })).toContain('la rechazó Ana');
    expect(card('blocked', { blockedReason: 'Tu web no tiene https' })).toContain('Tu web no tiene https');
  });
});

describe('the guide screen: reading and stepping', () => {
  it('GET gives what the screen needs, and whether the caller may approve', async () => {
    const s = setup();
    const id = await s.guides.seed();
    const res = await s.get('luis', `/guides/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id,
      threadId: THREAD,
      status: 'open',
      app: 'WordPress',
      goal: 'Redes publica borradores en tu web',
      why: 'Para publicar',
      auth: 'basic',
      agentEmail: 'redes@panaderia.ghostaff.ai',
      step: null,
      steps: 0,
      mayApprove: false,
      blockedReason: null,
      undo: null,
    });
    expect((await s.get('nadie', `/guides/${id}`)).status).toBe(403);
    expect((await s.get('luis', '/guides/nope')).status).toBe(400);
    expect((await s.get('luis', '/guides/60000000-0000-0000-0000-000000000099')).status).toBe(404);
  });

  it('a step comes from the model and is saved with the answer; a reader may not step', async () => {
    const s = setup({ write: stepping(openUsers) });
    const id = await s.guides.seed();
    const res = await s.call('luis', `/guides/${id}/step`, { answer: { type: 'choice', option: 'sidebar-left' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ step: openUsers, status: 'open' });
    expect(s.guides.rows.get(id)?.history).toEqual([
      { type: 'answer', answer: { type: 'choice', option: 'sidebar-left' } },
      { type: 'step', step: openUsers },
    ]);
    expect(await (await s.get('luis', `/guides/${id}`)).json()).toMatchObject({ step: openUsers, steps: 1 });
    expect((await s.call('bea', `/guides/${id}/step`, {})).status).toBe(403);
  });

  it('refuses a secret in an answer, and a photo above 2 MB before anything else', async () => {
    const s = setup({ write: stepping(openUsers) });
    const id = await s.guides.seed();
    const secret = await s.call('luis', `/guides/${id}/step`, { answer: { type: 'text', field: 'password', value: PASSWORD } });
    expect(secret.status).toBe(400);
    const big = 'A'.repeat(3 * 1024 * 1024);
    const res = await s.call('luis', `/guides/${id}/step`, { photo: { mediaType: 'image/jpeg', data: big } });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ message: 'Esa foto es demasiado grande. Prueba con una captura más pequeña.' });
    const bad = await s.call('luis', `/guides/${id}/step`, { photo: { mediaType: 'image/jpeg', data: 'aGVsbG8=' } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ message: 'Esa foto no se puede leer. Prueba con otra.' });
    expect(s.asked).toHaveLength(0);
    expect(s.guides.rows.get(id)?.history).toEqual([]);
  });

  it('says so plainly when no AI account answers', async () => {
    const s = setup({ noAccount: true });
    const id = await s.guides.seed();
    const res = await s.call('luis', `/guides/${id}/step`, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ message: 'No he podido preparar el siguiente paso. Prueba otra vez en un momento.' });
  });

  it('use_connector gives handed_over, and asks for that account in the same message, for the connect → grant → resume flow (R22)', async () => {
    const asks = memoryAsks();
    const s = setup({ asks: asks.store, write: stepping({ blocks: [{ type: 'title', text: 'Usa el botón de WordPress.com' }, { type: 'use_connector', connector: 'wordpress' }] }) });
    const id = await s.guides.seed();
    const res = await s.call('luis', `/guides/${id}/step`, { answer: { type: 'choice', option: 'wpcom' } });
    expect(await res.json()).toMatchObject({ status: 'handed_over' });
    expect(s.guides.rows.get(id)?.status).toBe('handed_over');
    expect(asks.proposed).toEqual([
      { orgId: ORG, threadId: THREAD, messageId: MESSAGE, agentId: REDES, connector: 'wordpress', name: 'WordPress.com', need: 'connect', requestedBy: 'luis' },
    ]);
    const [askId] = [...asks.rows.keys()];
    const ask: AccountAskPart = { type: 'account_ask', askId: askId!, name: 'WordPress.com', why: 'Para publicar', need: 'connect', status: 'open', connector: 'wordpress' };
    expect(s.guides.cards).toEqual([{ messageId: MESSAGE, guideId: id, patch: { status: 'handed_over', connector: 'wordpress', decidedBy: 'Luis' }, add: ask }]);
    expect((await s.call('luis', `/guides/${id}/step`, {})).status).toBe(409);

    // Not connected yet: not yet. Connected (and Redes may use every account): the agent goes on, as for any ask.
    expect(await (await s.call('ana', `/threads/${THREAD}/resume`, { askId })).json()).toMatchObject({ error: 'not_yet' });
    asks.states.set('wordpress', 'ok');
    const said: string[] = [];
    s.answerWith(async ({ messages, onText }) => {
      said.push(messages.at(-1)?.content ?? '');
      onText('Publico el borrador en WordPress.com.');
    });
    const resumed = await s.call('ana', `/threads/${THREAD}/resume`, { askId });
    expect(await resumed.json()).toEqual({ resumed: true });
    expect(said[0]).toContain('Ana: Ya tienes acceso a WordPress.com.');
  });

  it('a handover for an account that is connected but not given to the agent asks to give it', async () => {
    const asks = memoryAsks();
    asks.states.set('wordpress', 'ok');
    const s = setup({ asks: asks.store, write: stepping({ blocks: [{ type: 'use_connector', connector: 'wordpress' }] }) });
    redes.accounts = [];
    try {
      const id = await s.guides.seed();
      await s.call('luis', `/guides/${id}/step`, {});
      expect(asks.proposed[0]).toMatchObject({ connector: 'wordpress', need: 'grant' });
      expect(s.guides.cards[0]?.add).toMatchObject({ type: 'account_ask', need: 'grant' });
    } finally {
      delete redes.accounts;
    }
  });

  it('a wall gives blocked with its reason; the last step keeps its undo', async () => {
    const s = setup({ write: stepping({ blocks: [{ type: 'title', text: 'No se puede seguir' }], blocked: 'Tu web no tiene https' }) });
    const id = await s.guides.seed();
    expect(await (await s.call('luis', `/guides/${id}/step`, {})).json()).toMatchObject({ status: 'blocked' });
    expect(s.guides.rows.get(id)).toMatchObject({ status: 'blocked', blockedReason: 'Tu web no tiene https' });
    expect(s.guides.cards.at(-1)?.patch).toEqual({ status: 'blocked', blockedReason: 'Tu web no tiene https' });

  });

  it('a step with done while the guide is open is never saved as done: the guide stays open, with no undo (R21)', async () => {
    const s = setup({ write: stepping({ blocks: [{ type: 'title', text: 'Listo' }], done: { undo: 'Borra el usuario redes en Usuarios.' } }) });
    const id = await s.guides.seed();
    const res = await s.call('luis', `/guides/${id}/step`, {});
    expect(await res.json()).toEqual({ step: FALLBACK_STEP, status: 'open' });
    expect(s.asked).toHaveLength(2);
    expect(s.guides.rows.get(id)).toMatchObject({ status: 'open', undo: null });
  });

  it('after the check, the closing step keeps its undo, and then the guide takes no more steps', async () => {
    const finished: GuideStep = { blocks: [{ type: 'title', text: 'Listo' }], done: { undo: 'Borra el usuario redes en Usuarios.' } };
    const s = setup();
    const id = await s.guides.seed();
    await s.call('ana', `/guides/${id}/check`, { values: VALUES });
    s.answerWith(stepping(finished));
    expect(await (await s.call('ana', `/guides/${id}/step`, {})).json()).toEqual({ step: finished, status: 'done' });
    expect(s.guides.rows.get(id)?.undo).toBe('Borra el usuario redes en Usuarios.');
    expect((await s.call('ana', `/guides/${id}/step`, {})).status).toBe(409);
  });
});

describe('checking a guide', () => {
  it("a member's check gives checked and no connection; the secret is in the vault only", async () => {
    const s = setup();
    const id = await s.guides.seed();
    const res = await s.call('luis', `/guides/${id}/check`, { values: VALUES });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'checked' });
    expect(s.fetched).toEqual(['https://miweb.com/wp-json/wp/v2/users/me?context=edit']);
    expect(s.accesses.created).toEqual([]);
    expect(JSON.parse((await s.vault.get(guidedSecretName(ORG, id)))!)).toEqual({ username: VALUES.username, password: PASSWORD });
    expect(s.guides.rows.get(id)).toMatchObject({ status: 'checked', completedBy: 'luis' });
    expect(JSON.stringify(s.guides.rows.get(id))).not.toContain(PASSWORD);
    expect(s.guides.cards).toEqual([{ messageId: MESSAGE, guideId: id, patch: { status: 'checked', doneBy: 'Luis' } }]);
    expect(await (await s.get('ana', `/guides/${id}`)).json()).toMatchObject({ mayApprove: true });
    expect(await (await s.get('luis', `/guides/${id}`)).json()).toMatchObject({ mayApprove: false });
  });

  it("an owner's check gives done and a connection for that agent", async () => {
    const s = setup();
    const id = await s.guides.seed();
    expect(await (await s.call('ana', `/guides/${id}/check`, { values: VALUES })).json()).toEqual({ ok: true, status: 'done' });
    expect(s.accesses.created).toEqual([
      {
        orgId: ORG,
        agentId: REDES,
        provider: 'xwordpress',
        hint: VALUES.username,
        settings: { base: 'https://miweb.com/wp-json', auth: 'basic', app: 'WordPress', guideId: id },
        connectedBy: 'ana',
        connectedByName: 'Ana',
      },
    ]);
    expect(s.guides.rows.get(id)).toMatchObject({ status: 'done', completedBy: 'ana' });
    expect(s.guides.cards.at(-1)?.patch).toEqual({ status: 'done', doneBy: 'Ana' });
  });

  it('waits for the agent to finish writing the message that carries the card', async () => {
    const s = setup({ write: stepping(openUsers) });
    const id = await s.guides.seed();
    s.guides.rows.get(id)!.messageState = 'working';
    for (const path of ['step', 'check']) {
      const res = await s.call('luis', `/guides/${id}/${path}`, { values: VALUES });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'still_writing' });
    }
    expect(s.fetched).toEqual([]);
    expect(s.asked).toHaveLength(0);
  });

  it('a failing check says why next to the field, keeps the guide open and keeps nothing', async () => {
    const s = setup({ fetchStatus: 401 });
    const id = await s.guides.seed();
    const res = await s.call('luis', `/guides/${id}/check`, { values: VALUES });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, field: 'password', message: 'Esa contraseña no vale: tiene que ser la de aplicación' });
    expect(s.guides.rows.get(id)?.status).toBe('open');
    expect(await s.vault.get(guidedSecretName(ORG, id))).toBeNull();
    expect((await s.call('bea', `/guides/${id}/check`, { values: VALUES })).status).toBe(403);
  });

  it('a token or key shows its last four only when it is long enough to keep them secret; otherwise no hint', async () => {
    const bearer: GuideLanding = { auth: 'bearer', check: { path: '/me' } };
    for (const [token, hint] of [
      ['abcdefgh1234', '…1234'],
      ['short1234', ''],
    ] as const) {
      const s = setup();
      const id = await s.guides.seed(bearer);
      expect(await (await s.call('ana', `/guides/${id}/check`, { values: { base_url: 'miweb.com', token } })).json()).toEqual({ ok: true, status: 'done' });
      expect(s.accesses.created[0]?.hint, token).toBe(hint);
    }
  });
});

describe('the agent going on while the closing step is written (R23)', () => {
  it('a resume between the check and the closing step does not make the closing step fail', async () => {
    const finished: GuideStep = { blocks: [{ type: 'title', text: 'Listo' }], done: { undo: 'Borra el usuario redes en Usuarios.' } };
    const s = setup();
    const id = await s.guides.seed();
    await s.call('ana', `/guides/${id}/check`, { values: VALUES });
    let release: () => void = () => {};
    const modelWaits = new Promise<void>((r) => {
      release = r;
    });
    s.answerWith(async (req) => {
      if (req.tools.specs.some((t) => t.name === SHOW_STEP)) {
        await modelWaits;
        await stepping(finished)(req);
      } else req.onText('Publico el borrador.');
    });
    const closing = s.call('ana', `/guides/${id}/step`, {});
    await new Promise((r) => setTimeout(r, 10));
    expect((await s.call('ana', `/threads/${THREAD}/resume`, { guideId: id })).status).toBe(200);
    release();
    const res = await closing;
    expect(res.status).toBe(200);
    expect(s.guides.rows.get(id)).toMatchObject({ undo: 'Borra el usuario redes en Usuarios.', resumedAt: expect.any(String) });
  });
});

describe('a guide for an app the agent already reaches', () => {
  const OLD = '60000000-0000-0000-0000-000000000042';

  it("replaces the access: the old guide's secret goes, the new one stays", async () => {
    const s = setup();
    const id = await s.guides.seed();
    await s.vault.put(guidedSecretName(ORG, OLD), JSON.stringify({ username: 'redes', password: 'vieja vieja' }), {});
    s.accesses.replacing.guideId = OLD;
    expect(await (await s.call('ana', `/guides/${id}/check`, { values: VALUES })).json()).toEqual({ ok: true, status: 'done' });
    expect(await s.vault.get(guidedSecretName(ORG, OLD))).toBeNull();
    expect(JSON.parse((await s.vault.get(guidedSecretName(ORG, id)))!).password).toBe(PASSWORD);
  });

  it('a stale secret that cannot be removed does not cost the new access, and is logged by name only', async () => {
    const s = setup();
    const id = await s.guides.seed();
    s.accesses.replacing.guideId = OLD;
    const remove = s.vault.remove.bind(s.vault);
    s.vault.remove = async (name) => {
      if (name === guidedSecretName(ORG, OLD)) throw new Error(`boom ${PASSWORD}`);
      return remove(name);
    };
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      expect(await (await s.call('ana', `/guides/${id}/check`, { values: VALUES })).json()).toEqual({ ok: true, status: 'done' });
    } finally {
      console.error = original;
    }
    expect(s.guides.rows.get(id)?.status).toBe('done');
    expect(logged).toEqual([['replaced guided secret not removed', 'Error']]);
  });
});

describe('approving and rejecting a member’s guide', () => {
  async function checked() {
    const s = setup();
    const id = await s.guides.seed();
    await s.call('luis', `/guides/${id}/check`, { values: VALUES });
    return { ...s, id };
  }

  it('only owners approve; approving writes the connection', async () => {
    const s = await checked();
    expect((await s.call('luis', `/guides/${s.id}/approve`)).status).toBe(403);
    expect(s.accesses.created).toEqual([]);
    const res = await s.call('ana', `/guides/${s.id}/approve`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'done', resumed: true });
    expect(s.accesses.created).toMatchObject([{ agentId: REDES, provider: 'xwordpress', hint: VALUES.username, connectedBy: 'luis', connectedByName: 'Luis' }]);
    expect(s.guides.rows.get(s.id)).toMatchObject({ status: 'done', decidedBy: 'ana' });
    expect(s.guides.cards.at(-1)?.patch).toEqual({ status: 'done', decidedBy: 'Ana' });
  });

  it('a rejection whose secret cannot be removed stays checked, for the owner to reject again', async () => {
    const s = await checked();
    const cardsBefore = s.guides.cards.length;
    const remove = s.vault.remove.bind(s.vault);
    let fails = 1;
    s.vault.remove = async (name) => {
      if (fails-- > 0) throw new Error('secret manager down');
      return remove(name);
    };
    expect((await s.call('ana', `/guides/${s.id}/reject`)).status).toBe(500);
    expect(s.guides.rows.get(s.id)).toMatchObject({ status: 'checked', decidedBy: null });
    expect(await s.vault.get(guidedSecretName(ORG, s.id))).not.toBeNull();
    expect(s.guides.cards).toHaveLength(cardsBefore);
    expect(await (await s.call('ana', `/guides/${s.id}/reject`)).json()).toEqual({ status: 'rejected' });
    expect(await s.vault.get(guidedSecretName(ORG, s.id))).toBeNull();
    expect(s.guides.cards.at(-1)?.patch).toEqual({ status: 'rejected', decidedBy: 'Ana' });
  });

  it('only owners reject; rejecting removes the secret and says so on the card', async () => {
    const s = await checked();
    expect((await s.call('luis', `/guides/${s.id}/reject`)).status).toBe(403);
    expect(await s.vault.get(guidedSecretName(ORG, s.id))).not.toBeNull();
    expect(await (await s.call('ana', `/guides/${s.id}/reject`)).json()).toEqual({ status: 'rejected' });
    expect(await s.vault.get(guidedSecretName(ORG, s.id))).toBeNull();
    expect(s.guides.rows.get(s.id)).toMatchObject({ status: 'rejected', decidedBy: 'ana' });
    expect(s.guides.cards.at(-1)?.patch).toEqual({ status: 'rejected', decidedBy: 'Ana' });
    expect((await s.call('ana', `/guides/${s.id}/approve`)).status).toBe(409);
  });
});

describe('an owner approves a member\'s guide from a conversation they cannot see (R19, R20)', () => {
  /** Luis does the guide in his personal chat with Redes: nobody else may read it. */
  async function inLuisChat() {
    const s = setup({ threadLevels: { luis: 'talk' } });
    const id = await s.guides.seed();
    expect(await (await s.call('luis', `/guides/${id}/check`, { values: VALUES })).json()).toEqual({ ok: true, status: 'checked' });
    return { ...s, id };
  }

  it('the owner lists it as pending and reads it; nobody else does', async () => {
    const s = await inLuisChat();
    const res = await s.get('ana', `/orgs/${ORG}/guides/pending`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      guides: [{ id: s.id, app: 'WordPress', agentId: REDES, agentName: 'Redes', completedByName: 'Luis', checkedAt: expect.any(String) }],
    });
    for (const user of ['luis', 'bea', 'zoe']) expect((await s.get(user, `/orgs/${ORG}/guides/pending`)).status).toBe(403);
    expect((await s.get('ana', '/orgs/nope/guides/pending')).status).toBe(400);

    expect(await (await s.get('ana', `/guides/${s.id}`)).json()).toMatchObject({ status: 'checked', mayApprove: true });
    expect((await s.get('bea', `/guides/${s.id}`)).status).toBe(403);
  });

  it('approving resumes the agent once, in that conversation, as the member who did the guide; then it is no longer pending', async () => {
    const s = await inLuisChat();
    const said: string[] = [];
    s.answerWith(async ({ messages, onText }) => {
      said.push(messages.at(-1)?.content ?? '');
      onText('Publico el borrador.');
    });
    const res = await s.call('ana', `/guides/${s.id}/approve`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'done', resumed: true });
    // The request answered after the reply was written.
    expect(s.updates.at(-1)).toMatchObject({ id: MESSAGE, state: 'done', text: 'Publico el borrador.' });
    expect(said).toEqual([expect.stringContaining('Luis: Ya tienes acceso a WordPress. Sigue con lo que se te pidió.')]);
    expect(s.guides.rows.get(s.id)).toMatchObject({ status: 'done', decidedBy: 'ana', resumedAt: expect.any(String) });
    expect(s.accesses.created).toMatchObject([{ connectedBy: 'luis' }]);

    expect(await (await s.get('ana', `/orgs/${ORG}/guides/pending`)).json()).toEqual({ guides: [] });
    // Who decided it may still read it; the guide's screen says how it ended.
    expect(await (await s.get('ana', `/guides/${s.id}`)).json()).toMatchObject({ status: 'done', mayApprove: false });

    // A second approve, and the chat's own resume, are refused: the agent went on once.
    expect((await s.call('ana', `/guides/${s.id}/approve`)).status).toBe(409);
    const again = await s.call('luis', `/threads/${THREAD}/resume`, { guideId: s.id });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'already_done' });
    expect(said).toHaveLength(1);
  });

  it('the owner rejects it without seeing the conversation too', async () => {
    const s = await inLuisChat();
    expect(await (await s.call('ana', `/guides/${s.id}/reject`)).json()).toEqual({ status: 'rejected' });
    expect(await s.vault.get(guidedSecretName(ORG, s.id))).toBeNull();
    expect(s.asked).toHaveLength(0);
  });

  it('when the agent is answering, the approval still stands and the chat resumes it later', async () => {
    const s = await inLuisChat();
    let release: () => void = () => {};
    s.answerWith(async ({ onText }) => {
      await new Promise<void>((r) => {
        release = r;
      });
      onText('Hecho.');
    });
    s.messages.push(msg({ text: '¿Y bien?', authorUserId: 'luis', authorName: 'Luis' }));
    const replying = s.call('luis', `/threads/${THREAD}/reply`);
    await new Promise((r) => setTimeout(r, 10));
    const res = await s.call('ana', `/guides/${s.id}/approve`);
    expect(await res.json()).toEqual({ status: 'done', resumed: false });
    expect(s.guides.rows.get(s.id)).toMatchObject({ status: 'done', resumedAt: null });
    release();
    await replying;
    s.answerWith(async ({ onText }) => onText('Publico el borrador.'));
    expect(await (await s.call('luis', `/threads/${THREAD}/resume`, { guideId: s.id })).json()).toEqual({ resumed: true });
  });
});

describe('two people on one guide, or a double press (Review focus 5)', () => {
  it('a double check finishes once', async () => {
    const s = setup();
    const id = await s.guides.seed();
    const [a, b] = await Promise.all([s.call('ana', `/guides/${id}/check`, { values: VALUES }), s.call('ana', `/guides/${id}/check`, { values: VALUES })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(s.accesses.created).toHaveLength(1);
  });

  it("a member's check after an owner finished is refused as done", async () => {
    const s = setup();
    const id = await s.guides.seed();
    await s.call('ana', `/guides/${id}/check`, { values: VALUES });
    const late = await s.call('luis', `/guides/${id}/check`, { values: { ...VALUES, password: 'otra cosa' } });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: 'already_done' });
    expect(JSON.parse((await s.vault.get(guidedSecretName(ORG, id)))!).password).toBe(PASSWORD);
  });

  it('a double approve approves once', async () => {
    const s = setup();
    const id = await s.guides.seed();
    await s.call('luis', `/guides/${id}/check`, { values: VALUES });
    const [a, b] = await Promise.all([s.call('ana', `/guides/${id}/approve`), s.call('ana', `/guides/${id}/approve`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(s.accesses.created).toHaveLength(1);
  });

  it('a double resume goes on once', async () => {
    const s = setup();
    const id = await s.guides.seed();
    await s.call('ana', `/guides/${id}/check`, { values: VALUES });
    s.answerWith(async ({ onText }) => onText('Publico el borrador.'));
    const [a, b] = await Promise.all([
      s.call('ana', `/threads/${THREAD}/resume`, { guideId: id }),
      s.call('ana', `/threads/${THREAD}/resume`, { guideId: id }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(s.asked).toHaveLength(1);
  });
});

describe('the agent going on after a guide', () => {
  it('is refused while the guide is checked; an owner\'s approval lets it go on, and the chat\'s resume is refused after', async () => {
    const s = setup();
    const id = await s.guides.seed();
    await s.call('luis', `/guides/${id}/check`, { values: VALUES });
    const early = await s.call('luis', `/threads/${THREAD}/resume`, { guideId: id });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: 'not_yet' });
    const said: string[] = [];
    s.answerWith(async ({ messages, onText }) => {
      said.push(messages.at(-1)?.content ?? '');
      onText('Publico el borrador.');
    });
    expect(await (await s.call('ana', `/guides/${id}/approve`)).json()).toEqual({ status: 'done', resumed: true });
    expect(said[0]).toContain('Luis: Ya tienes acceso a WordPress. Sigue con lo que se te pidió.');
    expect(s.guides.rows.get(id)?.resumedAt).toEqual(expect.any(String));
    expect((await s.call('luis', `/threads/${THREAD}/resume`, { guideId: id })).status).toBe(409);
  });

  it('an owner who finished the guide lets the agent go on from the chat, as before', async () => {
    const s = setup();
    const id = await s.guides.seed();
    await s.call('ana', `/guides/${id}/check`, { values: VALUES });
    const res = await s.call('ana', `/threads/${THREAD}/resume`, { guideId: id });
    expect(await res.json()).toEqual({ resumed: true });
    expect((await s.call('ana', `/threads/${THREAD}/resume`, { guideId: id })).status).toBe(409);
  });

  it('refuses a guide of another thread, someone who may not write, and a bad id', async () => {
    const s = setup();
    const id = await s.guides.seed();
    await s.call('ana', `/guides/${id}/check`, { values: VALUES });
    expect((await s.call('bea', `/threads/${THREAD}/resume`, { guideId: id })).status).toBe(403);
    expect((await s.call('ana', `/threads/${THREAD}/resume`, { guideId: 'nope' })).status).toBe(400);
    s.guides.rows.get(id)!.threadId = '30000000-0000-0000-0000-000000000099';
    expect((await s.call('ana', `/threads/${THREAD}/resume`, { guideId: id })).status).toBe(404);
  });

  it('leaves the guide to resume when the agent is busy answering', async () => {
    const s = setup();
    const id = await s.guides.seed();
    await s.call('ana', `/guides/${id}/check`, { values: VALUES });
    let release: () => void = () => {};
    s.answerWith(async ({ onText }) => {
      await new Promise<void>((r) => {
        release = r;
      });
      onText('Hecho.');
    });
    s.messages.push(msg({ text: '¿Y bien?' }));
    const replying = s.call('ana', `/threads/${THREAD}/reply`);
    await new Promise((r) => setTimeout(r, 10));
    const res = await s.call('ana', `/threads/${THREAD}/resume`, { guideId: id });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'busy' });
    expect(s.guides.rows.get(id)?.resumedAt).toBeNull();
    release();
    await replying;
  });
});

describe('removing a guided access', () => {
  const CONN = '70000000-0000-0000-0000-0000000000aa';
  /** A done guide with its access and its credential, as a check by an owner leaves them. */
  async function withAccess(undo: string | null = 'Borra el usuario redes en Usuarios.') {
    const s = setup();
    const id = await s.guides.seed();
    s.guides.rows.get(id)!.undo = undo;
    s.accesses.rows.set(CONN, { orgId: ORG, guideId: id, app: 'WordPress' });
    await s.vault.put(guidedSecretName(ORG, id), JSON.stringify({ username: 'redes', password: PASSWORD }), {});
    return { s, id };
  }

  it("an owner reads the guide's undo text before removing", async () => {
    const { s } = await withAccess();
    const res = await s.get('ana', `/connections/guided/${CONN}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ app: 'WordPress', undo: 'Borra el usuario redes en Usuarios.' });
  });

  it('only owners read it or remove: a member and a stranger are refused and nothing goes', async () => {
    const { s, id } = await withAccess();
    for (const user of ['luis', 'zoe']) {
      expect((await s.get(user, `/connections/guided/${CONN}`)).status).toBe(403);
      expect((await s.call(user, `/connections/guided/${CONN}`, undefined, 'DELETE')).status).toBe(403);
    }
    expect(s.accesses.rows.has(CONN)).toBe(true);
    expect(await s.vault.get(guidedSecretName(ORG, id))).not.toBeNull();
  });

  it('the secret goes with the row', async () => {
    const { s, id } = await withAccess();
    const res = await s.call('ana', `/connections/guided/${CONN}`, undefined, 'DELETE');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(s.accesses.rows.has(CONN)).toBe(false);
    expect(await s.vault.get(guidedSecretName(ORG, id))).toBeNull();
  });

  it('an unknown or malformed access is 404 or 400', async () => {
    const { s } = await withAccess();
    expect((await s.call('ana', '/connections/guided/70000000-0000-0000-0000-0000000000bb', undefined, 'DELETE')).status).toBe(404);
    expect((await s.call('ana', '/connections/guided/nope', undefined, 'DELETE')).status).toBe(400);
  });

  it('when the vault fails the row stays, so the access is not left pointing at a missing secret, and a retry finishes', async () => {
    const { s, id } = await withAccess();
    const remove = s.vault.remove.bind(s.vault);
    let down = true;
    s.vault.remove = async (name) => {
      if (down) throw new Error(`vault down ${PASSWORD}`);
      return remove(name);
    };
    const res = await s.call('ana', `/connections/guided/${CONN}`, undefined, 'DELETE');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(PASSWORD);
    expect(s.accesses.rows.has(CONN)).toBe(true);
    expect(await s.vault.get(guidedSecretName(ORG, id))).not.toBeNull();
    down = false;
    expect((await s.call('ana', `/connections/guided/${CONN}`, undefined, 'DELETE')).status).toBe(200);
    expect(s.accesses.rows.has(CONN)).toBe(false);
    expect(await s.vault.get(guidedSecretName(ORG, id))).toBeNull();
  });

  it('when the row cannot be removed after the secret, the owner is told and the retry removes it', async () => {
    const { s } = await withAccess();
    s.accesses.flags.removeFails = true;
    expect((await s.call('ana', `/connections/guided/${CONN}`, undefined, 'DELETE')).status).toBe(500);
    expect(s.accesses.rows.has(CONN)).toBe(true);
    s.accesses.flags.removeFails = false;
    expect((await s.call('ana', `/connections/guided/${CONN}`, undefined, 'DELETE')).status).toBe(200);
    expect(s.accesses.rows.has(CONN)).toBe(false);
  });

  it('an access whose guide has no undo text yet says null', async () => {
    const { s } = await withAccess(null);
    expect(await (await s.get('ana', `/connections/guided/${CONN}`)).json()).toEqual({ app: 'WordPress', undo: null });
  });
});

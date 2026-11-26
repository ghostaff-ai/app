import type { ChatMessage } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import type { AiUse, Writer } from '../src/chat';
import { composePrompt } from '../src/runner';
import {
  digestDue,
  digestPrompt,
  type GeneralDigest,
  type GeneralStore,
  GENERAL_TOOL,
  generalTools,
  heardBlock,
  madridToday,
  NOTHING,
  PER_TICK,
} from '../src/generalDigest';

// General's daily summaries (docs/plans/ready/general-chat.md, decision 2).

const ORG = '10000000-0000-0000-0000-000000000001';
const GENERAL = '30000000-0000-0000-0000-000000000001';

let n = 0;
function msg(p: Partial<ChatMessage> & { text: string }): ChatMessage {
  n += 1;
  return {
    id: `m${n}`,
    threadId: GENERAL,
    authorKind: 'person',
    authorUserId: 'alvaro',
    authorAgentId: null,
    authorName: 'Álvaro',
    parts: [{ type: 'text', text: p.text }],
    state: 'done',
    steps: [],
    createdAt: '2026-11-25T09:15:00Z',
    ...p,
  };
}

function setup(opts: { due?: Array<{ orgId: string; threadId: string; day: string }>; write?: Writer; failDue?: boolean } = {}) {
  const saved: Array<{ orgId: string; day: string; summary: string; throughMessage: string }> = [];
  const asked: Array<{ since: string; until: string }> = [];
  const prompts: string[] = [];
  const used: AiUse[] = [];
  const general: GeneralStore = {
    searchMessages: async () => [],
    chatOf: async () => GENERAL,
    digests: async () => [],
    due: async (since, until) => {
      if (opts.failDue) throw new Error('down');
      asked.push({ since, until });
      return opts.due ?? [{ orgId: ORG, threadId: GENERAL, day: '2026-11-25' }];
    },
    messagesBetween: async () => [
      msg({ text: 'Lo de la feria de Valencia lo cerramos mañana a las 9.' }),
      msg({ authorUserId: 'jaime', authorName: 'Jaime', text: 'Vale, yo llamo al de los stands.', createdAt: '2026-11-25T09:20:00Z' }),
    ],
    saveDigest: async (d) => {
      saved.push(d);
    },
  };
  const write: Writer =
    opts.write ??
    (async (req) => {
      prompts.push(req.messages[0]!.content);
      req.onText('- Feria de Valencia: se cierra mañana a las 9 (Álvaro).\n- Jaime llama al de los stands.');
    });
  const deps = {
    chat: { aiAccounts: async () => [{ id: 'key-1', provider: 'anthropic' as const }], recordAiUse: async (u: AiUse) => void used.push(u) },
    writerFor: async () => write,
    general,
    now: () => new Date('2026-11-26T08:00:00Z'),
  };
  return { deps, saved, asked, prompts, used };
}

describe('the day in Madrid', () => {
  it('knows today in Madrid, also just after midnight there', () => {
    expect(madridToday(new Date('2026-11-25T22:30:00Z'))).toBe('2026-11-25');
    expect(madridToday(new Date('2026-11-25T23:30:00Z'))).toBe('2026-11-26');
  });
});

describe('summarising the days of General', () => {
  it('summarises a finished day with the organisation’s account, signing each message with who and when', async () => {
    const { deps, saved, asked, prompts, used } = setup();
    expect(await digestDue(deps)).toBe(1);
    // The last week, up to the start of today in Madrid: only finished days.
    expect(asked).toEqual([{ since: '2026-11-18T23:00:00.000Z', until: '2026-11-25T23:00:00.000Z' }]);
    expect(prompts[0]).toContain('miércoles, 25 de noviembre');
    expect(prompts[0]).toContain('Álvaro (10:15): Lo de la feria de Valencia');
    expect(prompts[0]).toContain('Jaime (10:20): Vale, yo llamo');
    expect(saved).toEqual([{ orgId: ORG, day: '2026-11-25', summary: expect.stringContaining('Feria de Valencia'), throughMessage: expect.any(String) }]);
    expect(used[0]).toMatchObject({ orgId: ORG, agentId: null, outcome: 'ok' });
  });

  it('writes a few days per tick, oldest first; the rest wait for the next', async () => {
    const due = ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'].map((day) => ({ orgId: ORG, threadId: GENERAL, day }));
    const { deps, saved } = setup({ due });
    expect(await digestDue(deps)).toBe(PER_TICK);
    expect(saved.map((s) => s.day)).toEqual(['2026-11-19', '2026-11-20', '2026-11-21']);
  });

  it('keeps nothing when no account could write it, so the day is tried again', async () => {
    const { deps, saved } = setup({ write: async () => Promise.reject(new Error('down')) });
    expect(await digestDue(deps)).toBe(0);
    expect(saved).toEqual([]);
  });

  it('never throws, not even when the days can’t be listed', async () => {
    const { deps } = setup({ failDue: true });
    await expect(digestDue(deps)).resolves.toBe(0);
  });

  it('leaves out a reply still being written', () => {
    const p = digestPrompt('2026-11-25', [msg({ text: 'Hola' }), msg({ authorKind: 'agent', authorName: 'Secretaría', text: 'Escribien', state: 'working' })]);
    expect(p).toContain('Hola');
    expect(p).not.toContain('Escribien');
  });
});

describe('what the agents are told', () => {
  const digests: GeneralDigest[] = [
    { day: '2026-11-25', summary: '- Feria de Valencia: se cierra mañana.' },
    { day: '2026-11-24', summary: NOTHING },
  ];

  it('the latest days, newest first, as internal talk, with the search when there is one', () => {
    const block = heardBlock('Órdago', digests, true);
    expect(block).toContain('General, su chat interno');
    expect(block).toContain('nunca lo cites ni lo cuentes a nadie de fuera');
    expect(block).toContain('## miércoles, 25 de noviembre');
    expect(block).toContain(GENERAL_TOOL);
    expect(block).not.toContain('martes'); // a day with nothing relevant is left out
    expect(heardBlock('Órdago', digests, false)).not.toContain(GENERAL_TOOL);
  });

  it('nothing when nothing was said', () => {
    expect(heardBlock('Órdago', [], true)).toBe('');
    expect(heardBlock('Órdago', [{ day: '2026-11-24', summary: NOTHING }], true)).toBe('');
  });

  it('a run of our runner reads it in its prompt', () => {
    const prompt = composePrompt({
      agent: { id: 'a', orgId: ORG, slug: 'legal', name: 'Legal', description: null, task: 'Revisa contratos.', taskInRecord: false, model: 'x', tools: [], maxTurns: 10, repos: [], readsOrgRuns: false } as never,
      orgName: 'Órdago',
      repo: 'ordago/business',
      now: new Date('2026-11-26T08:00:00Z'),
      request: null,
      heard: heardBlock('Órdago', digests, false),
    });
    expect(prompt).toContain('## miércoles, 25 de noviembre');
  });

  it('searches General’s messages, by words', async () => {
    const asked: string[] = [];
    const tools = generalTools(
      {
        searchMessages: async (threadId, q) => {
          asked.push(`${threadId}:${q.words.join(',')}`);
          return [{ id: 'm1', authorKind: 'person', authorName: 'Álvaro', authorAgentId: null, createdAt: '2026-11-25T09:15:00Z', text: 'Lo de la feria' }];
        },
      },
      GENERAL,
      'agent-1',
    );
    expect(tools.specs.map((s) => s.name)).toEqual([GENERAL_TOOL]);
    const out = await tools.run(GENERAL_TOOL, { query: 'feria valencia' });
    expect(asked).toEqual([`${GENERAL}:feria,valencia`]);
    expect(out.content).toContain('Álvaro: Lo de la feria');
  });
});

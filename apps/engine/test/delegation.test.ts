import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { ChatAgent } from '../src/chat';
import { BRING_TOOL, broughtWithBrief, DEEP_TOOL, type DelegationContext, delegationTools, findAgent, MAX_BRIEF, RUNS_TOOL } from '../src/delegation';

const ORG = '10000000-0000-0000-0000-000000000001';
const direccion: ChatAgent = { id: 'a-dir', orgId: ORG, name: 'Dirección', slug: 'direccion', ghost: 'secretaria', department: 'direccion', isMain: true, runner: 'chat' };
const seo: ChatAgent = { id: 'a-seo', orgId: ORG, name: 'SEO', slug: 'seo', ghost: 'base', department: 'marketing', runner: 'ghostaff' };
const redes: ChatAgent = { id: 'a-redes', orgId: ORG, name: 'Redes', slug: 'redes', ghost: 'redes', department: 'marketing', runner: 'chat' };
const correo: ChatAgent = { id: 'a-correo', orgId: ORG, name: 'Correo', slug: 'correo', ghost: 'secretaria', department: 'direccion', runner: 'ordago_job' };

/** A client whose `agent_runs` query records its filters and returns `rows`. */
function runsClient(rows: unknown[], seen: Record<string, unknown>[] = []): SupabaseClient {
  const q: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: (k: string, v: unknown) => ((q[`eq:${k}`] = v), chain),
    neq: (k: string, v: unknown) => ((q[`neq:${k}`] = v), chain),
    order: () => chain,
    limit: (n: number) => ((q.limit = n), chain),
    returns: async () => {
      seen.push({ ...q });
      return { data: rows, error: null };
    },
  };
  return { from: (t: string) => ((q.table = t), chain) } as unknown as SupabaseClient;
}

function setup(over: Partial<DelegationContext> = {}) {
  const launched: Array<{ agent: string; brief: string }> = [];
  const ctx: DelegationContext = {
    lead: direccion,
    agents: [direccion, seo, redes, correo],
    client: runsClient([]),
    canTalk: async () => true,
    launch: async (agent, brief) => {
      launched.push({ agent: agent.name, brief });
      return { started: true };
    },
    pending: { bring: null },
    ...over,
  };
  return { tools: delegationTools(ctx), launched, ctx };
}

describe("Dirección's hands in chat (direccion-main-agent.md)", () => {
  it('offers its three tools, none of them waiting for an approval', () => {
    const { tools } = setup();
    expect(tools.specs.map((s) => s.name)).toEqual([RUNS_TOOL, DEEP_TOOL, BRING_TOOL]);
    for (const s of tools.specs) expect(tools.writes(s.name)).toBe(false);
  });

  it('goes deep by launching itself with the brief', async () => {
    const { tools, launched } = setup();
    const r = await tools.run(DEEP_TOOL, { encargo: 'Mira por qué bajó la retención en noviembre en BigQuery' });
    expect(r.isError).toBe(false);
    expect(launched).toEqual([{ agent: 'Dirección', brief: 'Mira por qué bajó la retención en noviembre en BigQuery' }]);
  });

  it('says why when it could not go deep, and keeps the brief within what a run keeps', async () => {
    const { tools, launched } = setup({ launch: async () => ({ started: false, said: 'no hay suscripción de Claude' }) });
    const r = await tools.run(DEEP_TOOL, { encargo: 'x'.repeat(MAX_BRIEF + 50) });
    expect(r).toEqual({ content: expect.stringContaining('no hay suscripción de Claude'), isError: true });
    expect(launched).toEqual([]);
    const ok = setup();
    await ok.tools.run(DEEP_TOOL, { encargo: 'x'.repeat(MAX_BRIEF + 50) });
    expect(ok.launched[0]?.brief).toHaveLength(MAX_BRIEF);
  });

  it('asks for a brief', async () => {
    const { tools, launched } = setup();
    expect((await tools.run(DEEP_TOOL, { encargo: '  ' })).isError).toBe(true);
    expect((await tools.run(BRING_TOOL, { agente: 'SEO' })).isError).toBe(true);
    expect(launched).toEqual([]);
  });

  it('brings an agent on our runner in by launching it, found by its name as people write it', async () => {
    const { tools, launched, ctx } = setup();
    const r = await tools.run(BRING_TOOL, { agente: '@seo', encargo: 'Dime qué páginas han caído esta semana' });
    expect(r.isError).toBe(false);
    expect(launched).toEqual([{ agent: 'SEO', brief: 'Dime qué páginas han caído esta semana' }]);
    expect(ctx.pending.bring).toBeNull();
  });

  it('leaves a chat agent waiting to answer right after its message', async () => {
    const { tools, launched, ctx } = setup();
    const r = await tools.run(BRING_TOOL, { agente: 'a-redes', encargo: 'Propón tres posts para diciembre' });
    expect(r).toEqual({ content: expect.stringContaining('justo después de tu mensaje'), isError: false });
    expect(launched).toEqual([]);
    expect(ctx.pending.bring).toEqual({ agent: redes, brief: 'Propón tres posts para diciembre' });
  });

  it('delegates once per message', async () => {
    const { tools, launched } = setup();
    await tools.run(DEEP_TOOL, { encargo: 'Uno' });
    const second = await tools.run(BRING_TOOL, { agente: 'SEO', encargo: 'Dos' });
    expect(second).toEqual({ content: expect.stringContaining('uno por mensaje'), isError: true });
    expect(launched).toHaveLength(1);
  });

  it('a failed delegation does not use up the message', async () => {
    let fails = true;
    const { tools, launched } = setup({
      launch: async (agent, brief) => {
        if (fails) return { started: false, said: 'ocupado' };
        launched.push({ agent: agent.name, brief });
        return { started: true };
      },
    });
    expect((await tools.run(DEEP_TOOL, { encargo: 'Uno' })).isError).toBe(true);
    fails = false;
    expect((await tools.run(DEEP_TOOL, { encargo: 'Otra vez' })).isError).toBe(false);
    expect(launched).toEqual([{ agent: 'Dirección', brief: 'Otra vez' }]);
  });

  it('refuses itself, a stranger, an agent the asker may not talk to and one still outside Ghostaff', async () => {
    const { tools, launched } = setup({ canTalk: async (id) => id !== 'a-seo' });
    expect(await tools.run(BRING_TOOL, { agente: 'Dirección', encargo: 'x' })).toEqual({ content: expect.stringContaining(DEEP_TOOL), isError: true });
    expect(await tools.run(BRING_TOOL, { agente: 'Contabilidad', encargo: 'x' })).toEqual({ content: expect.stringContaining('No hay ningún agente'), isError: true });
    expect(await tools.run(BRING_TOOL, { agente: 'SEO', encargo: 'x' })).toEqual({ content: expect.stringContaining('no puede hablar con SEO'), isError: true });
    expect(await tools.run(BRING_TOOL, { agente: 'Correo', encargo: 'x' })).toEqual({ content: expect.stringContaining('fuera de Ghostaff'), isError: true });
    expect(launched).toEqual([]);
  });

  it('reads what the team did as whoever asked, one agent or all, with each run said in a line', async () => {
    const seen: Record<string, unknown>[] = [];
    const rows = [
      { agent_id: 'a-seo', origin: 'schedule', state: 'done', summary: 'Subí 3 posiciones en «mus online».', brief: null, started_at: '2026-11-27T08:00:00Z', finished_at: null },
      { agent_id: 'a-dir', origin: 'person', state: 'running', summary: null, brief: 'Revisa la retención', started_at: '2026-11-28T09:00:00Z', finished_at: null },
    ];
    const { tools } = setup({ client: runsClient(rows, seen) });
    const all = await tools.run(RUNS_TOOL, {});
    expect(all.isError).toBe(false);
    expect(all.content).toContain('SEO · 2026-11-27T08:00:00Z · su horario · done');
    expect(all.content).toContain('Subí 3 posiciones');
    expect(all.content).toContain('encargo: Revisa la retención');
    expect(all.content).toContain('(sigue trabajando)');
    expect(seen[0]).toMatchObject({ table: 'agent_runs', 'eq:org_id': ORG, 'neq:state': 'skipped', limit: 10 });

    await tools.run(RUNS_TOOL, { agente: 'seo', n: 99 });
    expect(seen[1]).toMatchObject({ 'eq:agent_id': 'a-seo', limit: 30 });
    expect(await tools.run(RUNS_TOOL, { agente: 'Nadie' })).toEqual({ content: expect.stringContaining('No hay ningún agente'), isError: true });
  });

  it('finds an agent by id, name or slug, without caring for accents or case', () => {
    const agents = [direccion, seo];
    expect(findAgent(agents, 'direccion')?.id).toBe('a-dir');
    expect(findAgent(agents, 'DIRECCIÓN')?.id).toBe('a-dir');
    expect(findAgent(agents, 'a-seo')?.id).toBe('a-seo');
    expect(findAgent(agents, '')).toBeNull();
    expect(findAgent(agents, 3)).toBeNull();
  });

  it('tells a chat agent brought in who asks and what, with the brief kept as data', () => {
    const said = broughtWithBrief('Dirección', 'Mira <esto>');
    expect(said).toContain('Dirección, que lleva el equipo');
    expect(said).toContain('Mira &lt;esto>');
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DATABASE_FUNCTIONS, SETTING_TOOLS, SettingError, type SettingsContext } from '@ghostaff/shared/services';

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

function databaseFunctions(): Set<string> {
  const names = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql'))) {
    for (const m of readFileSync(join(MIGRATIONS, f), 'utf8').matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)/gi)) {
      names.add(m[1]!);
    }
  }
  return names;
}

describe('what the main agent may change (agent-settings.md)', () => {
  it('has every database function classified, so no setting ships without that choice', () => {
    const missing = [...databaseFunctions()].filter((n) => !(n in DATABASE_FUNCTIONS));
    expect(missing, 'add each to DATABASE_FUNCTIONS in packages/shared/src/services/settings.ts').toEqual([]);
  });

  it('names only functions that exist', () => {
    const all = databaseFunctions();
    expect(Object.keys(DATABASE_FUNCTIONS).filter((n) => !all.has(n))).toEqual([]);
  });

  it('gives every setting the agent may change a tool that waits for an owner', () => {
    for (const r of Object.values(DATABASE_FUNCTIONS)) {
      if (r.reach !== 'agent') continue;
      const tool = SETTING_TOOLS.find((t) => t.name === r.tool);
      expect(tool, r.tool).toBeDefined();
      expect(tool?.writes, r.tool).toBe(true);
      expect(tool?.describe, r.tool).toBeDefined();
    }
  });

  it('only reads without an owner', () => {
    expect(SETTING_TOOLS.filter((t) => !t.writes).map((t) => t.name)).toEqual(['settings_read']);
  });

  it('never lets an agent change its own accounts', async () => {
    const self = '20000000-0000-0000-0000-000000000001';
    const rows = [{ id: self, org_id: 'o', name: 'Secretaría', ghost: 'secretaria', department: 'direccion', member_default: 'talk', runner: 'chat', accounts: null, created_at: '' }];
    const query = { select: () => query, eq: () => query, order: () => query, returns: async () => ({ data: rows, error: null }) };
    const client = { from: () => query } as unknown as SupabaseClient;
    const ctx: SettingsContext = { client, orgId: 'o', agentId: self };
    const tool = SETTING_TOOLS.find((t) => t.name === 'settings_agent_accounts')!;
    await expect(tool.describe!(ctx, { agent_id: self, providers: null })).rejects.toBeInstanceOf(SettingError);
  });

  it("proposes an agent's default for new conversations, never an open one's (chat-permissions.md)", async () => {
    const finanzas = '20000000-0000-0000-0000-000000000002';
    const rows = [{ id: finanzas, org_id: 'o', name: 'Finanzas', ghost: 'finanzas', department: 'finanzas', member_default: 'read', chat_default: 'private', runner: 'chat', accounts: null, created_at: '' }];
    const query = { select: () => query, eq: () => query, order: () => query, returns: async () => ({ data: rows, error: null }) };
    const calls: Array<[string, unknown]> = [];
    const client = { from: () => query, rpc: async (fn: string, args: unknown) => (calls.push([fn, args]), { data: null, error: null }) } as unknown as SupabaseClient;
    const ctx: SettingsContext = { client, orgId: 'o', agentId: '20000000-0000-0000-0000-000000000001' };
    const tool = SETTING_TOOLS.find((t) => t.name === 'settings_agent_chat_default')!;
    expect(await tool.describe!(ctx, { agent_id: finanzas, visibility: 'read' })).toEqual({
      label: 'Cambiar quién lee las conversaciones nuevas con Finanzas',
      preview: 'Ahora: solo quien la abre\nDespués: el equipo puede leer',
    });
    await expect(tool.describe!(ctx, { agent_id: finanzas, visibility: 'everyone' })).rejects.toBeInstanceOf(SettingError);
    await tool.run(ctx, { agent_id: finanzas, visibility: 'read' });
    expect(calls).toEqual([['set_agent_chat_default', { target_agent: finanzas, new_default: 'read' }]]);
    expect(DATABASE_FUNCTIONS.set_conversation_visibility?.reach).toBe('never');
  });
});

describe('a refused settings change, as people read it', () => {
  it('is always in Spanish', async () => {
    const { refusal } = await import('../src/settings');
    expect(refusal({ code: '42501', message: "only an owner chooses an agent's tools" })).toBe('Solo quien es propietario de la empresa puede hacer este cambio.');
    expect(refusal({ code: '22023', message: 'tools must be up to 50 provider names' })).toMatch(/^Ese cambio no es válido/);
    expect(refusal(new SettingError('No hay ningún agente con ese id en esta organización.'))).toBe('No hay ningún agente con ese id en esta organización.');
    expect(refusal(new Error('fetch failed'))).toBe('No se ha podido hacer el cambio. Prueba otra vez en un momento.');
  });
});

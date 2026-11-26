import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DATABASE_FUNCTIONS, SETTING_TOOLS, SettingError, type SettingsContext } from '@ghostaff/shared/services';

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

function databaseFunctions(): Set<string> {
  const names = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    // In order: a function a later statement drops no longer exists (hire_secretaria, replaced by
    // hire_main_agent), and one dropped then created again (invite_member) still does.
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(/(create\s+(?:or\s+replace\s+)?|drop\s+(?:if\s+exists\s+)?)function\s+public\.([a-z_0-9]+)/gi)) {
      if (m[1]!.toLowerCase().startsWith('drop')) names.delete(m[2]!);
      else names.add(m[2]!);
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

  it('only reads without an approval', () => {
    expect(SETTING_TOOLS.filter((t) => !t.writes).map((t) => t.name)).toEqual(['settings_read', 'settings_read_routines', 'settings_read_external_parties']);
  });

  it('never lets an agent change its own accounts', async () => {
    const self = '20000000-0000-0000-0000-000000000001';
    const rows = [{ id: self, org_id: 'o', name: 'Secretaría', ghost: 'secretaria', is_main: true, department: 'direccion', member_default: 'talk', runner: 'chat', accounts: null, created_at: '' }];
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

describe('routines as settings (agent-routines.md)', () => {
  const secretaria = '20000000-0000-0000-0000-000000000001';
  const finanzas = '20000000-0000-0000-0000-000000000002';
  const routine = '30000000-0000-0000-0000-000000000001';
  const agentRow = (id: string, name: string, ghost: string) => ({
    id, org_id: 'o', name, ghost, department: 'finanzas', member_default: 'read', chat_default: 'private', runner: 'chat', accounts: null, created_at: '',
  });
  const routineRow = {
    id: routine, org_id: 'o', agent_id: finanzas, created_by: 'u', audience: 'me', title: 'Ventas', instruction: 'Resumen de ventas',
    kind: 'days', weekdays: [5], month_day: null, hour: 9, minute: 0, timezone: 'Europe/Madrid', paused: false, paused_reason: null,
    last_fired_at: '', created_at: '',
  };
  function client(calls: Array<[string, unknown]> = []) {
    const tables: Record<string, unknown[]> = {
      agents: [agentRow(secretaria, 'Secretaría', 'secretaria'), agentRow(finanzas, 'Finanzas', 'finanzas')],
      agent_routines: [routineRow],
    };
    const query = (rows: unknown[]) => {
      const q = { select: () => q, eq: () => q, order: () => q, returns: async () => ({ data: rows, error: null }) };
      return q;
    };
    return {
      from: (t: string) => query(tables[t] ?? []),
      rpc: (fn: string, args: unknown) => {
        calls.push([fn, args]);
        return { single: async () => ({ data: { ...routineRow, ...(args as object) }, error: null }) };
      },
    } as unknown as SupabaseClient;
  }
  const tool = (name: string) => SETTING_TOOLS.find((t) => t.name === name)!;

  it('turns «los viernes a las 9» into a card its asker approves, for «Solo para mí»', async () => {
    const ctx: SettingsContext = { client: client(), orgId: 'o', agentId: secretaria };
    const input = { agent_id: finanzas, audience: 'me', title: 'Ventas', instruction: 'Mándame el resumen de ventas', days: [5], hour: 9 };
    expect(await tool('settings_create_routine').describe!(ctx, input)).toEqual({
      label: 'Rutina de Finanzas: «Ventas»',
      preview: 'Cuándo: Cada viernes, 9:00\nQué: Mándame el resumen de ventas\nPara: solo para quien la pide',
      decider: 'requester',
    });
    expect((await tool('settings_create_routine').describe!(ctx, { ...input, audience: 'team' })).decider).toBe('owner');
  });

  it('refuses a timetable that is not one, in words', async () => {
    const ctx: SettingsContext = { client: client(), orgId: 'o', agentId: secretaria };
    const input = { agent_id: finanzas, audience: 'me', title: 'Ventas', instruction: 'x', days: [], hour: 9 };
    await expect(tool('settings_create_routine').describe!(ctx, input)).rejects.toThrow('Elige al menos un día.');
    await expect(tool('settings_create_routine').describe!(ctx, { ...input, days: [1], hour: 25 })).rejects.toBeInstanceOf(SettingError);
  });

  it('lets an agent that is not the main one propose only its own', async () => {
    const ctx: SettingsContext = { client: client(), orgId: 'o', agentId: secretaria, onlySelf: true };
    const input = { agent_id: finanzas, audience: 'me', title: 'Ventas', instruction: 'x', hour: 9 };
    await expect(tool('settings_create_routine').describe!(ctx, input)).rejects.toThrow(/Solo puedes proponer rutinas tuyas/);
    await expect(tool('settings_pause_routine').describe!(ctx, { routine_id: routine, paused: true })).rejects.toBeInstanceOf(SettingError);
    const own: SettingsContext = { ...ctx, agentId: finanzas };
    expect(JSON.parse(await tool('settings_read_routines').run(own, {}))).toMatchObject([{ id: routine, when: 'Cada viernes, 9:00' }]);
  });

  it('pauses through the function the screen calls, never deletes', async () => {
    const calls: Array<[string, unknown]> = [];
    const ctx: SettingsContext = { client: client(calls), orgId: 'o', agentId: secretaria };
    expect(await tool('settings_pause_routine').describe!(ctx, { routine_id: routine, paused: true })).toEqual({
      label: 'Pausar la rutina «Ventas»',
      preview: 'Ahora: Cada viernes, 9:00\nDespués: en pausa',
      decider: 'requester',
    });
    await tool('settings_pause_routine').run(ctx, { routine_id: routine, paused: true });
    expect(calls).toEqual([['set_routine_paused', { target_routine: routine, paused: true }]]);
    expect(DATABASE_FUNCTIONS.delete_routine?.reach).toBe('never');
  });
});

describe('who the organisation works with outside (external-parties.md)', () => {
  const finanzas = '20000000-0000-0000-0000-000000000002';
  const gestoria = '30000000-0000-0000-0000-000000000001';
  const row = {
    id: gestoria, org_id: 'o', kind: 'company', name: 'Gestoría López', role: 'Presenta el IVA cada trimestre', departments: ['finanzas'],
    email: null, phone: '910000000', website: null, added_by_name: 'Ana', added_at: '2026-11-26T10:00:00Z', proposed_by_name: null, pending: null,
  };
  function client(calls: Array<[string, unknown]> = []) {
    const query = {
      select: () => query,
      eq: (col: string, v: string) => (col === 'id' && v !== gestoria ? { ...query, maybeSingle: async () => ({ data: null, error: null }) } : query),
      order: () => query,
      returns: async () => ({ data: [row], error: null }),
      maybeSingle: async () => ({ data: row, error: null }),
    };
    return {
      from: () => query,
      rpc: async (fn: string, args: unknown) => (calls.push([fn, args]), { data: gestoria, error: null }),
    } as unknown as SupabaseClient;
  }
  const tool = (name: string) => SETTING_TOOLS.find((t) => t.name === name)!;
  const ana = { kind: 'person', name: ' Ana López ', does: 'Hace las ilustraciones', departments: ['marketing'], email: 'ana@ejemplo.com', website: 'analopez.es' };

  it('is open to every agent, not only the main one', async () => {
    const { settingsTools } = await import('../src/settings');
    const names = settingsTools({ client: client(), orgId: 'o', agentId: finanzas, onlySelf: true }).specs.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['settings_read_external_parties', 'settings_save_external_party', 'settings_remove_external_party']));
    expect(names).not.toContain('settings_invite_member');
  });

  it('turns a proposal into a card an owner approves, then saves it as the agent\'s', async () => {
    const calls: Array<[string, unknown]> = [];
    const ctx: SettingsContext = { client: client(calls), orgId: 'o', agentId: finanzas, onlySelf: true };
    expect(await tool('settings_save_external_party').describe!(ctx, ana)).toEqual({
      label: 'Añadir a Ana López a con quién trabajáis',
      preview: 'Ana López (Persona · Marketing)\nHace las ilustraciones\nana@ejemplo.com\nhttps://analopez.es',
      decider: 'owner',
    });
    await tool('settings_save_external_party').run(ctx, ana);
    expect(calls).toEqual([
      ['save_external_party', {
        target_org: 'o', party: null, new_kind: 'person', new_name: 'Ana López', new_role: 'Hace las ilustraciones', new_departments: ['marketing'],
        new_email: 'ana@ejemplo.com', new_phone: null, new_website: 'https://analopez.es', proposed_by: finanzas,
      }],
    ]);
  });

  it('shows a change as now and after', async () => {
    const ctx: SettingsContext = { client: client(), orgId: 'o', agentId: finanzas };
    const input = { external_party_id: gestoria, kind: 'company', name: 'Gestoría López', does: 'Presenta el IVA y las nóminas', departments: ['finanzas'] };
    const card = await tool('settings_save_external_party').describe!(ctx, input);
    expect(card.label).toBe('Cambiar a Gestoría López en con quién trabajáis');
    expect(card.preview).toBe(
      'Ahora: Gestoría López (Empresa · Finanzas)\nPresenta el IVA cada trimestre\n910000000\n\nDespués: Gestoría López (Empresa · Finanzas)\nPresenta el IVA y las nóminas',
    );
  });

  it('refuses what the list may not hold, in words', async () => {
    const ctx: SettingsContext = { client: client(), orgId: 'o', agentId: finanzas };
    await expect(tool('settings_save_external_party').describe!(ctx, { ...ana, does: ' ' })).rejects.toThrow('Di qué hace para vosotros');
    await expect(tool('settings_save_external_party').describe!(ctx, { ...ana, kind: 'friend' })).rejects.toBeInstanceOf(SettingError);
    await expect(tool('settings_save_external_party').describe!(ctx, { ...ana, email: 'no' })).rejects.toThrow('Ese correo no parece válido.');
    await expect(tool('settings_remove_external_party').describe!(ctx, { external_party_id: '30000000-0000-0000-0000-000000000009' })).rejects.toBeInstanceOf(SettingError);
  });

  it('removes through the function the screen calls', async () => {
    const calls: Array<[string, unknown]> = [];
    const ctx: SettingsContext = { client: client(calls), orgId: 'o', agentId: finanzas };
    expect((await tool('settings_remove_external_party').describe!(ctx, { external_party_id: gestoria })).label).toBe('Quitar a Gestoría López de con quién trabajáis');
    await tool('settings_remove_external_party').run(ctx, { external_party_id: gestoria });
    expect(calls).toEqual([['remove_external_party', { party: gestoria }]]);
  });

  it('reads one department\'s for the model', async () => {
    const ctx: SettingsContext = { client: client(), orgId: 'o', agentId: finanzas };
    expect(JSON.parse(await tool('settings_read_external_parties').run(ctx, { department: 'marketing' }))).toEqual([]);
    expect(JSON.parse(await tool('settings_read_external_parties').run(ctx, { department: 'finanzas' }))).toMatchObject([{ id: gestoria, does: 'Presenta el IVA cada trimestre' }]);
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

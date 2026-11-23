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
});

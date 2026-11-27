// The organisation's settings as tools of its main agent (docs/plans/ongoing/
// agent-settings.md; the tools themselves are in @ghostaff/shared/services,
// beside the functions the app's screens use).
//
// Every tool runs with a client signed in as a person, never the service role:
// a read as the person who asked, so the agent sees what they would see in the
// app; a change only once an owner approves it (actions.ts), as that owner, so
// the database checks it exactly as if they had made it on the screen.

import { EVERY_AGENT_TOOL_NAMES, EXTERNAL_TOOL_NAMES, SETTING_TOOLS, SettingError, type SettingsContext } from '@ghostaff/shared/services';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AgentTools } from './tools';

/** A Supabase client acting as the person whose access token this is. */
export type AsPerson = (accessToken: string) => SupabaseClient;

/**
 * The service key only lets the request through the gateway: with the person's
 * token as Authorization, Postgres runs it as them (role authenticated,
 * auth.uid() theirs), row-level security included.
 */
export function asPersonFactory(url: string, gatewayKey: string): AsPerson {
  return (accessToken) => {
    if (!accessToken) throw new Error('a person is needed');
    return createClient(url, gatewayKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  };
}

export const SETTINGS_PREFIX = 'settings_';

export const isSettingTool = (name: string) => SETTING_TOOLS.some((t) => t.name === name);

/** The database's refusals, by Postgres error code, in words a person reads on the card. */
const REFUSALS: Record<string, string> = {
  '42501': 'Solo quien es propietario de la empresa puede hacer este cambio.',
  '22023': 'Ese cambio no es válido. Revisa los datos y vuelve a proponerlo.',
  '23505': 'Eso ya existe: por ejemplo, esa persona ya está en la empresa.',
  '23514': 'Ese valor no está permitido.',
  '54000': 'Se ha llegado al límite para esto (por ejemplo, diez tareas programadas por persona).',
};

/** What a refusal says to the model and on the card, always in Spanish: ours as written, the database's by its code. */
export function refusal(e: unknown): string {
  if (e instanceof SettingError) return e.message;
  const code = (e as { code?: unknown })?.code;
  const known = typeof code === 'string' ? REFUSALS[code] : undefined;
  if (known) return known;
  console.error('settings change failed', typeof code === 'string' ? code : typeof e);
  return 'No se ha podido hacer el cambio. Prueba otra vez en un momento.';
}

/** Runs one settings tool; never throws. */
export async function runSetting(ctx: SettingsContext, name: string, input: unknown) {
  const tool = SETTING_TOOLS.find((t) => t.name === name);
  if (!tool) return { content: `No existe la herramienta ${name}.`, isError: true };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { content: 'La entrada de la herramienta tiene que ser un objeto.', isError: true };
  }
  try {
    return { content: await tool.run(ctx, input as Record<string, unknown>), isError: false };
  } catch (e) {
    return { content: refusal(e), isError: true };
  }
}

/**
 * The settings tools in one reply, reading as the person who asked: every one
 * for the main agent; for any other, only those for its own routines
 * (`ctx.onlySelf`, agent-routines.md) and those for who the organisation works
 * with outside (external-parties.md).
 */
export function settingsTools(ctx: SettingsContext, only?: readonly string[]): AgentTools {
  const allowed: readonly string[] | null = only ?? (ctx.onlySelf ? EVERY_AGENT_TOOL_NAMES : null);
  const tools = allowed ? SETTING_TOOLS.filter((t) => allowed.includes(t.name)) : SETTING_TOOLS;
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    specs: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
    accounts: [],
    stepFor: (name) => byName.get(name)?.step ?? 'Trabajando',
    writes: (name) => byName.get(name)?.writes ?? true,
    actionFor: (name) => byName.get(name)?.step ?? name,
    async describe(name, input) {
      const tool = byName.get(name);
      if (!tool?.describe) return null;
      return tool.describe(ctx, input);
    },
    run: (name, input) => (byName.has(name) ? runSetting(ctx, name, input) : Promise.resolve({ content: `No existe la herramienta ${name}.`, isError: true })),
  };
}

export { SettingError };

/**
 * The settings tools of a turn nobody asked for (a routine's, agent-routines.md decision 3): only
 * who the organisation works with (external-parties.md). With no person to read as, the list is read
 * with the engine's own client, scoped to the organisation: every member may read it, so it shows
 * nothing a person in the organisation could not see. A proposal still waits for an owner's approval
 * and then runs as that owner (actions.ts).
 */
export function unaskedSettingsTools(engineClient: SupabaseClient, orgId: string, agentId: string): AgentTools {
  return settingsTools({ client: engineClient, orgId, agentId, onlySelf: true }, EXTERNAL_TOOL_NAMES);
}

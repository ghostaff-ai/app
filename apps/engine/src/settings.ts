// The organisation's settings as tools of its main agent (docs/plans/ongoing/
// agent-settings.md; the tools themselves are in @ghostaff/shared/services,
// beside the functions the app's screens use).
//
// Every tool runs with a client signed in as a person, never the service role:
// a read as the person who asked, so the agent sees what they would see in the
// app; a change only once an owner approves it (actions.ts), as that owner, so
// the database checks it exactly as if they had made it on the screen.

import { SETTING_TOOLS, SettingError, type SettingsContext } from '@ghostaff/shared/services';
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
  '54000': 'La empresa ha llegado al límite para esto.',
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

/** The settings tools for the main agent in one reply, reading as the person who asked. */
export function settingsTools(ctx: SettingsContext): AgentTools {
  const byName = new Map(SETTING_TOOLS.map((t) => [t.name, t]));
  return {
    specs: SETTING_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
    accounts: [],
    stepFor: (name) => byName.get(name)?.step ?? 'Trabajando',
    writes: (name) => byName.get(name)?.writes ?? true,
    actionFor: (name) => byName.get(name)?.step ?? name,
    async describe(name, input) {
      const tool = byName.get(name);
      if (!tool?.describe) return null;
      return tool.describe(ctx, input);
    },
    run: (name, input) => runSetting(ctx, name, input),
  };
}

export { SettingError };

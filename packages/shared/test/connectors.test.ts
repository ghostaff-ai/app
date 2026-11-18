import { describe, expect, it } from 'vitest';
import { ACCOUNT_PROVIDERS, CONNECTORS } from '../src/connectors';

describe('the connector catalogue', () => {
  it('ids fit the database check and are unique', () => {
    // supabase/migrations/20261119000000_account_connections.sql: provider ~ '^[a-z][a-z0-9]{1,30}$'
    for (const id of ACCOUNT_PROVIDERS) expect(id).toMatch(/^[a-z][a-z0-9]{1,30}$/);
    expect(new Set(ACCOUNT_PROVIDERS).size).toBe(ACCOUNT_PROVIDERS.length);
  });

  it('every maker\'s server is https, and every card says plainly what agents can do', () => {
    for (const c of CONNECTORS) {
      if (c.kind === 'mcp') expect(new URL(c.url).protocol).toBe('https:');
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.reach).toMatch(/^Tus agentes podrán /);
    }
  });

  it('Google comes first: the order Conexiones shows is the order of priority', () => {
    expect(CONNECTORS[0]?.id).toBe('google');
  });
});

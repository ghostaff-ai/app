import { describe, expect, it } from 'vitest';
import { ACCOUNT_PROVIDERS, CONNECTOR_AREAS, CONNECTORS } from '../src/connectors';

describe('the connector catalogue', () => {
  it('ids fit the database check and are unique', () => {
    // supabase/migrations/20261119000000_account_connections.sql: provider ~ '^[a-z][a-z0-9]{1,30}$'
    for (const id of ACCOUNT_PROVIDERS) expect(id).toMatch(/^[a-z][a-z0-9]{1,30}$/);
    expect(new Set(ACCOUNT_PROVIDERS).size).toBe(ACCOUNT_PROVIDERS.length);
  });

  it('no catalogue id starts with x, except xero: guided accesses take that prefix (guidedProvider)', () => {
    expect(ACCOUNT_PROVIDERS.filter((id) => id.startsWith('x'))).toEqual(['xero']);
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

  it('every area has cards, and the catalogue is in area order', () => {
    for (const area of CONNECTOR_AREAS) expect(CONNECTORS.some((c) => c.area === area)).toBe(true);
    const order = CONNECTORS.map((c) => CONNECTOR_AREAS.indexOf(c.area));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { listAskedDecisions } from '../src/services';

/** A real supabase-js client whose requests are recorded and answered with `rows`, so the test sees the exact query PostgREST would get. */
function recordingClient(rows: unknown[]) {
  const urls: URL[] = [];
  const fetch = async (input: RequestInfo | URL) => {
    urls.push(new URL(input instanceof Request ? input.url : String(input)));
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = createClient('http://supabase.test', 'anon-key', { global: { fetch }, auth: { persistSession: false } });
  return { client, urls };
}

describe('listAskedDecisions', () => {
  it('asks PostgREST for jsonb containment, which needs JSON and not a Postgres array', async () => {
    const { client, urls } = recordingClient([]);
    await listAskedDecisions(client, 'org-1', 'user-1');
    expect(urls).toHaveLength(1);
    const [url] = urls as [URL];
    expect(url.pathname).toBe('/rest/v1/messages');
    expect(url.searchParams.get('parts')).toBe('cs.[{"type":"decision_quote"}]');
    expect(url.searchParams.get('org_id')).toBe('eq.org-1');
    expect(url.searchParams.get('author_user')).toBe('eq.user-1');
  });

  it('collects the quoted decisions, skipping the other parts', async () => {
    const { client } = recordingClient([
      { parts: [{ type: 'decision_quote', decisionId: 'd-1', title: 'Uno' }, { type: 'text', text: '¿Y esto?' }] },
      { parts: [{ type: 'decision_quote', decisionId: 'd-2', title: 'Dos' }] },
      { parts: [{ type: 'decision_quote', decisionId: 'd-1', title: 'Uno' }] },
    ]);
    expect(await listAskedDecisions(client, 'org-1', 'user-1')).toEqual(new Set(['d-1', 'd-2']));
  });
});

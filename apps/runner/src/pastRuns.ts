// Earlier runs for the agent (transcripts.ts in the engine), served by the runner on 127.0.0.1 only: the
// agent's `ghostaff` command (cli.ts) asks here, and the runner (root) asks the engine with the run's nonce,
// which the agent never sees. The engine decides what the run may read: its own agent's runs, and its
// organisation's other agents' only when the agent's row says so; never another organisation's.
//
//   GET /runs?agent=<slug>&n=<1..50>   the agent's recent runs, newest first (its own without `agent`)
//   GET /runs/<run id>                 that run's transcript: stream-json, one event per line

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';

/** POST to the engine under this run (`/runs/<run><path>`), with the nonce added by the caller. */
export type AskEngine = (path: string, body: Record<string, unknown>) => Promise<Response>;

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RUN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function servePastRuns(ask: AskEngine, onError: (e: unknown) => void): Promise<{ url: string; close(): void }> {
  const server = createServer(async (req, res) => {
    const json = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method !== 'GET') return json(405, { error: 'method' });
      if (url.pathname === '/runs') {
        const agent = url.searchParams.get('agent');
        const n = url.searchParams.get('n');
        if ((agent !== null && !SLUG.test(agent)) || (n !== null && !/^\d{1,2}$/.test(n))) return json(400, { error: 'bad_request', message: 'agente o número no válidos' });
        const r = await ask('/past-runs', { ...(agent ? { agent } : {}), ...(n ? { limit: Number(n) } : {}) });
        return json(r.status, await r.json().catch(() => ({ error: 'failed' })));
      }
      const m = /^\/runs\/([^/]+)$/.exec(url.pathname);
      if (m && RUN.test(m[1]!)) {
        const r = await ask(`/past-runs/${m[1]!.toLowerCase()}`, {});
        if (!r.ok) return json(r.status, await r.json().catch(() => ({ error: 'failed' })));
        const text = gunzipSync(Buffer.from(await r.arrayBuffer()));
        return res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }).end(text);
      }
      return json(404, { error: 'not_found' });
    } catch (e) {
      onError(e);
      return json(502, { error: 'engine', message: 'no he podido preguntar al motor' });
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

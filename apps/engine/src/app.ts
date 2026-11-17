// The engine's HTTP service: it connects AI accounts, and it is the agents'
// always-on service for the team chat (an agent answering in a thread). Every call but
// /health carries the person's Supabase access token, so the engine knows who
// is asking; what they may do is checked against their membership.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { agentHello, type ChatDeps, replyInThread } from './chat';
import { connectAi, type Deps, disconnectAi, Refusal } from './connections';

export interface AppDeps extends Deps {
  /** The signed-in person behind a Supabase access token, or null. */
  userFromToken(token: string): Promise<string | null>;
  /** The service account customers grant Vertex AI access to. */
  serviceAccount: string;
  /** The team chat: agents answering in threads. */
  chat: ChatDeps;
}

type Env = { Variables: { userId: string } };

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();

  // Bearer tokens, no cookies: any origin may call, the token is the guard.
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'DELETE'], allowHeaders: ['Authorization', 'Content-Type'] }));

  app.get('/health', (c) => c.json({ ok: true }));

  app.use('*', async (c, next) => {
    const token = c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    const userId = token ? await deps.userFromToken(token).catch(() => null) : null;
    if (!userId) return c.json({ error: 'unauthorized', message: 'sign in first' }, 401);
    c.set('userId', userId);
    await next();
  });

  app.get('/identity', (c) => c.json({ serviceAccount: deps.serviceAccount }));

  app.post('/connections/ai', async (c) => {
    const body = await c.req.json().catch(() => null);
    const connection = await connectAi(deps, c.get('userId'), body);
    return c.json({ connection }, 201);
  });

  app.delete('/connections/ai/:provider', async (c) => {
    await disconnectAi(deps, c.get('userId'), c.req.query('org'), c.req.param('provider'));
    return c.json({ ok: true });
  });

  // Answers when the reply is written: Cloud Run keeps the CPU only while a request is open.
  app.post('/threads/:id/reply', async (c) => c.json(await replyInThread(deps.chat, c.get('userId'), c.req.param('id'))));

  app.post('/agents/:id/hello', async (c) => c.json(await agentHello(deps.chat, c.get('userId'), c.req.param('id')), 201));

  app.onError((e, c) => {
    if (e instanceof Refusal) return c.json({ error: e.code, message: e.message }, e.status);
    // Never echo an unexpected error: it could carry a key from the request.
    console.error('engine error', e instanceof Error ? e.name : typeof e);
    return c.json({ error: 'failed', message: 'something went wrong' }, 500);
  });

  return app;
}

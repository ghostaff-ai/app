// The engine's HTTP service: it connects AI accounts and outside accounts, and
// it is the agents' always-on service for the team chat (an agent answering in
// a thread). Every call but /health and a provider's sign-in callback carries
// the person's Supabase access token, so the engine knows who is asking; what
// they may do is checked against their membership. The callback only passes the
// provider's code on to the app, which finishes the connect signed in (accounts.ts).

import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type ClaudeSession, type ClaudeSessionDeps, claudeSession } from './claudeSession';
import { type AccountDeps, disconnectAccount, finishAccountConnect, returnFromProvider, startAccountConnect } from './accounts';
import { type ActionDeps, approveAction, rejectAction } from './actions';
import { CONNECTORS } from '@ghostaff/shared';
import { agentHello, type ChatDeps, replyInThread } from './chat';
import { reportRun } from './jobs';
import { clientMetadataDocument } from './mcp';
import { connectAi, type Deps, disconnectAi, Refusal } from './connections';
import { bearer, type CallerFromToken } from './googleCaller';

/** Calls from Google service accounts, not people: the scheduler's tick (ordago-agents-in-ghostaff.md). */
export interface CronDeps {
  callerFromToken: CallerFromToken;
  /** The audience the ID tokens are issued for: the engine's public URL. */
  audience: string;
  /** The service accounts allowed to tick. */
  callers: string[];
  /** One tick: sync every record, start what is due. Answers with what it did. */
  tick(): Promise<unknown>;
}

export interface AppDeps extends Deps {
  /** The signed-in person behind a Supabase access token, or null. */
  userFromToken(token: string): Promise<string | null>;
  /** The service account customers grant Vertex AI access to. */
  serviceAccount: string;
  /** The team chat: agents answering in threads. */
  chat: ChatDeps;
  /** Outside accounts connected by signing in there. */
  accounts: AccountDeps;
  /** What agents propose to do with those accounts, for an owner to approve. */
  actions: ActionDeps;
  /** The scheduler's tick; off when not configured. */
  cron?: CronDeps;
  /** Checks the Google ID token of a job reporting its run (jobs.ts); off when not configured. */
  reports?: { callerFromToken: CallerFromToken; audience: string };
  /** Connecting a Claude subscription through Claude Code's own sign-in (claudeSession.ts). */
  claudeSignIn?: Omit<ClaudeSessionDeps, 'store' | 'vault' | 'userFromToken' | 'now'>;
}

type Env = { Variables: { userId: string } };

/** The engine's routes; `injectWebSocket` hooks the WebSocket route into the Node server. */
export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  // Bearer tokens, no cookies: any origin may call, the token is the guard.
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'DELETE'], allowHeaders: ['Authorization', 'Content-Type'] }));

  app.get('/health', (c) => c.json({ ok: true }));

  // Who Ghostaff is, for MCP servers that take a URL as the client id (CIMD). Public by design.
  app.get('/oauth/client-metadata.json', (c) => c.json(clientMetadataDocument(deps.accounts.publicUrl, CONNECTORS)));

  // The provider sends the browser here after sign-in; no Supabase token on this one.
  app.get('/connections/oauth/:provider/callback', async (c) => {
    const to = await returnFromProvider(deps.accounts, c.req.param('provider'), {
      state: c.req.query('state'),
      code: c.req.query('code'),
      error: c.req.query('error'),
    });
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    if (!to) return c.text('Este enlace ya no sirve. Vuelve a Ghostaff y conecta la cuenta otra vez.', 400);
    return c.redirect(to, 302);
  });

  // Cloud Scheduler, as its own service account; no Supabase token on this one.
  app.post('/cron', async (c) => {
    const cron = deps.cron;
    const token = bearer(c.req.header('Authorization'));
    const caller = cron && token ? await cron.callerFromToken(token, cron.audience) : null;
    if (!cron || !caller || !cron.callers.includes(caller)) return c.json({ error: 'unauthorized' }, 401);
    return c.json({ ok: true, did: await cron.tick() });
  });

  // An agent's job at the end of a run, as its own service account (jobs.ts); no Supabase token on this one.
  app.post('/runs/report', async (c) => {
    const reports = deps.reports;
    const token = bearer(c.req.header('Authorization'));
    const caller = reports && token ? await reports.callerFromToken(token, reports.audience) : null;
    if (!reports || !caller || !deps.chat.jobs) return c.json({ error: 'unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    const done = await reportRun(deps.chat, deps.chat.jobs, caller, body);
    // Someone wrote while the job worked: their message gets its answer now, with their rights.
    if (done.threadId) {
      const [last] = (await deps.chat.chat.recentMessages(done.threadId, 1)).slice(-1);
      if (last?.authorKind === 'person' && last.authorUserId) {
        await replyInThread(deps.chat, last.authorUserId, done.threadId).catch(() => {});
      }
    }
    return c.json({ ok: true, run: done.run });
  });

  // Connecting a Claude subscription: one WebSocket for the whole sign-in. A
  // browser cannot set headers on a WebSocket, so the Supabase token comes as
  // the first message instead (claudeSession.ts checks it).
  app.get(
    '/connections/ai/claude/session',
    upgradeWebSocket(() => {
      let session: ClaudeSession | null = null;
      return {
        onOpen(_event, ws) {
          const socket = { send: (m: Record<string, unknown>) => ws.send(JSON.stringify(m)), close: () => ws.close() };
          if (!deps.claudeSignIn) {
            socket.send({ type: 'error', code: 'claude_unavailable' });
            socket.close();
            return;
          }
          session = claudeSession(
            { ...deps.claudeSignIn, store: deps.store, vault: deps.vault, userFromToken: deps.userFromToken, now: deps.now },
            socket,
          );
        },
        onMessage(event) {
          if (typeof event.data === 'string') session?.onMessage(event.data);
        },
        onClose() {
          session?.onClose();
        },
      };
    }),
  );

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

  app.post('/connections/accounts/:provider/start', async (c) => {
    const body = await c.req.json().catch(() => null);
    return c.json(await startAccountConnect(deps.accounts, c.get('userId'), c.req.param('provider'), body));
  });

  app.post('/connections/accounts/:provider/finish', async (c) => {
    const body = await c.req.json().catch(() => null);
    return c.json(await finishAccountConnect(deps.accounts, c.get('userId'), c.req.param('provider'), body));
  });

  app.delete('/connections/accounts/:provider', async (c) => {
    await disconnectAccount(deps.accounts, c.get('userId'), c.req.query('org'), c.req.param('provider'));
    return c.json({ ok: true });
  });

  // Answers when the action has run: Cloud Run keeps the CPU only while a request is open.
  app.post('/actions/:id/approve', async (c) => c.json(await approveAction(deps.actions, c.get('userId'), c.req.param('id'))));

  app.post('/actions/:id/reject', async (c) => c.json(await rejectAction(deps.actions, c.get('userId'), c.req.param('id'))));

  // Answers when the reply is written: Cloud Run keeps the CPU only while a request is open.
  app.post('/threads/:id/reply', async (c) => c.json(await replyInThread(deps.chat, c.get('userId'), c.req.param('id'))));

  app.post('/agents/:id/hello', async (c) => c.json(await agentHello(deps.chat, c.get('userId'), c.req.param('id')), 201));

  app.onError((e, c) => {
    if (e instanceof Refusal) return c.json({ error: e.code, message: e.message }, e.status);
    // Never echo an unexpected error: it could carry a key from the request.
    console.error('engine error', e instanceof Error ? e.name : typeof e);
    return c.json({ error: 'failed', message: 'something went wrong' }, 500);
  });

  return Object.assign(app, { injectWebSocket });
}

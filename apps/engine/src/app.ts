// The engine's HTTP service: it connects AI accounts and outside accounts, and
// it is the agents' always-on service for the team chat (an agent answering in
// a thread). Every call but /health and a provider's sign-in callback carries
// the person's Supabase access token, so the engine knows who is asking; what
// they may do is checked against their membership. The callback only passes the
// provider's code on to the app, which finishes the connect signed in (accounts.ts).

import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { type ClaudeSession, type ClaudeSessionDeps, claudeSession, MAX_MESSAGE } from './claudeSession';
import { type AccountDeps, disconnectAccount, finishAccountConnect, returnFromProvider, startAccountConnect } from './accounts';
import { type ActionDeps, approveAction, rejectAction } from './actions';
import { CONNECTORS } from '@ghostaff/shared';
import { agentHello, answerWaiting, type ChatDeps, replyInThread, resumeInThread } from './chat';
import { approveGuide, checkGuide, type GuideDeps, getGuide, guidedAccessUndo, guideStep, MAX_STEP_BODY, pendingGuides, rejectGuide, removeGuidedAccess } from './guides';
import { PHOTO_TOO_BIG } from './guideModel';
import { reportRun } from './jobs';
import { runGoogleToken, runRepoToken, runRecordToken, runSpec } from './runner';
import { MAX_TRANSCRIPT_BYTES, pastRuns, pastTranscript, runTranscript } from './transcripts';
import { clientMetadataDocument } from './mcp';
import { connectAi, type Deps, disconnectAi, Refusal, requireOwner } from './connections';
import { bearer, type CallerFromToken } from './googleCaller';
import type { PushDrain } from './notify';
import { NoteLimiter, type Transcriber } from './transcribe';
import { sendVoiceNote, transcribeVoiceNote, type VoiceNoteStore } from './voiceNotes';
import { receiveRunAudio } from './agentAudio';

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
  /**
   * The organisation's own Google Cloud account, created the first time
   * (cloudAccounts.ts): what a customer grants roles to. Off without a tenants project.
   */
  cloudAccount?(orgId: string): Promise<string>;
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
  /** Voice notes: the bucket and the person's messages (voiceNotes.ts). */
  voice?: VoiceNoteStore;
  /** A voice note into text (transcribe.ts); off when not configured, and voice notes with it. */
  transcriber?: Transcriber;
  /** Voice notes' per-person limit (30 an hour by default); injectable for tests. */
  transcribeLimiter?: NoteLimiter;
  /** Guides an agent starts to get an access (guides.ts); off when not configured. */
  guides?: GuideDeps;
  /** The drain of pushes the engine's own writes queued (notify.ts); off when push is. */
  pushes?: PushDrain;
}

type Env = { Variables: { userId: string; accessToken: string } };

/** The engine's routes; `injectWebSocket` hooks the WebSocket route into the Node server. */
export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();
  const { upgradeWebSocket, injectWebSocket, wss } = createNodeWebSocket({ app });
  // The only socket is the Claude sign-in, whose messages are tiny: ws would
  // otherwise buffer up to 100 MiB from anyone, signed in or not.
  (wss.options as { maxPayload?: number }).maxPayload = MAX_MESSAGE;

  // Bearer tokens, no cookies: any origin may call, the token is the guard.
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'DELETE'], allowHeaders: ['Authorization', 'Content-Type'] }));

  // A request that wrote an agent's message answers once its pushes are out: after the answer, Cloud Run
  // gives the instance no CPU, and they would wait for the tick. Requests that wrote none do not wait.
  const pushes = deps.pushes;
  if (pushes) app.use('*', (_c, next) => pushes.request(next));

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
    // Someone wrote while the job worked: what waits gets its answer now, each with its author's rights.
    if (done.threadId) {
      const thread = await deps.chat.chat.thread(done.threadId);
      if (thread) await answerWaiting(deps.chat, thread).catch(() => {});
    }
    return c.json({ ok: true, run: done.run });
  });

  // Our runner fetching its run's spec, once, and a fresh record token later, as its own service account and with
  // the run's nonce (runner.ts); no Supabase token on these. What they answer is secret: never cached.
  app.post('/runs/:id/spec', async (c) => {
    const reports = deps.reports;
    const token = bearer(c.req.header('Authorization'));
    const caller = reports && token ? await reports.callerFromToken(token, reports.audience) : null;
    if (!reports || !caller || !deps.chat.jobs?.runner) return c.json({ error: 'unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    c.header('Cache-Control', 'no-store');
    return c.json(await runSpec(deps.chat, deps.chat.jobs, caller, c.req.param('id'), body));
  });

  app.post('/runs/:id/record-token', async (c) => {
    const reports = deps.reports;
    const token = bearer(c.req.header('Authorization'));
    const caller = reports && token ? await reports.callerFromToken(token, reports.audience) : null;
    if (!reports || !caller || !deps.chat.jobs?.runner) return c.json({ error: 'unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    c.header('Cache-Control', 'no-store');
    return c.json(await runRecordToken(deps.chat.jobs, caller, c.req.param('id'), body));
  });

  app.post('/runs/:id/repo-token', async (c) => {
    const reports = deps.reports;
    const token = bearer(c.req.header('Authorization'));
    const caller = reports && token ? await reports.callerFromToken(token, reports.audience) : null;
    if (!reports || !caller || !deps.chat.jobs?.runner) return c.json({ error: 'unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    c.header('Cache-Control', 'no-store');
    return c.json(await runRepoToken(deps.chat.jobs, caller, c.req.param('id'), body));
  });

  // One audio the run made (agentAudio.ts), before it reports: the raw file, its title in the query, the nonce in a header.
  app.post('/runs/:id/audio', async (c) => {
    const reports = deps.reports;
    const token = bearer(c.req.header('Authorization'));
    const caller = reports && token ? await reports.callerFromToken(token, reports.audience) : null;
    if (!reports || !caller || !deps.chat.jobs?.runner) return c.json({ error: 'unauthorized' }, 401);
    const stored = await receiveRunAudio(deps.chat, deps.chat.jobs, caller, c.req.param('id'), {
      nonce: c.req.header('X-Run-Nonce'),
      title: c.req.query('title'),
      contentType: c.req.header('Content-Type'),
      contentLength: c.req.header('Content-Length'),
      body: c.req.raw.body,
    });
    return c.json(stored, 201);
  });

  app.post('/runs/:id/google-token', async (c) => {
    const reports = deps.reports;
    const token = bearer(c.req.header('Authorization'));
    const caller = reports && token ? await reports.callerFromToken(token, reports.audience) : null;
    if (!reports || !caller || !deps.chat.jobs?.runner) return c.json({ error: 'unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    c.header('Cache-Control', 'no-store');
    return c.json(await runGoogleToken(deps.chat.jobs, caller, c.req.param('id'), body));
  });

  // A run's own transcript, gzipped, before it reports; and an agent reading earlier runs of its organisation through
  // its run (transcripts.ts). As our runner's account, with the run's nonce: in a header for the transcript, whose body
  // is the gzip itself. What they answer is the organisation's: never cached.
  app.post(
    '/runs/:id/transcript',
    bodyLimit({ maxSize: MAX_TRANSCRIPT_BYTES, onError: (c) => c.json({ error: 'too_big' }, 413) }),
    async (c) => {
      const reports = deps.reports;
      const token = bearer(c.req.header('Authorization'));
      const caller = reports && token ? await reports.callerFromToken(token, reports.audience) : null;
      if (!reports || !caller || !deps.chat.jobs?.runner) return c.json({ error: 'unauthorized' }, 401);
      const gz = new Uint8Array(await c.req.arrayBuffer());
      return c.json(await runTranscript(deps.chat.jobs, caller, c.req.param('id'), c.req.header('X-Ghostaff-Nonce'), gz));
    },
  );

  app.post('/runs/:id/past-runs', async (c) => {
    const reports = deps.reports;
    const token = bearer(c.req.header('Authorization'));
    const caller = reports && token ? await reports.callerFromToken(token, reports.audience) : null;
    if (!reports || !caller || !deps.chat.jobs?.runner) return c.json({ error: 'unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    c.header('Cache-Control', 'no-store');
    return c.json(await pastRuns(deps.chat.jobs, caller, c.req.param('id'), body));
  });

  app.post('/runs/:id/past-runs/:other', async (c) => {
    const reports = deps.reports;
    const token = bearer(c.req.header('Authorization'));
    const caller = reports && token ? await reports.callerFromToken(token, reports.audience) : null;
    if (!reports || !caller || !deps.chat.jobs?.runner) return c.json({ error: 'unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    const gz = await pastTranscript(deps.chat.jobs, caller, c.req.param('id'), c.req.param('other'), body);
    return c.body(gz as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store' });
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
    c.set('accessToken', token!);
    await next();
  });

  app.post('/cloud-account', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const orgId = (body as { orgId?: unknown }).orgId;
    await requireOwner(deps.store, orgId, c.get('userId'));
    if (!deps.cloudAccount) throw new Refusal(503, 'not_configured', 'no tenants project for Google Cloud accounts');
    return c.json({ email: await deps.cloudAccount(orgId as string) });
  });

  app.post('/connections/ai', async (c) => {
    const body = await c.req.json().catch(() => null);
    const connection = await connectAi(deps, c.get('userId'), body);
    return c.json({ connection }, 201);
  });

  // By the connection's id; an app from before several AI accounts names the provider (connections.ts).
  app.delete('/connections/ai/:which', async (c) => {
    await disconnectAi(deps, c.get('userId'), c.req.query('org'), c.req.param('which'));
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
  app.post('/actions/:id/approve', async (c) => {
    // «Editar»: the person's changes to the action's text, if any (docs/plans/ongoing/model-routing.md).
    const body = (await c.req.json().catch(() => null)) as { edits?: unknown } | null;
    return c.json(await approveAction(deps.actions, c.get('userId'), c.req.param('id'), c.get('accessToken'), body?.edits));
  });

  app.post('/actions/:id/reject', async (c) => c.json(await rejectAction(deps.actions, c.get('userId'), c.req.param('id'))));

  // Answers when the reply is written: Cloud Run keeps the CPU only while a request is open.
  app.post('/threads/:id/reply', async (c) => c.json(await replyInThread(deps.chat, c.get('userId'), c.req.param('id'), c.get('accessToken'))));

  // The agent goes on once the account it asked for, or the guide it started, is there; answers when its reply is written.
  app.post('/threads/:id/resume', async (c) => {
    const body = await c.req.json().catch(() => null);
    return c.json(await resumeInThread(deps.chat, c.get('userId'), c.req.param('id'), body, c.get('accessToken')));
  });

  // Guides (guides.ts): the screen reads one, asks for its next step, checks what the person typed; an owner decides a member's grant.
  const guides = () => {
    if (!deps.guides) throw new Refusal(503, 'unavailable', 'guides are off here');
    return deps.guides;
  };
  app.get('/guides/:id', async (c) => c.json(await getGuide(guides(), c.get('userId'), c.req.param('id'))));

  // Owners only: the organisation's member guides waiting for their approval, for Conexiones.
  app.get('/orgs/:orgId/guides/pending', async (c) => c.json(await pendingGuides(guides(), c.get('userId'), c.req.param('orgId'))));

  // Answers when the model has written the step. A photo above 2 MB is refused before anything else is read.
  app.post('/guides/:id/step', async (c) => {
    const g = guides();
    if (Number(c.req.header('Content-Length') ?? 0) > MAX_STEP_BODY) throw new Refusal(413, 'too_big', PHOTO_TOO_BIG);
    const raw = await c.req.text();
    if (raw.length > MAX_STEP_BODY) throw new Refusal(413, 'too_big', PHOTO_TOO_BIG);
    let body: unknown = undefined;
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }
    return c.json(await guideStep(g, c.get('userId'), c.req.param('id'), body));
  });

  // What the person typed: never logged, never echoed (guides.ts).
  app.post('/guides/:id/check', async (c) => {
    const g = guides();
    const body = await c.req.json().catch(() => null);
    c.header('Cache-Control', 'no-store');
    return c.json(await checkGuide(g, c.get('userId'), c.req.param('id'), body));
  });

  // Answers once the agent has gone on in the guide's conversation (Cloud Run keeps the CPU only while a request is open).
  app.post('/guides/:id/approve', async (c) => c.json(await approveGuide(guides(), c.get('userId'), c.req.param('id'))));

  app.post('/guides/:id/reject', async (c) => c.json(await rejectGuide(guides(), c.get('userId'), c.req.param('id'))));

  // A guided access (guides.ts), owners only: its undo text, then its removal (the credential and the row).
  app.get('/connections/guided/:id', async (c) => c.json(await guidedAccessUndo(guides(), c.get('userId'), c.req.param('id'))));
  app.delete('/connections/guided/:id', async (c) => c.json(await removeGuidedAccess(guides(), c.get('userId'), c.req.param('id'))));

  // Voice notes (voiceNotes.ts): the note in, the message out at once; then its transcript and the agent's answer.
  const voice = { chat: deps.chat, voice: deps.voice, transcriber: deps.transcriber, limiter: deps.transcribeLimiter ?? new NoteLimiter() };
  app.post('/agents/:id/voice-notes', async (c) => {
    const message = await sendVoiceNote(voice, c.get('userId'), c.req.param('id'), {
      contentType: c.req.header('Content-Type'),
      contentLength: c.req.header('Content-Length'),
      body: c.req.raw.body,
      durationMs: c.req.query('durationMs'),
    });
    return c.json({ message }, 201);
  });

  // Answers when the agent has answered: Cloud Run keeps the CPU only while a request is open.
  app.post('/voice-notes/:id/transcribe', async (c) =>
    c.json(await transcribeVoiceNote(voice, c.get('userId'), c.req.param('id'), c.get('accessToken'))),
  );

  app.post('/agents/:id/hello', async (c) => c.json(await agentHello(deps.chat, c.get('userId'), c.req.param('id')), 201));

  app.onError((e, c) => {
    if (e instanceof Refusal) return c.json({ error: e.code, message: e.message }, e.status);
    // Never echo an unexpected error: it could carry a key from the request.
    console.error('engine error', e instanceof Error ? e.name : typeof e);
    return c.json({ error: 'failed', message: 'something went wrong' }, 500);
  });

  return Object.assign(app, { injectWebSocket });
}

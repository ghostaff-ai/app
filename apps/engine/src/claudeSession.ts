// Connecting an organisation's Claude subscription: the owner signs in through
// the unmodified Claude Code, which the engine runs for them (claudeCode.ts).
//
// The whole flow is one WebSocket, because Cloud Run may send two separate HTTP
// requests to two different instances, and the sign-in lives in one process:
//
//   app → {type:'start', token, orgId}   the person's Supabase access token
//   engine → {type:'url', url}           Anthropic's sign-in page, from Claude Code
//   app → {type:'code', code}            the code Anthropic showed after sign-in
//   engine → {type:'working'}            the code is in; Claude Code checks it
//   engine → {type:'done', connection}   the token is in the vault, the row written
//   engine → {type:'error', code}        any refusal or failure; the socket closes
//
// Owners only (requireOwner, same refusals as a key). The token goes to the
// vault and nowhere else: not to the app, not to the logs, not to the database
// (the row keeps its last 4 characters).

import type { Store } from './connections';
import { Refusal, requireOwner } from './connections';
import { CLAUDE_SLOTS, makeHome, parseSignInOutput, type SignInProcess, type SignInSpawner, type Slots } from './claudeCode';
import { keyHint } from './providers';
import { secretName, type Vault } from './vault';

export interface ClaudeSessionDeps {
  store: Store;
  vault: Vault;
  userFromToken(token: string): Promise<string | null>;
  spawn: SignInSpawner;
  /** A throwaway HOME for the sign-in; tests give their own. */
  makeHome?: () => Promise<{ path: string; remove: () => Promise<void> }>;
  now?: () => Date;
  /** How long Claude Code may take to print the sign-in link. */
  urlTimeoutMs?: number;
  /** How long it may take to turn the code into the token. */
  tokenTimeoutMs?: number;
  /** The whole session, sign-in at Anthropic included. */
  sessionTimeoutMs?: number;
  /** How long the socket may stay open without its `start` message. */
  startTimeoutMs?: number;
  /** How long writing the token and the row may take. */
  saveTimeoutMs?: number;
  /** The engine's Claude Code processes (claudeCode.ts). */
  slots?: Slots;
}

/** The socket as the session sees it. */
export interface SessionSocket {
  send(message: Record<string, unknown>): void;
  close(): void;
}

export interface ClaudeSession {
  onMessage(data: string): void;
  /** The socket closed (the person left, or we closed it). Kills Claude Code, cleans its HOME. */
  onClose(): void;
}

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
/**
 * The code Anthropic shows: printable, no spaces, reasonable length. Never an
 * Anthropic key or token pasted by mistake: it would be echoed back and could
 * be taken for the token.
 */
const looksLikeCode = (s: string) => /^[A-Za-z0-9_\-#.~]{10,600}$/.test(s) && !s.startsWith('sk-ant-');
/** Kept of Claude Code's output, from the end: enough for the link and the token. */
const MAX_OUTPUT = 64 * 1024;
/** The largest message the app sends (a code); anything bigger is not read. */
export const MAX_MESSAGE = 16 * 1024;

type Phase = 'new' | 'starting' | 'url' | 'exchanging' | 'saving' | 'over';

export function claudeSession(deps: ClaudeSessionDeps, socket: SessionSocket): ClaudeSession {
  const urlTimeout = deps.urlTimeoutMs ?? 30_000;
  const tokenTimeout = deps.tokenTimeoutMs ?? 90_000;
  let phase: Phase = 'new';
  let child: SignInProcess | null = null;
  let home: { path: string; remove: () => Promise<void> } | null = null;
  let output = '';
  /** What Claude Code printed after the code was typed in: the only place the token or a refusal is looked for. */
  let afterCode = '';
  let code = '';
  let releaseSlot: (() => void) | null = null;
  const slots = deps.slots ?? CLAUDE_SLOTS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let orgId = '';
  let userId = '';
  let ownerName = '';
  const whole = setTimeout(
    () => {
      if (phase !== 'saving') fail('timeout');
    },
    deps.sessionTimeoutMs ?? 10 * 60_000,
  );
  // An unsigned socket does not get to sit there.
  const noStart = setTimeout(() => {
    if (phase === 'new') fail('unauthorized');
  }, deps.startTimeoutMs ?? 10_000);

  const cleanUp = () => {
    clearTimeout(whole);
    clearTimeout(noStart);
    if (timer) clearTimeout(timer);
    timer = null;
    const dying = child?.kill() ?? Promise.resolve();
    child = null;
    const h = home;
    home = null;
    // Its HOME goes once Claude Code has exited, so nothing is written there after.
    const release = releaseSlot;
    releaseSlot = null;
    void dying
      .then(() => h?.remove())
      .catch(() => {})
      .finally(() => release?.());
  };

  const finish = (message: Record<string, unknown>) => {
    if (phase === 'over') return;
    phase = 'over';
    cleanUp();
    try {
      socket.send(message);
    } catch {
      // the person already left
    }
    socket.close();
  };
  const fail = (code: string) => finish({ type: 'error', code });

  const deadline = (ms: number, code: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fail(code), ms);
  };

  const save = async (token: string) => {
    phase = 'saving'; // nothing else happens on this socket but the answer
    if (timer) clearTimeout(timer);
    timer = null;
    void child?.kill();
    let stalled: ReturnType<typeof setTimeout> | undefined;
    const tooLong = new Promise<never>((_, reject) => {
      stalled = setTimeout(() => reject(new Error('save timed out')), deps.saveTimeoutMs ?? 20_000);
    });
    try {
      await Promise.race([persist(token), tooLong]).then((connection) => finish({ type: 'done', connection }));
    } catch (e) {
      console.error('claude sign-in: saving failed', e instanceof Error ? e.name : typeof e); // never the message: it could quote the token
      fail('failed');
    } finally {
      clearTimeout(stalled);
    }
  };

  /** The token to the vault, then the row. */
  const persist = async (token: string) => {
    await deps.vault.put(secretName(orgId, 'claude'), token, {
      org_id: orgId,
      provider: 'claude',
      kind: 'ai',
    });
    const now = (deps.now ?? (() => new Date()))().toISOString();
    const connection = await deps.store.upsert({
      org_id: orgId,
      kind: 'ai',
      provider: 'claude',
      method: 'subscription',
      hint: keyHint(token),
      settings: {},
      status: 'ok',
      checked_at: now,
      connected_by: userId,
      connected_by_name: ownerName,
      updated_at: now,
    });
    return connection;
  };

  const onOutput = (chunk: string) => {
    if (phase !== 'starting' && phase !== 'url' && phase !== 'exchanging') return;
    if (phase === 'exchanging') {
      afterCode = (afterCode + chunk).slice(-MAX_OUTPUT);
      return readAfterCode(false);
    }
    output = (output + chunk).slice(-MAX_OUTPUT);
    const seen = parseSignInOutput(output);
    if (seen.url && phase === 'starting') {
      phase = 'url';
      if (timer) clearTimeout(timer);
      timer = null; // the person takes their time at Anthropic; the whole session's limit still holds
      socket.send({ type: 'url', url: seen.url });
    }
  };

  /** Looks for the token, or a refusal, in what came after the code; `final` once Claude Code has ended. */
  const readAfterCode = (final: boolean) => {
    const seen = parseSignInOutput(afterCode, { final });
    // The pasted code echoed back is never the token.
    if (seen.token && seen.token !== code) return void save(seen.token);
    if (seen.badCode || final) fail('bad_code');
  };

  const start = async (msg: { token?: unknown; orgId?: unknown }) => {
    phase = 'starting';
    try {
      const uid = typeof msg.token === 'string' ? await deps.userFromToken(msg.token).catch(() => null) : null;
      if (!uid) return fail('unauthorized');
      if (!isUuid(msg.orgId)) return fail('bad_request');
      const owner = await requireOwner(deps.store, msg.orgId, uid);
      if (phase !== 'starting') return; // closed meanwhile
      orgId = msg.orgId;
      userId = uid;
      ownerName = owner.displayName;
      home = await (deps.makeHome ?? makeHome)();
      if (phase !== 'starting') {
        void home.remove().catch(() => {});
        home = null;
        return;
      }
      // One Claude Code process per slot; a sign-in waits its turn a little.
      const slot = await slots.take(30_000).catch(() => null);
      if (!slot) return fail('claude_unavailable');
      if (phase !== 'starting') return slot();
      releaseSlot = slot;
      deadline(urlTimeout, 'claude_unavailable');
      child = deps.spawn(home.path);
      child.onOutput(onOutput);
      child.onExit(() => {
        child = null;
        if (phase === 'starting' || phase === 'url') fail('claude_unavailable');
        // Its last words may hold the token, printed right before it ended.
        else if (phase === 'exchanging') readAfterCode(true);
      });
    } catch (e) {
      if (e instanceof Refusal) return fail(e.code);
      console.error('claude sign-in: start failed', e instanceof Error ? e.name : typeof e);
      fail('claude_unavailable');
    }
  };

  return {
    onMessage(data) {
      if (phase === 'over' || phase === 'saving') return;
      if (data.length > MAX_MESSAGE) return fail('bad_request');
      let msg: {
        type?: unknown;
        token?: unknown;
        orgId?: unknown;
        code?: unknown;
      };
      try {
        msg = JSON.parse(data);
      } catch {
        return fail('bad_request');
      }
      if (msg.type === 'start' && phase === 'new') {
        void start(msg);
        return;
      }
      if (msg.type === 'code' && phase === 'url') {
        code = typeof msg.code === 'string' ? msg.code.trim() : '';
        if (!looksLikeCode(code)) return fail('bad_code');
        phase = 'exchanging';
        afterCode = '';
        deadline(tokenTimeout, 'timeout');
        child?.write(`${code}\r`);
        socket.send({ type: 'working' });
        return;
      }
      fail('bad_request');
    },
    onClose() {
      // A save under way finishes: the subscription is connected even if nobody hears it.
      if (phase !== 'saving') phase = 'over';
      cleanUp();
    },
  };
}

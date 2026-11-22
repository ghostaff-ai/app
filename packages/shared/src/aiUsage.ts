// What an AI account used and how close a subscription is to its limits
// (docs/plans/ready/multiple-ai-accounts.md). Shared by the engine, which
// records it, the runner, which reads it from Claude Code, and the app, which
// shows it on each account's card.

/** One of a Claude plan's usage windows, as Claude Code reports it. */
export interface LimitWindow {
  /** 0 to 1: how much of the window is used. */
  utilization: number | null;
  /** When the window starts again (ISO). */
  resetsAt: string | null;
  /** `allowed`, `allowed_warning` (close to the limit) or `rejected` (at it). */
  status: string | null;
}

/** A subscription's limits: the 5-hour window and the week. */
export interface Limits {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  /** When Claude Code last reported them (ISO). */
  readAt?: string;
}

/** Tokens one reply or run used, as the provider counted them. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length <= 40 ? v : null);

export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

/** An Anthropic `usage` object (the Messages API's, or Claude Code's `result` event's) as TokenUsage. */
export function tokensFromUsage(usage: unknown): TokenUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
  };
}

function windowOf(w: unknown): LimitWindow | undefined {
  if (!w || typeof w !== 'object') return undefined;
  const x = w as Record<string, unknown>;
  const resets = numOrNull(x.resetsAt);
  return {
    utilization: numOrNull(x.utilization),
    resetsAt: resets === null ? null : new Date(resets * 1000).toISOString(),
    status: str(x.status),
  };
}

/**
 * The limits in one of Claude Code's `rate_limit_event` lines (stream-json),
 * or null when the line is not one. Seen on 2026-11-22:
 * `{"type":"rate_limit_event","rate_limit_info":{"status":…,"rateLimitType":"seven_day","utilization":0.98,
 * "resetsAt":1795582800,"unifiedWindows":{"five_hour":{"utilization":0.63,"resetsAt":…,"status":"allowed"},"seven_day":{…}}}}`.
 */
export function limitsFromEvent(event: unknown, now: Date = new Date()): Limits | null {
  const e = (event ?? {}) as Record<string, unknown>;
  if (e.type !== 'rate_limit_event' || !e.rate_limit_info || typeof e.rate_limit_info !== 'object') return null;
  const info = e.rate_limit_info as Record<string, unknown>;
  const windows = (info.unifiedWindows ?? {}) as Record<string, unknown>;
  const limits: Limits = { readAt: now.toISOString() };
  const five = windowOf(windows.five_hour);
  const seven = windowOf(windows.seven_day);
  if (five) limits.fiveHour = five;
  if (seven) limits.sevenDay = seven;
  // Without the windows, the one the event is about.
  if (!five && info.rateLimitType === 'five_hour') limits.fiveHour = windowOf(info);
  if (!seven && info.rateLimitType === 'seven_day') limits.sevenDay = windowOf(info);
  return limits.fiveHour || limits.sevenDay ? limits : null;
}

/** Later limits over earlier ones, window by window. */
export function mergeLimits(earlier: Limits | null | undefined, later: Limits | null | undefined): Limits | null {
  if (!later) return earlier ?? null;
  if (!earlier) return later;
  return { ...earlier, ...later, fiveHour: later.fiveHour ?? earlier.fiveHour, sevenDay: later.sevenDay ?? earlier.sevenDay };
}

/** Whether a subscription is at a limit that has not reset yet: the engine skips it while others can answer. */
export function atLimit(limits: Limits | null | undefined, now: Date = new Date()): boolean {
  return [limits?.fiveHour, limits?.sevenDay].some(
    (w) => w?.status === 'rejected' && (!w.resetsAt || new Date(w.resetsAt).getTime() > now.getTime()),
  );
}

/** The limits as the database keeps them (`connections.limits`, snake_case). */
export function limitsToRow(l: Limits): Record<string, unknown> {
  const w = (x?: LimitWindow) => (x ? { utilization: x.utilization, resets_at: x.resetsAt, status: x.status } : undefined);
  return JSON.parse(JSON.stringify({ five_hour: w(l.fiveHour), seven_day: w(l.sevenDay), read_at: l.readAt }));
}

export function limitsFromRow(row: unknown): Limits {
  const r = (row ?? {}) as Record<string, unknown>;
  const w = (x: unknown): LimitWindow | undefined => {
    if (!x || typeof x !== 'object') return undefined;
    const y = x as Record<string, unknown>;
    return { utilization: numOrNull(y.utilization), resetsAt: typeof y.resets_at === 'string' ? y.resets_at : null, status: str(y.status) };
  };
  const out: Limits = {};
  const five = w(r.five_hour);
  const seven = w(r.seven_day);
  if (five) out.fiveHour = five;
  if (seven) out.sevenDay = seven;
  if (typeof r.read_at === 'string') out.readAt = r.read_at;
  return out;
}

/**
 * List prices, US dollars per million tokens (Anthropic, 2026-11-03). Cache
 * writes at 1.25× input (5-minute cache), reads at 0.1×. Google Cloud bills
 * Claude at its own, similar prices: on a Vertex account this is an estimate.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-fable-5-2': { input: 8, output: 40 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

/** What the tokens cost at list price, in dollars; null for a model we have no price for. */
export function estimateCostUsd(model: string, t: TokenUsage): number | null {
  const p = PRICES[model.replace(/@.*$/, '')];
  if (!p) return null;
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  const cost =
    t.input * perToken(p.input) + t.cacheWrite * perToken(p.input * 1.25) + t.cacheRead * perToken(p.input * 0.1) + t.output * perToken(p.output);
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** One line of `ai_usage_daily`: one account, agent and day. */
export interface AiUsageDay {
  connectionId: string;
  agentId: string | null;
  /** `YYYY-MM-DD`, Madrid. */
  day: string;
  uses: number;
  failures: number;
  tokens: TokenUsage;
  costUsd: number | null;
  lastAt: string;
}

/** One account's usage over the days asked for. */
export interface AiUsageSummary {
  uses: number;
  failures: number;
  /** Every token, cached ones included. */
  tokens: number;
  costUsd: number | null;
  lastAt: string | null;
  /** Per day, oldest first, only days with something. */
  byDay: { day: string; uses: number; tokens: number }[];
  /** Per agent, most used first; `null` is work no agent did (a removed one). */
  byAgent: { agentId: string | null; uses: number; tokens: number }[];
}

const allTokens = (t: TokenUsage) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** The days of one account added up, for its card and its page. */
export function summarizeUsage(rows: readonly AiUsageDay[], connectionId: string): AiUsageSummary {
  const mine = rows.filter((r) => r.connectionId === connectionId);
  const days = new Map<string, { uses: number; tokens: number }>();
  const agents = new Map<string | null, { uses: number; tokens: number }>();
  let cost: number | null = null;
  let lastAt: string | null = null;
  for (const r of mine) {
    const t = allTokens(r.tokens);
    const d = days.get(r.day) ?? { uses: 0, tokens: 0 };
    days.set(r.day, { uses: d.uses + r.uses, tokens: d.tokens + t });
    const a = agents.get(r.agentId) ?? { uses: 0, tokens: 0 };
    agents.set(r.agentId, { uses: a.uses + r.uses, tokens: a.tokens + t });
    if (r.costUsd !== null) cost = (cost ?? 0) + r.costUsd;
    if (r.uses > 0 && (!lastAt || r.lastAt > lastAt)) lastAt = r.lastAt;
  }
  return {
    uses: mine.reduce((s, r) => s + r.uses, 0),
    failures: mine.reduce((s, r) => s + r.failures, 0),
    tokens: mine.reduce((s, r) => s + allTokens(r.tokens), 0),
    costUsd: cost,
    lastAt,
    byDay: [...days].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    byAgent: [...agents].map(([agentId, v]) => ({ agentId, ...v })).sort((a, b) => b.uses - a.uses || b.tokens - a.tokens),
  };
}

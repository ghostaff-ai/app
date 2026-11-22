import type { Connection } from '@ghostaff/shared';
import { EngineError } from '@ghostaff/shared/services';
import {
  accountErrorMessage,
  accountResultMessage,
  aiAccountName,
  aiUsageLine,
  canRunAgents,
  claudeSignInMessage,
  connectErrorMessage,
  connectorSections,
  costLabel,
  PROVIDERS,
  resetLabel,
  tokensLabel,
} from '@/lib/connections';

describe('what the connections screen says when the engine refuses', () => {
  it('names the right key prefix for each provider', () => {
    const e = new EngineError('bad_key_format', 400, 'x');
    expect(connectErrorMessage(e, 'anthropic')).toContain('sk-ant-');
    expect(connectErrorMessage(e, 'openai')).toContain('sk-.');
  });

  it('points a missing Google Cloud permission back to the steps', () => {
    expect(connectErrorMessage(new EngineError('no_access', 422, 'x'), 'vertex')).toContain('permiso');
  });

  it('never shows the raw error', () => {
    expect(connectErrorMessage(new Error('sk-ant-secret'), 'anthropic')).toBe('Algo ha fallado. Inténtalo de nuevo.');
  });
});

describe('the Claude subscription card', () => {
  it('warns that Anthropic can cut it off, and what happens then', () => {
    expect(PROVIDERS.claude.title).toBe('Claude · tu suscripción');
    expect(PROVIDERS.claude.warning).toContain('sin aviso');
    expect(PROVIDERS.claude.warning).toContain('siguiente cuenta de IA');
    expect(PROVIDERS.claude.warning).toContain('varias personas');
    expect(PROVIDERS.claude.limit).toContain('apps conectadas');
  });

  it('says in Spanish why a sign-in did not work, never the raw code', () => {
    expect(claudeSignInMessage('bad_code')).toContain('código');
    expect(claudeSignInMessage('timeout')).toContain('demasiado tiempo');
    expect(claudeSignInMessage('expired')).toContain('caducado');
    expect(claudeSignInMessage('not_owner')).toContain('propietario');
    expect(claudeSignInMessage('weird_internal_code')).toBe('Algo ha fallado. Inténtalo de nuevo.');
  });
});

describe('what the connections screen says about an outside account', () => {
  it('says plainly how a sign-in ended', () => {
    expect(accountResultMessage('ok')).toEqual({ text: expect.stringContaining('Conectada'), ok: true });
    expect(accountResultMessage('denied').ok).toBe(false);
    expect(accountResultMessage('missing_scopes').text).toContain('marcar');
    expect(accountResultMessage('whatever').text).toContain('No hemos podido');
  });

  it('never shows the raw error, and says when a connector is not available yet', () => {
    expect(accountErrorMessage(new Error('refresh-token-secret'))).toBe('Algo ha fallado. Inténtalo de nuevo.');
    expect(accountErrorMessage(new EngineError('provider_not_configured', 503, 'x'))).toContain('todavía no está disponible');
  });
});

describe('the account cards of Conexiones', () => {
  it('show the connected ones first, then every area of the catalogue, each card once', () => {
    const sections = connectorSections(new Set(['instagram']));
    expect(sections[0]).toMatchObject({ title: 'Conectadas', connectors: [expect.objectContaining({ id: 'instagram' })] });
    expect(sections[1]?.title).toBe('Google');
    const ids = sections.flatMap((s) => s.connectors.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a search ignores accents and case, and finds a card by what it does', () => {
    const ids = (q: string) => connectorSections(new Set(), q).flatMap((s) => s.connectors.map((c) => c.id));
    expect(ids('RESENAS')).toEqual(['googlebusiness']);
    expect(ids('facturas')).toContain('holded');
    expect(ids('nada que exista')).toEqual([]);
  });
});

describe('whether an organisation has an AI account its agents run on', () => {
  const conn = (kind: Connection['kind'], provider: Connection['provider']): Connection => ({
    id: provider,
    orgId: 'o',
    kind,
    provider,
    method: 'api_key',
    hint: '1234',
    settings: {},
    status: 'ok',
    statusReason: null,
    checkedAt: '',
    connectedByName: 'Ana',
    updatedAt: '',
    position: 1,
    label: null,
    limits: {},
    lastUsedAt: null,
  });

  it('counts a Claude subscription, an Anthropic key or Claude on Google Cloud', () => {
    expect(canRunAgents([conn('ai', 'claude')])).toBe(true);
    expect(canRunAgents([conn('ai', 'anthropic')])).toBe(true);
    expect(canRunAgents([conn('ai', 'vertex')])).toBe(true);
  });

  it('does not count an OpenAI key, which the engine does not use yet, nor other accounts', () => {
    expect(canRunAgents([])).toBe(false);
    expect(canRunAgents([conn('ai', 'openai')])).toBe(false);
    expect(canRunAgents([conn('account', 'google')])).toBe(false);
  });
});

describe('an AI account in the list', () => {
  const base: Connection = {
    id: 'c1',
    orgId: 'o',
    kind: 'ai',
    provider: 'claude',
    method: 'subscription',
    hint: 'abcd',
    settings: {},
    status: 'ok',
    statusReason: null,
    checkedAt: '',
    connectedByName: 'Ana',
    updatedAt: '',
    position: 1,
    label: null,
    limits: {},
    lastUsedAt: null,
  };
  const usage = { uses: 12, failures: 0, tokens: 1_234_000, costUsd: 18.4, lastAt: null, byDay: [], byAgent: [] };

  it('is called by the name an owner gave it, else by its kind', () => {
    expect(aiAccountName(base)).toBe('Claude con tu suscripción');
    expect(aiAccountName({ ...base, label: 'Claude de Jaime' })).toBe('Claude de Jaime');
  });

  it('a subscription shows its weekly and 5-hour limits; at a limit, says so', () => {
    const limits = { sevenDay: { utilization: 0.62, resetsAt: null, status: 'allowed' }, fiveHour: { utilization: 0.2, resetsAt: null, status: 'allowed' } };
    expect(aiUsageLine({ ...base, limits }, usage)).toBe('Semana 62 % · 5 h 20 %');
    expect(aiUsageLine({ ...base, limits: { sevenDay: { utilization: 1, resetsAt: null, status: 'rejected' } } }, usage)).toBe('Semana: límite alcanzado');
  });

  it('a key shows its last 30 days with the estimated cost; a subscription never a cost', () => {
    expect(aiUsageLine({ ...base, provider: 'anthropic', method: 'api_key' }, usage)).toBe('30 días: 12 usos · 1,2 M tokens · ~18 $');
    expect(aiUsageLine(base, usage)).toBe('30 días: 12 usos · 1,2 M tokens');
    expect(aiUsageLine(base, null)).toBe('Sin usar en los últimos 30 días');
  });

  it('a failing account says why before anything else', () => {
    expect(aiUsageLine({ ...base, status: 'failing', statusReason: 'limited' }, usage)).toBe('Ha llegado a su límite');
    expect(aiUsageLine({ ...base, status: 'failing', statusReason: 'refused' }, usage)).toContain('vuelve a conectarla');
  });

  it('numbers as a person reads them', () => {
    expect(tokensLabel(850)).toBe('850');
    expect(tokensLabel(12_400)).toBe('12 mil');
    expect(costLabel(0.4)).toBe('~0,40 $');
    expect(costLabel(0.001)).toBe('<0,01 $');
    const now = new Date('2026-11-22T12:00:00Z');
    expect(resetLabel('2026-11-22T12:40:00Z', now)).toBe('en 40 min');
    expect(resetLabel('2026-11-22T15:00:00Z', now)).toBe('en 3 h');
    expect(resetLabel('2026-11-22T11:00:00Z', now)).toBe('ya');
  });
});

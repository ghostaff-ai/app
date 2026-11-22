import type { Connection } from '@ghostaff/shared';
import { EngineError } from '@ghostaff/shared/services';
import { accountErrorMessage, accountResultMessage, canRunAgents, claudeSignInMessage, connectErrorMessage, connectorSections, PROVIDERS } from '@/lib/connections';

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
    expect(PROVIDERS.claude.warning).toContain('clave de Anthropic');
    expect(PROVIDERS.claude.limit).toContain('apps conectadas');
  });

  it('says in Spanish why a sign-in did not work, never the raw code', () => {
    expect(claudeSignInMessage('bad_code')).toContain('código');
    expect(claudeSignInMessage('timeout')).toContain('demasiado tiempo');
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
    checkedAt: '',
    connectedByName: 'Ana',
    updatedAt: '',
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

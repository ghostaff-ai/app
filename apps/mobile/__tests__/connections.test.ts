import { EngineError } from '@ghostaff/shared/services';
import { accountErrorMessage, accountResultMessage, connectErrorMessage } from '@/lib/connections';

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

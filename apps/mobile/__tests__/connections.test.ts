import { EngineError } from '@ghostaff/shared/services';
import { connectErrorMessage } from '@/lib/connections';

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

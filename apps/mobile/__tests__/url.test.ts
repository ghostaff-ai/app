import { withBase } from '@/lib/url';

describe('withBase', () => {
  it('puts a path under the web build’s base', () => {
    expect(withBase('chat/a1', '/app')).toBe('/app/chat/a1');
    expect(withBase('/conexiones', '/app/')).toBe('/app/conexiones');
  });

  it('leaves the path alone at the root of the domain', () => {
    expect(withBase('chat/a1', '')).toBe('chat/a1');
  });
});

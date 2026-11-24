import { createServer, type Server } from 'node:net';
import type { GuideLanding } from '@ghostaff/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkLanding, type GuidedAccess, type GuidedStore, guidedToolsFor, underBase } from '../src/guidedAccounts';
import { fetchPublic } from '../src/publicFetch';
import { guidedSecretName, MemoryVault } from '../src/vault';

const ORG = '10000000-0000-0000-0000-000000000001';
const FINANZAS = '20000000-0000-0000-0000-000000000001';
const REDES = '20000000-0000-0000-0000-000000000002';
const GUIDE = '60000000-0000-0000-0000-000000000001';

const wordpress: GuideLanding = {
  auth: 'basic',
  suffix: '/wp-json',
  check: { path: '/wp/v2/users/me?context=edit', expect: { field: 'roles', includes: 'editor' } },
};
const APP_PASSWORD = 'abcd EFGH ijkl MNOP qrst UVWX';
const values = { base_url: 'miweb.com', username: 'finanzas@panaderia.ghostaff.ai', password: APP_PASSWORD };

type Call = { url: string; init: RequestInit };

/** A fetch that records each call and answers with `answer`. */
function fakeFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return answer(url, init);
  }) as typeof fetch;
  return { f, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

describe('checkLanding', () => {
  it('passes when the check answers 2xx with the expected value, signed with the credential', async () => {
    const { f, calls } = fakeFetch(() => json({ id: 7, roles: ['editor'] }));
    expect(await checkLanding(wordpress, values, f, 'WordPress')).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://miweb.com/wp-json/wp/v2/users/me?context=edit');
    const basic = Buffer.from(`${values.username}:${APP_PASSWORD}`).toString('base64');
    expect(header(calls[0]?.init ?? {}, 'authorization')).toBe(`Basic ${basic}`);
    expect(calls[0]?.init.method ?? 'GET').toBe('GET');
    expect(calls[0]?.init.redirect).toBe('manual');
  });

  it('Review focus 2: the person\'s own password gets a 401, and the message asks for the application one', async () => {
    const { f } = fakeFetch(() => json({ code: 'incorrect_password' }, 401));
    expect(await checkLanding(wordpress, values, f, 'WordPress')).toEqual({
      ok: false,
      field: 'password',
      message: 'Esa contraseña no vale: tiene que ser la de aplicación',
    });
  });

  it('a 401 on a token or a key points at that field', async () => {
    const { f } = fakeFetch(() => json({}, 401));
    expect(await checkLanding({ auth: 'bearer', check: { path: '/me' } }, { base_url: 'app.com', token: 'tok-123456' }, f)).toMatchObject({
      ok: false,
      field: 'token',
    });
    expect(
      await checkLanding({ auth: 'header', header: 'X-Api-Key', check: { path: '/me' } }, { base_url: 'app.com', key: 'key-123456' }, f),
    ).toMatchObject({ ok: false, field: 'key' });
  });

  it('a 403 says the user may not do it', async () => {
    const { f } = fakeFetch(() => json({}, 403));
    expect(await checkLanding(wordpress, values, f, 'WordPress')).toEqual({
      ok: false,
      field: 'username',
      message: 'Ese usuario no tiene permiso para esto',
    });
  });

  it('a 404 on the base: the app is not at that address', async () => {
    const { f } = fakeFetch(() => new Response('Not found', { status: 404 }));
    expect(await checkLanding(wordpress, values, f, 'WordPress')).toEqual({
      ok: false,
      field: 'base_url',
      message: 'No encuentro tu WordPress en esa dirección',
    });
  });

  it('a 2xx that is not JSON when a value is expected: the address is not the app', async () => {
    const { f } = fakeFetch(() => new Response('<html>Bienvenido</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    expect(await checkLanding(wordpress, values, f, 'WordPress')).toEqual({
      ok: false,
      field: 'base_url',
      message: 'No encuentro tu WordPress en esa dirección',
    });
  });

  it('the expectation unmet: the user lacks the role', async () => {
    const { f } = fakeFetch(() => json({ id: 7, roles: ['subscriber'] }));
    expect(await checkLanding(wordpress, values, f, 'WordPress')).toEqual({
      ok: false,
      field: 'username',
      message: 'El usuario no tiene el rol Editor',
    });
  });

  it('an address that does not answer: it does not open from the internet', async () => {
    const { f } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(await checkLanding(wordpress, values, f, 'WordPress')).toEqual({
      ok: false,
      field: 'base_url',
      message: 'Esa dirección no se abre desde internet',
    });
  });

  it('a redirect is not followed: the person types the address they see', async () => {
    const { f } = fakeFetch(() => new Response(null, { status: 301, headers: { Location: 'https://www.miweb.com/wp-json/wp/v2/users/me' } }));
    expect(await checkLanding(wordpress, values, f, 'WordPress')).toEqual({
      ok: false,
      field: 'base_url',
      message: 'Esa dirección lleva a otra: escribe la que ves en el navegador',
    });
  });

  it('a server error says so, with its code', async () => {
    const { f } = fakeFetch(() => new Response('oops', { status: 500 }));
    expect(await checkLanding(wordpress, values, f, 'WordPress')).toEqual({
      ok: false,
      message: 'WordPress ha contestado con un error (500). Prueba otra vez en un momento.',
    });
  });

  it('a missing credential or a plain-http address fails before fetching anything', async () => {
    const { f, calls } = fakeFetch(() => json({}));
    expect(await checkLanding(wordpress, { base_url: 'miweb.com', username: 'ana' }, f)).toEqual({
      ok: false,
      field: 'password',
      message: 'Falta la contraseña',
    });
    expect(await checkLanding(wordpress, { ...values, username: ' ' }, f)).toEqual({ ok: false, field: 'username', message: 'Falta el usuario' });
    expect(await checkLanding(wordpress, { ...values, base_url: 'http://miweb.com' }, f)).toEqual({
      ok: false,
      field: 'base_url',
      message: 'Tu web tiene que empezar por https',
    });
    expect(calls).toHaveLength(0);
  });

  it('a check path that leaves the base is refused without fetching', async () => {
    const { f, calls } = fakeFetch(() => json({}));
    for (const path of ['/../../wp-admin', '/a\\b', '//evil.com/x']) {
      const r = await checkLanding({ ...wordpress, check: { path } }, values, f);
      expect(r.ok, path).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it('a key goes in the header the landing names', async () => {
    const { f, calls } = fakeFetch(() => json({ ok: true }));
    const landing: GuideLanding = { auth: 'header', header: 'X-Api-Key', check: { path: '/v1/me' } };
    expect(await checkLanding(landing, { base_url: 'https://api.miapp.com/', key: 'k-0123456789' }, f)).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://api.miapp.com/v1/me');
    expect(header(calls[0]?.init ?? {}, 'x-api-key')).toBe('k-0123456789');
    expect(header(calls[0]?.init ?? {}, 'authorization')).toBeNull();
  });
});

describe('Review focus 4: an address inside a network, with the real fetchPublic', () => {
  let server: Server;
  let port = 0;
  let connections = 0;
  beforeAll(async () => {
    server = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const unreachable = { ok: false, field: 'base_url', message: 'Esa dirección no se abre desde internet' };

  it('localhost and 127.0.0.1 fail with «no se abre desde internet» and nothing reaches the server', async () => {
    expect(await checkLanding(wordpress, { ...values, base_url: `https://localhost:${port}` }, fetchPublic)).toEqual(unreachable);
    expect(await checkLanding(wordpress, { ...values, base_url: `https://127.0.0.1:${port}` }, fetchPublic)).toEqual(unreachable);
    expect(await checkLanding(wordpress, { ...values, base_url: `localhost:${port}` }, fetchPublic)).toEqual(unreachable);
    expect(connections).toBe(0);
  });

  it('https://192.168.1.10 fails at once, without trying to connect', async () => {
    const started = Date.now();
    expect(await checkLanding(wordpress, { ...values, base_url: 'https://192.168.1.10' }, fetchPublic)).toEqual(unreachable);
    // Refused before any connection is attempted: no wait for a host that is not there.
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('underBase', () => {
  const base = 'https://miweb.com/wp-json';
  it('keeps a path and its query under the base', () => {
    expect(underBase(base, '/wp/v2/posts', { per_page: 2, search: 'pan y vino' }).toString()).toBe(
      'https://miweb.com/wp-json/wp/v2/posts?per_page=2&search=pan+y+vino',
    );
    expect(underBase(base, '/wp/v2/users/me?context=edit').toString()).toBe('https://miweb.com/wp-json/wp/v2/users/me?context=edit');
  });

  it('refuses a path with ://, .., a leading //, a backslash or an encoded dot or slash', () => {
    for (const path of ['https://evil.com/x', '/x?u=http://evil.com', '/../wp-admin', '/wp/v2/..', '//evil.com/x', '/a\\b', '/%2e%2e/x', '/a%2Fb', 'wp/v2', '/a#b', '/a b']) {
      expect(() => underBase(base, path), path).toThrow();
    }
  });
});

describe('guidedToolsFor', () => {
  const access: GuidedAccess = {
    id: '70000000-0000-0000-0000-000000000001',
    agentId: FINANZAS,
    provider: 'xwordpress',
    hint: 'finanzas@panaderia.ghostaff.ai',
    status: 'ok',
    settings: { base: 'https://miweb.com/wp-json', auth: 'basic', app: 'WordPress', guideId: GUIDE },
  };
  const store: Pick<GuidedStore, 'accesses'> = {
    accesses: async (orgId, agentId) => (orgId === ORG ? [access].filter((a) => !agentId || a.agentId === agentId) : []),
  };
  const vault = new MemoryVault();
  beforeAll(async () => {
    await vault.put(guidedSecretName(ORG, GUIDE), JSON.stringify({ username: access.hint, password: APP_PASSWORD }), {});
  });

  it('gives the agent one request tool for its access, and a line for its prompt without the credential', async () => {
    const { f } = fakeFetch(() => json([]));
    const tools = await guidedToolsFor(store, vault, ORG, FINANZAS, f);
    expect(tools.specs.map((s) => s.name)).toEqual(['xwordpress_request']);
    expect(tools.accounts).toHaveLength(1);
    expect(tools.accounts[0]).toContain('WordPress');
    expect(tools.accounts[0]).toContain('https://miweb.com/wp-json');
    expect(tools.accounts[0]).not.toContain(APP_PASSWORD);
    expect(tools.providerOf?.('xwordpress_request')).toBe('xwordpress');
  });

  it('the tool is absent for another agent of the same organisation', async () => {
    const { f } = fakeFetch(() => json([]));
    const tools = await guidedToolsFor(store, vault, ORG, REDES, f);
    expect(tools.specs).toEqual([]);
    expect((await tools.run('xwordpress_request', { method: 'GET', path: '/wp/v2/posts' })).isError).toBe(true);
  });

  it('a failing access gives no tool', async () => {
    const failing: Pick<GuidedStore, 'accesses'> = { accesses: async () => [{ ...access, status: 'failing' }] };
    expect((await guidedToolsFor(failing, vault, ORG, FINANZAS)).specs).toEqual([]);
  });

  it('GET reads: it runs at once, under the base, signed by the engine', async () => {
    const { f, calls } = fakeFetch(() => json([{ id: 1, title: 'Hola' }]));
    const tools = await guidedToolsFor(store, vault, ORG, FINANZAS, f);
    const input = { method: 'GET', path: '/wp/v2/posts', query: { per_page: 2 } };
    expect(tools.writes('xwordpress_request', input)).toBe(false);
    const out = await tools.run('xwordpress_request', input);
    expect(out.isError).toBe(false);
    expect(out.content).toContain('200');
    expect(out.content).toContain('Hola');
    expect(calls[0]?.url).toBe('https://miweb.com/wp-json/wp/v2/posts?per_page=2');
    expect(header(calls[0]?.init ?? {}, 'authorization')).toMatch(/^Basic /);
    expect(calls[0]?.init.redirect).toBe('manual');
  });

  it('POST is a write: it waits for approval, and runs with its JSON body once approved', async () => {
    const { f, calls } = fakeFetch(() => json({ id: 9 }, 201));
    const tools = await guidedToolsFor(store, vault, ORG, FINANZAS, f);
    const input = { method: 'POST', path: '/wp/v2/posts', body: { title: 'Nuevo pan', status: 'draft' } };
    expect(tools.writes('xwordpress_request', input)).toBe(true);
    expect(tools.writes('xwordpress_request')).toBe(true);
    expect(tools.writes('xwordpress_request', { method: 'delete', path: '/wp/v2/posts/1' })).toBe(true);
    expect(await tools.describe?.('xwordpress_request', input)).toMatchObject({ label: 'WordPress: POST /wp/v2/posts' });
    const out = await tools.run('xwordpress_request', input);
    expect(out.isError).toBe(false);
    expect(calls[0]?.init.method).toBe('POST');
    expect(header(calls[0]?.init ?? {}, 'content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ title: 'Nuevo pan', status: 'draft' });
  });

  it('a path with ://, .. or a leading // is refused and nothing is fetched', async () => {
    const { f, calls } = fakeFetch(() => json({}));
    const tools = await guidedToolsFor(store, vault, ORG, FINANZAS, f);
    for (const path of ['https://evil.com/x', '/../../wp-admin', '//evil.com/x']) {
      const out = await tools.run('xwordpress_request', { method: 'GET', path });
      expect(out.isError, path).toBe(true);
      await expect(tools.describe?.('xwordpress_request', { method: 'POST', path })).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });

  it('an unknown method or a GET with a body is refused without fetching', async () => {
    const { f, calls } = fakeFetch(() => json({}));
    const tools = await guidedToolsFor(store, vault, ORG, FINANZAS, f);
    expect((await tools.run('xwordpress_request', { method: 'TRACE', path: '/x' })).isError).toBe(true);
    expect((await tools.run('xwordpress_request', { method: 'GET', path: '/x', body: { a: 1 } })).isError).toBe(true);
    await expect(tools.describe?.('xwordpress_request', { method: 'TRACE', path: '/x' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('the credential never appears in the output or the step line, even when the app echoes it', async () => {
    const basic = Buffer.from(`${access.hint}:${APP_PASSWORD}`).toString('base64');
    const { f } = fakeFetch((_url, init) =>
      json({ echoed: header(init, 'authorization'), password: APP_PASSWORD, compact: APP_PASSWORD.replace(/ /g, '') }),
    );
    const tools = await guidedToolsFor(store, vault, ORG, FINANZAS, f);
    const out = await tools.run('xwordpress_request', { method: 'GET', path: '/echo' });
    const step = tools.stepFor('xwordpress_request');
    for (const text of [out.content, step]) {
      expect(text).not.toContain(APP_PASSWORD);
      expect(text).not.toContain(APP_PASSWORD.replace(/ /g, ''));
      expect(text).not.toContain(basic);
    }
    expect(step).toBe('Usando WordPress');
  });

  it('a non-2xx answer is an error the model reads, and a redirect is not followed', async () => {
    const { f } = fakeFetch((url) =>
      url.endsWith('/gone') ? json({ code: 'rest_no_route' }, 404) : new Response(null, { status: 302, headers: { Location: 'https://evil.com/' } }),
    );
    const tools = await guidedToolsFor(store, vault, ORG, FINANZAS, f);
    const gone = await tools.run('xwordpress_request', { method: 'GET', path: '/gone' });
    expect(gone.isError).toBe(true);
    expect(gone.content).toContain('404');
    const moved = await tools.run('xwordpress_request', { method: 'GET', path: '/moved' });
    expect(moved.isError).toBe(true);
    expect(moved.content).toContain('302');
  });

  it('a method override (_method) is refused for every method and route, with nothing fetched', async () => {
    const { f, calls } = fakeFetch(() => json({}));
    const tools = await guidedToolsFor(store, vault, ORG, FINANZAS, f);
    const inputs = [
      { method: 'GET', path: '/wp/v2/posts/1', query: { _method: 'DELETE', force: true } },
      { method: 'GET', path: '/wp/v2/posts?_method=POST&title=X&status=publish' },
      { method: 'GET', path: '/wp/v2/posts?%5Fmethod=POST' },
      { method: 'GET', path: '/wp/v2/posts', query: { '.method': 'DELETE' } },
      { method: 'GET', path: '/wp/v2/posts', query: { ' method': 'DELETE' } },
      { method: 'GET', path: '/wp/v2/posts', query: { _METHOD: 'DELETE' } },
      { method: 'GET', path: '/wp/v2/posts?_method[]=DELETE' },
      { method: 'POST', path: '/wp/v2/posts', query: { _method: 'DELETE' } },
    ];
    for (const input of inputs) {
      const out = await tools.run('xwordpress_request', input);
      expect(out.isError, JSON.stringify(input)).toBe(true);
      expect(out.content).toContain('_method');
    }
    await expect(tools.describe?.('xwordpress_request', { method: 'POST', path: '/wp/v2/posts', query: { _method: 'DELETE' } })).rejects.toThrow(/_method/);
    expect(calls).toHaveLength(0);
    // A key that only looks alike is fine.
    expect(underBase('https://miweb.com/wp-json', '/wp/v2/posts', { method_x: 1, my_method: 2 }).search).toBe('?method_x=1&my_method=2');
  });

  it('a credential in the vault that is not JSON, or lacks its password, is "no longer kept", never echoed, nothing fetched', async () => {
    const { f, calls } = fakeFetch(() => json({}));
    for (const raw of ['secreto-que-no-es-json abcd', JSON.stringify({ username: access.hint })]) {
      const broken = new MemoryVault();
      await broken.put(guidedSecretName(ORG, GUIDE), raw, {});
      const tools = await guidedToolsFor(store, broken, ORG, FINANZAS, f);
      const out = await tools.run('xwordpress_request', { method: 'GET', path: '/wp/v2/posts' });
      expect(out).toEqual({ content: 'El acceso a WordPress ya no está guardado: quien es propietario tiene que volver a darlo.', isError: true });
      expect(out.content).not.toContain(raw);
    }
    expect(calls).toHaveLength(0);
  });

  it('a missing credential in the vault is an error, with nothing fetched', async () => {
    const { f, calls } = fakeFetch(() => json({}));
    const tools = await guidedToolsFor(store, new MemoryVault(), ORG, FINANZAS, f);
    const out = await tools.run('xwordpress_request', { method: 'GET', path: '/wp/v2/posts' });
    expect(out.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

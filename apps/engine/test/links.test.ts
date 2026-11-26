import { describe, expect, it } from 'vitest';
import { givenByPerson, linkTools, pageText } from '../src/links';

describe('pageText', () => {
  it('keeps the title and the readable text, without scripts, styles or tags', () => {
    const html =
      '<html><head><title>Gestoría López &amp; Asociados</title><style>p{}</style></head>' +
      '<body><script>alert(1)</script><h1>Quiénes somos</h1><p>Asesoría&nbsp;fiscal en Madrid.</p><!-- nota --><p>Tel. 910&#32;000</p></body></html>';
    expect(pageText(html)).toBe('Gestoría López & Asociados\n\nQuiénes somos\nAsesoría fiscal en Madrid.\nTel. 910 000');
  });
});

describe('read_link', () => {
  const page = (body: string, type = 'text/html; charset=utf-8', status = 200) =>
    (async () => new Response(body, { status, headers: { 'content-type': type } })) as unknown as typeof fetch;

  it('reads a public page as text, for any agent, with no approval', async () => {
    const t = linkTools(page('<title>Acme</title><p>Precios 2026</p>'));
    expect(t.writes('read_link', {})).toBe(false);
    const out = await t.run('read_link', { url: 'https://acme.example/precios' });
    expect(out.isError).toBe(false);
    expect(out.content).toContain('Acme\n\nPrecios 2026');
  });

  it('refuses what is not a web page, and says why', async () => {
    expect((await linkTools(page('')).run('read_link', { url: 'file:///etc/passwd' })).content).toBe('Solo leo enlaces http o https.');
    expect((await linkTools(page('')).run('read_link', { url: 'no es un enlace' })).content).toBe('Eso no es un enlace válido.');
    expect((await linkTools(page('%PDF', 'application/pdf')).run('read_link', { url: 'https://a.example/f.pdf' })).content).toContain('Es un fichero (application/pdf)');
    expect((await linkTools(page('no', 'text/html', 404)).run('read_link', { url: 'https://a.example/' })).content).toContain('contesta 404');
  });

  it('says it could not open an address that is not public', async () => {
    const refusing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const out = await linkTools(refusing).run('read_link', { url: 'http://10.0.0.5/' });
    expect(out).toEqual({ content: expect.stringContaining('no es una dirección pública'), isError: true });
  });
});

describe('givenByPerson', () => {
  it('lets the agent read only a link a person wrote, as they wrote it', () => {
    const said = ['Ana: mira esto https://acme.example/precios?x=1, es la web nueva'];
    expect(givenByPerson('https://acme.example/precios?x=1', said)).toBe(true);
    expect(givenByPerson('https://acme.example/precios?x=1.', said)).toBe(true);
    expect(givenByPerson('https://evil.example/?d=secreto', said)).toBe(false);
    expect(givenByPerson('', said)).toBe(false);
    expect(givenByPerson(undefined, said)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { linkPreview, parsePreview } from '../src/linkPreview';

// A link's preview (chat-like-whatsapp.md, phase 4).

describe('a link preview', () => {
  it('reads the Open Graph tags, the title as a fallback, and keeps only https images', () => {
    const html = `<html><head><title>Feria &amp; Co</title>
      <meta property="og:description" content="Del 3 al 6 de marzo">
      <meta property="og:image" content="/img/cartel.jpg"><meta property="og:site_name" content="Feria Valencia"></head>`;
    expect(parsePreview(new URL('https://feriavalencia.com/evento'), html)).toEqual({
      url: 'https://feriavalencia.com/evento',
      title: 'Feria & Co',
      description: 'Del 3 al 6 de marzo',
      site: 'Feria Valencia',
      image: 'https://feriavalencia.com/img/cartel.jpg',
    });
    expect(parsePreview(new URL('http://x.com'), '<meta property="og:image" content="http://x.com/a.jpg">').image).toBeNull();
  });

  it('fetches a page once and refuses what isn’t a web link', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response('<head><meta property="og:title" content="Hola"></head>', { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    expect((await linkPreview('https://ejemplo.es/a', fetcher)).title).toBe('Hola');
    await linkPreview('https://ejemplo.es/a', fetcher);
    expect(calls).toBe(1);
    await expect(linkPreview('file:///etc/passwd', fetcher)).rejects.toMatchObject({ status: 400 });
    await expect(linkPreview('no', fetcher)).rejects.toMatchObject({ status: 400 });
  });
});

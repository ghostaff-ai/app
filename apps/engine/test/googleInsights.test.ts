import { describe, expect, it } from 'vitest';
import { GOOGLE_SCOPES, googleTools } from '../src/google';
import { googleInsightsTools } from '../src/googleInsights';
import { ToolError } from '../src/tools';

type Call = { url: string; method: string; body: string; headers: Headers };

function fakeFetch(answers: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: String(init.body ?? ''), headers: new Headers(init.headers) });
    const a = answers.shift() ?? { json: {} };
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const now = () => new Date('2026-11-19T10:00:00Z');
const tool = (name: string) => {
  const t = [...googleInsightsTools(now), ...googleTools(now)].find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
};

describe('Google insight tools', () => {
  it('each reads with its own card\'s read-only scope, and none writes', () => {
    for (const t of googleInsightsTools()) {
      expect(t.writes).toBe(false);
      expect([GOOGLE_SCOPES.searchConsole, GOOGLE_SCOPES.analytics, GOOGLE_SCOPES.youtube]).toContain(t.scope);
      expect(['searchconsole', 'analytics', 'youtube']).toContain(t.provider);
    }
  });

  it('Search Console: the last 28 days of searches by default, the site as one encoded segment', async () => {
    const { f, calls } = fakeFetch([{ json: { rows: [{ keys: ['mus online'], clicks: 12, impressions: 300, ctr: 0.04, position: 7.26 }] } }]);
    const out = JSON.parse(await tool('google_search_console_query').run({ accessToken: 't', fetch: f }, { site: 'sc-domain:ordago.club' }));
    expect(calls[0]?.url).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aordago.club/searchAnalytics/query');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ startDate: '2026-10-22', endDate: '2026-11-19', dimensions: ['query'], rowLimit: 50 });
    expect(out.rows).toEqual([{ query: 'mus online', clicks: 12, impressions: 300, ctr: 4, position: 7.3 }]);
  });

  it('Search Console refuses a site that is not one, and a grouping it does not know', async () => {
    const { f, calls } = fakeFetch([]);
    const run = tool('google_search_console_query').run;
    await expect(run({ accessToken: 't', fetch: f }, { site: '../../oauth' })).rejects.toBeInstanceOf(ToolError);
    await expect(run({ accessToken: 't', fetch: f }, { site: 'https://ordago.club/', by: ['secrets'] })).rejects.toThrow('solo admite');
    expect(calls).toHaveLength(0);
  });

  it('Analytics: a report on one property, with checked names', async () => {
    const { f, calls } = fakeFetch([
      { json: { rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '120' }, { value: '150' }, { value: '400' }] }], rowCount: 1 } },
    ]);
    const out = JSON.parse(
      await tool('google_analytics_report').run({ accessToken: 't', fetch: f }, { property: 'properties/123', dimensions: ['sessionDefaultChannelGroup'], from: '7daysAgo' }),
    );
    expect(calls[0]?.url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/123:runReport');
    expect(JSON.parse(calls[0]?.body ?? '{}').dateRanges).toEqual([{ startDate: '7daysAgo', endDate: 'today' }]);
    expect(out.rows).toEqual([{ sessionDefaultChannelGroup: 'Organic Search', activeUsers: 120, sessions: 150, screenPageViews: 400 }]);
    await expect(tool('google_analytics_report').run({ accessToken: 't', fetch: f }, { property: 'properties/1/../x' })).rejects.toBeInstanceOf(ToolError);
    await expect(tool('google_analytics_report').run({ accessToken: 't', fetch: f }, { property: 'properties/1', metrics: ['a b'] })).rejects.toBeInstanceOf(ToolError);
  });

  it('YouTube: the latest videos of the connected channel, with their numbers', async () => {
    const { f, calls } = fakeFetch([
      { json: { items: [{ id: 'UC1', contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] } },
      { json: { items: [{ contentDetails: { videoId: 'abcdefghijk' } }, { contentDetails: { videoId: 'bad id' } }] } },
      { json: { items: [{ id: 'abcdefghijk', snippet: { title: 'Torneo', publishedAt: '2026-11-01' }, statistics: { viewCount: '90', likeCount: '5', commentCount: '2' } }] } },
    ]);
    const out = JSON.parse(await tool('youtube_list_videos').run({ accessToken: 't', fetch: f }, {}));
    expect(calls[1]?.url).toContain('playlistId=UU1');
    expect(calls[2]?.url).toBe('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=abcdefghijk');
    expect(out.videos[0]).toMatchObject({ video: 'abcdefghijk', views: 90, likes: 5, comments: 2 });
  });

  it('YouTube comments: one video, or the whole channel', async () => {
    const one = fakeFetch([{ json: { items: [] } }]);
    await tool('youtube_list_comments').run({ accessToken: 't', fetch: one.f }, { video: 'abcdefghijk' });
    expect(one.calls[0]?.url).toContain('videoId=abcdefghijk');
    const all = fakeFetch([{ json: { items: [{ id: 'UC1', contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] } }, { json: { items: [] } }]);
    await tool('youtube_list_comments').run({ accessToken: 't', fetch: all.f }, {});
    expect(all.calls[1]?.url).toContain('allThreadsRelatedToChannelId=UC1');
    await expect(tool('youtube_list_comments').run({ accessToken: 't', fetch: one.f }, { video: '../x' })).rejects.toBeInstanceOf(ToolError);
  });
});

describe('Google Docs', () => {
  it('uploads the HTML for Drive to convert into a Google Doc, and needs approval', async () => {
    const t = tool('google_docs_create');
    expect(t.writes).toBe(true);
    expect(t.scope).toBe(GOOGLE_SCOPES.driveFile);
    const { f, calls } = fakeFetch([{ json: { id: 'd1', webViewLink: 'https://docs.google.com/document/d/d1' } }]);
    const out = JSON.parse(await t.run({ accessToken: 't', fetch: f }, { title: 'Acta', html: '<h1>Acta</h1><p>Hola</p>' }));
    expect(out).toEqual({ created: true, title: 'Acta', link: 'https://docs.google.com/document/d/d1' });
    expect(calls[0]?.url).toContain('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
    expect(calls[0]?.headers.get('content-type')).toMatch(/^multipart\/related; boundary=ghostaff-/);
    expect(calls[0]?.body).toContain('"mimeType":"application/vnd.google-apps.document"');
    expect(calls[0]?.body).toContain('<h1>Acta</h1><p>Hola</p>');
  });
});

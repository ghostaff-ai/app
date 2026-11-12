// A hosted Supabase project's legacy API keys are JWTs that carry the project's
// ref, so the key alone says which project it opens: the URL never has to be
// typed next to it, and a key and a URL from different projects can't be paired.
// Local keys (`supabase start`) carry no ref, so local work sets SUPABASE_URL.

export function projectUrlFromKey(key: string): string | null {
  const payload = key.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { ref?: unknown };
    return typeof claims.ref === 'string' && /^[a-z0-9]{20}$/.test(claims.ref)
      ? `https://${claims.ref}.supabase.co`
      : null;
  } catch {
    return null;
  }
}

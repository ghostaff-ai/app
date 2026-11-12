import { describe, expect, it } from 'vitest';
import { projectUrlFromKey } from '../src/projectUrl';

const jwt = (claims: object) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');

describe('projectUrlFromKey', () => {
  it('reads the project ref from a hosted key', () => {
    expect(projectUrlFromKey(jwt({ iss: 'supabase', ref: 'rggvcvnstbitbdptiwtk', role: 'service_role' }))).toBe(
      'https://rggvcvnstbitbdptiwtk.supabase.co',
    );
  });

  it('gives nothing for a local key, a malformed ref or garbage', () => {
    expect(projectUrlFromKey(jwt({ iss: 'supabase-demo', role: 'service_role' }))).toBeNull();
    expect(projectUrlFromKey(jwt({ ref: 'evil.example.com/x' }))).toBeNull();
    expect(projectUrlFromKey('sb_secret_abc')).toBeNull();
    expect(projectUrlFromKey('a.!!!.c')).toBeNull();
  });
});

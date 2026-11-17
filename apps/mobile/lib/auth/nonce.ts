import * as Crypto from 'expo-crypto';

// A one-time value tying an ID token to this sign-in. The provider gets its
// SHA-256 and writes it into the token; Supabase gets the raw value and checks
// the two match, so a token caught elsewhere cannot be replayed here.

export interface Nonce {
  raw: string;
  hashed: string;
}

export async function makeNonce(): Promise<Nonce> {
  const raw = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

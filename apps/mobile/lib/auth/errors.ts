// Supabase's auth errors, said in words the person can act on.

export function friendlyAuthError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/signups not allowed|user not found/i.test(msg)) return 'Ese correo no está en ninguna organización. Pide que te añadan.';
  if (/expired|invalid/i.test(msg)) return 'El código no vale o ha caducado. Pide otro.';
  if (/rate limit|too many/i.test(msg)) return 'Demasiados intentos. Espera un minuto y vuelve a probar.';
  return msg;
}

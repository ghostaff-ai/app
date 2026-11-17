// Supabase's auth errors, said in words the person can act on.

/** The person closed the Google or Apple sheet: not an error to show. */
export class SignInCancelled extends Error {
  constructor() {
    super('sign-in cancelled');
    this.name = 'SignInCancelled';
  }
}

export function friendlyAuthError(e: unknown): string {
  if (e instanceof SignInCancelled) return '';
  const msg = e instanceof Error ? e.message : String(e);
  if (/signups not allowed|user not found/i.test(msg)) return 'Ahora mismo no se pueden crear cuentas nuevas. Prueba más tarde.';
  if (/provider is not enabled|unsupported provider|unacceptable audience/i.test(msg)) return 'Esta forma de entrar aún no funciona aquí. Entra con tu correo.';
  if (/expired|invalid/i.test(msg)) return 'El código no vale o ha caducado. Pide otro.';
  if (/rate limit|too many/i.test(msg)) return 'Demasiados intentos. Espera un minuto y vuelve a probar.';
  return msg;
}

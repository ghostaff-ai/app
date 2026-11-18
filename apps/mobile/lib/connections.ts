import type { AccountConnectResult, AccountProvider, AiProvider } from '@ghostaff/shared';
import { EngineError } from '@ghostaff/shared/services';

// What the connections screen says, in Spanish. One place, so the engine's
// refusal codes and the provider cards stay in step.

export interface ProviderCopy {
  title: string;
  /** Where the organisation's data goes with this option (invariant 2: say it plainly). */
  dataNote: string;
  /** Where to find a key, for the key providers. */
  keyHelp?: string;
  keyPlaceholder?: string;
}

export const PROVIDERS: Record<AiProvider, ProviderCopy> = {
  anthropic: {
    title: 'Claude, con tu clave de Anthropic',
    dataNote: 'Lo que hagan los agentes pasa por Anthropic, en Estados Unidos. La factura de la IA llega a tu nombre.',
    keyHelp: 'Créala en console.anthropic.com, en API Keys. Empieza por sk-ant-.',
    keyPlaceholder: 'sk-ant-…',
  },
  openai: {
    title: 'OpenAI, con tu clave',
    dataNote: 'Lo que hagan los agentes pasa por OpenAI, en Estados Unidos. La factura de la IA llega a tu nombre.',
    keyHelp: 'Créala en platform.openai.com, en API keys. Empieza por sk-.',
    keyPlaceholder: 'sk-…',
  },
  vertex: {
    title: 'Claude en tu Google Cloud, en Europa',
    dataNote: 'Los datos se quedan en la región europea que elijas, dentro de tu propio proyecto. La factura la pasa Google.',
  },
};

export const REGION_NAMES: Record<string, string> = {
  'europe-west1': 'Bélgica (europe-west1)',
  'europe-west4': 'Países Bajos (europe-west4)',
};

export function connectErrorMessage(e: unknown, provider: AiProvider): string {
  const code = e instanceof EngineError ? e.code : 'failed';
  switch (code) {
    case 'invalid_key':
      return 'El proveedor no acepta esa clave. Revisa que la hayas copiado entera.';
    case 'bad_key_format':
      return provider === 'anthropic'
        ? 'Eso no parece una clave de Anthropic: empiezan por sk-ant-.'
        : 'Eso no parece una clave de OpenAI: empiezan por sk-.';
    case 'no_access':
      return provider === 'vertex'
        ? 'Aún no tenemos acceso a ese proyecto. Revisa el permiso de los pasos de arriba; a veces tarda un par de minutos en valer.'
        : 'La clave es válida, pero no tiene permiso para usar los modelos.';
    case 'bad_project':
      return 'Eso no parece el ID de un proyecto de Google Cloud (por ejemplo, mi-empresa-ia).';
    case 'bad_region':
      return 'Elige una de las regiones europeas.';
    case 'provider_unavailable':
      return 'No hemos podido comprobarla con el proveedor. Inténtalo en un momento.';
    case 'not_owner':
      return 'Solo quien es propietario de la empresa puede cambiar las conexiones.';
    case 'unauthorized':
      return 'Tu sesión ha caducado. Sal y vuelve a entrar.';
    case 'not_configured':
    case 'unreachable':
      return 'No hemos podido hablar con Ghostaff. Revisa tu conexión e inténtalo de nuevo.';
    default:
      return 'Algo ha fallado. Inténtalo de nuevo.';
  }
}

// Outside accounts, connected by signing in there (docs/plans/ongoing/connectors.md).

export interface AccountCopy {
  title: string;
  /** What the agents may do with it, and what they cannot see. */
  reach: string;
}

export const ACCOUNTS: Record<AccountProvider, AccountCopy> = {
  google: {
    title: 'Google: calendario y hojas de cálculo',
    reach:
      'Tus agentes podrán ver y crear eventos en tu Google Calendar y crear hojas de cálculo en tu Drive. Del Drive solo ven las hojas que creen ellos. Puedes quitar el acceso cuando quieras.',
  },
};

/** What the screen says when the person comes back from the provider's sign-in. */
export function accountResultMessage(result: AccountConnectResult | string | null): { text: string; ok: boolean } {
  switch (result) {
    case 'ok':
      return { text: 'Conectada. Ya puedes pedírselo a tus agentes en el chat.', ok: true };
    case 'denied':
      return { text: 'No has dado permiso, así que no hemos conectado nada.', ok: false };
    case 'missing_scopes':
      return { text: 'Hace falta marcar al menos el calendario o las hojas de cálculo en la pantalla de permisos. Vuelve a intentarlo.', ok: false };
    case 'expired':
      return { text: 'Ha pasado demasiado tiempo. Vuelve a intentarlo.', ok: false };
    default:
      return { text: 'No hemos podido conectarla. Vuelve a intentarlo.', ok: false };
  }
}

export function accountErrorMessage(e: unknown): string {
  const code = e instanceof EngineError ? e.code : 'failed';
  switch (code) {
    case 'provider_not_configured':
      return 'Esta conexión todavía no está disponible.';
    case 'not_yours':
    case 'not_found':
      return 'Esa conexión la empezó otra persona o ya terminó. Pulsa Conectar para empezar de nuevo.';
    case 'not_owner':
      return 'Solo quien es propietario de la empresa puede cambiar las conexiones.';
    case 'unauthorized':
      return 'Tu sesión ha caducado. Sal y vuelve a entrar.';
    case 'not_configured':
    case 'unreachable':
      return 'No hemos podido hablar con Ghostaff. Revisa tu conexión e inténtalo de nuevo.';
    default:
      return 'Algo ha fallado. Inténtalo de nuevo.';
  }
}

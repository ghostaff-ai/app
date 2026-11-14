import type { AiProvider } from '@ghostaff/shared';
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

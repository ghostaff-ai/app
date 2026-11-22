import { type AccountConnectResult, type AiProvider, type CatalogueConnector, type Connection, CONNECTOR_AREAS, CONNECTORS } from '@ghostaff/shared';
import { EngineError } from '@ghostaff/shared/services';

// What the connections screen says, in Spanish. One place, so the engine's
// refusal codes and the provider cards stay in step.

export interface ProviderCopy {
  /** Its row in Conexiones. */
  name: string;
  /** Under the name: where the data goes, in a few words. */
  short: string;
  title: string;
  /** Where the organisation's data goes with this option (invariant 2: say it plainly). */
  dataNote: string;
  /** Where to find a key, for the key providers. */
  keyHelp?: string;
  keyPlaceholder?: string;
  /** What the person risks with this option, said before they connect. */
  warning?: string;
  /** What this option cannot do yet. */
  limit?: string;
}

export const PROVIDERS: Record<AiProvider, ProviderCopy> = {
  anthropic: {
    name: 'Claude con tu clave',
    short: 'Anthropic, en Estados Unidos',
    title: 'Claude, con tu clave de Anthropic',
    dataNote: 'Lo que hagan los agentes pasa por Anthropic, en Estados Unidos. La factura de la IA llega a tu nombre.',
    keyHelp: 'Créala en console.anthropic.com, en API Keys. Empieza por sk-ant-.',
    keyPlaceholder: 'sk-ant-…',
  },
  openai: {
    name: 'OpenAI con tu clave',
    short: 'En Estados Unidos. Tus agentes aún no la usan',
    title: 'OpenAI, con tu clave',
    dataNote: 'Lo que hagan los agentes pasa por OpenAI, en Estados Unidos. La factura de la IA llega a tu nombre.',
    keyHelp: 'Créala en platform.openai.com, en API keys. Empieza por sk-.',
    keyPlaceholder: 'sk-…',
  },
  vertex: {
    name: 'Claude en tu Google Cloud',
    short: 'En Europa, dentro de tu proyecto',
    title: 'Claude en tu Google Cloud, en Europa',
    dataNote: 'Los datos se quedan en la región europea que elijas, dentro de tu propio proyecto. La factura la pasa Google.',
  },
  claude: {
    name: 'Claude con tu suscripción',
    short: 'Tu plan de Claude, en Estados Unidos',
    title: 'Claude · tu suscripción',
    dataNote:
      'Tus agentes usan tu plan de Claude (Pro, Max…) a través de Claude Code, el programa de Anthropic. Lo que hagan pasa por Anthropic, en Estados Unidos, y cuenta en los límites de tu plan.',
    warning:
      'Anthropic puede cortar sin aviso una suscripción usada así. Si pasa, tus agentes siguen con tu clave de Anthropic si has conectado una; si no, dejan de contestar hasta que conectes otra cuenta.',
    limit:
      'Por ahora, con la suscripción tus agentes no pueden usar las apps conectadas (Google, Instagram…). Si conectas también tu clave de Anthropic, la usan cuando hace falta una app.',
  },
};

/** The AI accounts in the order Conexiones lists them: the one that keeps data in Europe first. */
export const AI_ORDER: readonly AiProvider[] = ['vertex', 'claude', 'anthropic', 'openai'];

/**
 * The AI accounts the engine runs agents on today (apps/engine/src/chatStore.ts,
 * aiAccount). An OpenAI key is kept but not used yet, so it doesn't count.
 */
export const RUNS_AGENTS: readonly AiProvider[] = ['vertex', 'claude', 'anthropic'];

/** Whether the organisation has an AI account its agents can run on. */
export const canRunAgents = (items: readonly Connection[]) =>
  items.some((i) => i.kind === 'ai' && (RUNS_AGENTS as readonly string[]).includes(i.provider));

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
// Their titles and what they reach live in the catalogue (@ghostaff/shared, CONNECTORS).

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
    case 'provider_unavailable':
      return 'Ahora mismo no podemos conectar con ese servicio. Inténtalo más tarde; si sigue, avísanos.';
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

/** What the Claude subscription card says when its sign-in is refused or fails. */
export function claudeSignInMessage(code: string): string {
  switch (code) {
    case 'bad_code':
      return 'Anthropic no ha aceptado ese código. Pulsa Conectar y vuelve a empezar; copia el código entero.';
    case 'timeout':
      return 'Ha pasado demasiado tiempo. Pulsa Conectar y vuelve a empezar.';
    case 'claude_unavailable':
      return 'Ahora mismo no podemos abrir el inicio de sesión de Claude. Inténtalo en un momento.';
    case 'not_owner':
      return 'Solo quien es propietario de la empresa puede cambiar las conexiones.';
    case 'unauthorized':
      return 'Tu sesión ha caducado. Sal y vuelve a entrar.';
    case 'not_configured':
    case 'unreachable':
      return 'Se ha cortado la conexión con Ghostaff. Revisa tu conexión y vuelve a empezar.';
    default:
      return 'Algo ha fallado. Inténtalo de nuevo.';
  }
}

/** Lowercase, without accents, so «busqueda» finds «búsqueda». */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export interface ConnectorSection {
  title: string;
  connectors: CatalogueConnector[];
}

/**
 * The account cards of Conexiones, in sections: the ones already connected
 * first, then each area of the catalogue. A search keeps only the cards whose
 * name, title or reach has every word typed.
 */
export function connectorSections(connected: ReadonlySet<string>, search = ''): ConnectorSection[] {
  const words = fold(search).split(/\s+/).filter(Boolean);
  const matches = (c: CatalogueConnector) => {
    const text = fold(`${c.name} ${c.title} ${c.reach} ${c.area}`);
    return words.every((w) => text.includes(w));
  };
  const all = (CONNECTORS as readonly CatalogueConnector[]).filter(matches);
  const sections: ConnectorSection[] = [{ title: 'Conectadas', connectors: all.filter((c) => connected.has(c.id)) }];
  for (const area of CONNECTOR_AREAS) {
    sections.push({ title: area, connectors: all.filter((c) => c.area === area && !connected.has(c.id)) });
  }
  return sections.filter((s) => s.connectors.length > 0);
}

/**
 * What a connector is for, in a few words, under its name in a list: its
 * title without the name, «Google: tus reseñas» → «Tus reseñas».
 */
export function connectorWhat(c: Pick<CatalogueConnector, 'title'>): string {
  const i = c.title.indexOf(': ');
  const what = i < 0 ? c.title : c.title.slice(i + 2);
  return what.charAt(0).toUpperCase() + what.slice(1);
}

// The connector catalogue: every outside account an organisation can connect
// by signing in there (docs/plans/ongoing/connectors.md). One place for what
// the app shows, what the engine connects to and which providers exist; the
// database checks only their shape.
//
// Two kinds. `google` is ours: our own OAuth client and our own tools.
// `mcp` is the maker's: an official remote MCP server that lets any client
// register itself, so its button and its tools come with no per-app code.

interface ConnectorBase {
  /** Lowercase id: the provider in `connections` and in the engine's routes. */
  id: string;
  /** The service's name, as the agent and the person read it. */
  name: string;
  /** The card's title in Conexiones. */
  title: string;
  /** What the agents may do with it, in Spanish, plainly. */
  reach: string;
  /** A step the person must take in the service first, if any. */
  before?: string;
}

export interface GoogleConnector extends ConnectorBase {
  kind: 'google';
  /** The Google scopes this card asks for, through our one OAuth client «Ghostaff Conectores». */
  scopes: readonly string[];
}

export interface McpConnector extends ConnectorBase {
  kind: 'mcp';
  /** The maker's official remote MCP server. */
  url: string;
  /**
   * Scopes to ask for. Absent: the server's own list (its protected-resource
   * metadata), which is what the MCP authorisation spec says a client asks for.
   */
  scopes?: readonly string[];
  /** Scopes of the server's list we never ask for (admin rights, sending mail). */
  dropScopes?: readonly string[];
}

export type Connector = GoogleConnector | McpConnector;

/** In the order Conexiones shows them: Jaime's priorities first (2026-11-18). */
export const CONNECTORS = [
  {
    id: 'google',
    kind: 'google',
    name: 'Google',
    scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/drive.file'],
    title: 'Google: calendario y hojas de cálculo',
    reach:
      'Tus agentes podrán ver y crear eventos en tu Google Calendar y crear hojas de cálculo (tus Excel) en tu Drive. Del Drive solo ven las hojas que creen ellos.',
  },
  {
    id: 'googlebusiness',
    kind: 'google',
    name: 'Google Business Profile',
    scopes: ['https://www.googleapis.com/auth/business.manage'],
    title: 'Google: tus reseñas',
    reach: 'Tus agentes podrán leer las reseñas de tu ficha de Google y contestarlas.',
    before: 'Entra con la cuenta de Google que gestiona la ficha de tu negocio.',
  },
  {
    id: 'holded',
    kind: 'mcp',
    name: 'Holded',
    url: 'https://mcp.holded.com/mcp',
    title: 'Holded: facturas y contabilidad',
    reach: 'Tus agentes podrán consultar y preparar facturas, presupuestos, contactos y gastos en tu Holded.',
    before: 'En Holded, activa la API de tu cuenta (Configuración, Desarrolladores).',
  },
  {
    id: 'stripe',
    kind: 'mcp',
    name: 'Stripe',
    url: 'https://mcp.stripe.com',
    scopes: ['mcp'],
    title: 'Stripe: cobros',
    reach: 'Tus agentes podrán consultar pagos, clientes, suscripciones y facturas de Stripe, y preparar enlaces de pago.',
  },
  {
    id: 'notion',
    kind: 'mcp',
    name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    title: 'Notion',
    reach: 'Tus agentes podrán buscar, leer, crear y editar páginas y bases de datos de tu Notion.',
  },
  {
    id: 'calendly',
    kind: 'mcp',
    name: 'Calendly',
    url: 'https://mcp.calendly.com',
    scopes: ['mcp:scheduling:read', 'mcp:scheduling:write'],
    title: 'Calendly: citas',
    reach: 'Tus agentes podrán ver tus tipos de cita, tu disponibilidad y las reservas.',
  },
  {
    id: 'factorial',
    kind: 'mcp',
    name: 'Factorial',
    url: 'https://mcp.factorialhr.com',
    title: 'Factorial: equipo, ausencias y fichajes',
    reach: 'Tus agentes podrán ver y pedir ausencias, fichajes y tareas en tu Factorial, con tus mismos permisos.',
  },
  {
    id: 'wix',
    kind: 'mcp',
    name: 'Wix',
    url: 'https://mcp.wix.com/mcp',
    title: 'Wix: web, tienda y reservas',
    reach: 'Tus agentes podrán consultar y cambiar tu web de Wix, su tienda, sus reservas y su contenido.',
  },
  {
    id: 'wordpress',
    kind: 'mcp',
    name: 'WordPress.com',
    url: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1',
    title: 'WordPress.com: tu web',
    reach: 'Tus agentes podrán leer y preparar entradas y páginas de tu web, si está alojada en WordPress.com.',
  },
  {
    id: 'airtable',
    kind: 'mcp',
    name: 'Airtable',
    url: 'https://mcp.airtable.com/mcp',
    scopes: ['data.records:read', 'data.records:write', 'schema.bases:read', 'workspacesAndBases:read'],
    title: 'Airtable',
    reach: 'Tus agentes podrán leer y escribir registros en tus bases de Airtable.',
  },
  {
    id: 'pipedrive',
    kind: 'mcp',
    name: 'Pipedrive',
    url: 'https://mcp.pipedrive.ai/mcp',
    dropScopes: ['admin', 'mail-sending:full', 'mail:full'],
    title: 'Pipedrive: ventas',
    reach: 'Tus agentes podrán consultar y actualizar tratos, contactos y actividades de Pipedrive. No envían correos.',
  },
  {
    id: 'monday',
    kind: 'mcp',
    name: 'monday.com',
    url: 'https://mcp.monday.com/mcp',
    title: 'monday.com: tableros',
    reach: 'Tus agentes podrán consultar y actualizar tus tableros y elementos de monday.com.',
  },
  {
    id: 'typeform',
    kind: 'mcp',
    name: 'Typeform',
    url: 'https://api.eu.typeform.com/mcp',
    scopes: ['offline_access', 'accounts:read', 'forms:read', 'forms:write', 'responses:read', 'workspaces:read'],
    title: 'Typeform: formularios',
    reach: 'Tus agentes podrán ver tus formularios y sus respuestas, y preparar formularios nuevos.',
  },
  {
    id: 'linear',
    kind: 'mcp',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    title: 'Linear: tareas',
    reach: 'Tus agentes podrán consultar, crear y actualizar tareas y proyectos de Linear.',
  },
  {
    id: 'webflow',
    kind: 'mcp',
    name: 'Webflow',
    url: 'https://mcp.webflow.com/mcp',
    title: 'Webflow: tu web',
    reach: 'Tus agentes podrán consultar y cambiar el contenido de tu web en Webflow.',
  },
  {
    id: 'paypal',
    kind: 'mcp',
    name: 'PayPal',
    url: 'https://mcp.paypal.com/mcp',
    title: 'PayPal: cobros',
    reach: 'Tus agentes podrán consultar pagos y facturas de PayPal y preparar facturas.',
  },
  {
    id: 'squarespace',
    kind: 'mcp',
    name: 'Squarespace',
    url: 'https://mcp.squarespace.com/mcp',
    scopes: ['mcp'],
    title: 'Squarespace: web y tienda',
    reach: 'Tus agentes podrán consultar pedidos, productos y contactos de tu web de Squarespace.',
  },
] as const satisfies readonly Connector[];

export type AccountProvider = (typeof CONNECTORS)[number]['id'];

/** A connector of the catalogue, with its id narrowed to the providers that exist. */
export type CatalogueConnector = Connector & { id: AccountProvider };

export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = CONNECTORS.map((c) => c.id);

export function connectorFor(id: AccountProvider): CatalogueConnector {
  const c = (CONNECTORS as readonly CatalogueConnector[]).find((x) => x.id === id);
  if (!c) throw new Error(`unknown connector ${id}`);
  return c;
}

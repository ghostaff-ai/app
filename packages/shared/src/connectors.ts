// The connector catalogue: every outside account an organisation can connect
// by signing in there (docs/plans/ongoing/connectors.md). One place for what
// the app shows, what the engine connects to and which providers exist; the
// database checks only their shape.
//
// Three kinds. `google` and `own` are ours: our own app on the platform and our
// own tools in the engine (`google` cards share one OAuth client and differ
// only in scopes). `mcp` is the maker's: an official remote MCP server, so its
// button and its tools come with no per-app code. Most let any client register
// itself; the rest (`app: true`) take our own app, registered once by hand.

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
  /** The group Conexiones shows it under. */
  area: ConnectorArea;
  /**
   * The maker's server takes only a client metadata document (no open
   * registration), so it connects from an https engine (beta), never from a
   * laptop's localhost.
   */
  httpsOnly?: boolean;
}

/** The groups of Conexiones, in the order it shows them. */
export const CONNECTOR_AREAS = [
  'Google',
  'Microsoft 365',
  'Redes sociales',
  'Facturas, cobros y banco',
  'Correo y marketing',
  'Citas y formularios',
  'Ventas y clientes',
  'Equipo y tareas',
  'Web y tienda',
  'Documentos y reuniones',
  'Automatizaciones',
] as const;

export type ConnectorArea = (typeof CONNECTOR_AREAS)[number];

export interface GoogleConnector extends ConnectorBase {
  kind: 'google';
  /** The Google scopes this card asks for, through our one OAuth client «Ghostaff Conectores». */
  scopes: readonly string[];
}

/** Ours with its own code in the engine: our app on the platform (Microsoft 365), behind its review where it has one (Instagram, TikTok). */
export interface OwnConnector extends ConnectorBase {
  kind: 'own';
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
  /**
   * The maker lets no client register itself, so we registered our own app in
   * its developer portal (kind B-app). Its client ID and secret sit in the
   * engine's vault, put there with scripts/connector-app.sh; until they do, the
   * card answers «not available yet».
   */
  app?: true;
}

export type Connector = GoogleConnector | OwnConnector | McpConnector;

/** In the order Conexiones shows them: by area, and within an area Jaime's priorities first (2026-11-18). */
export const CONNECTORS = [
  {
    id: 'google',
    area: 'Google',
    kind: 'google',
    name: 'Google',
    scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/drive.file'],
    title: 'Google: calendario, hojas y documentos',
    reach:
      'Tus agentes podrán ver y crear eventos en tu Google Calendar y crear hojas de cálculo (tus Excel) y documentos en tu Drive. Del Drive solo ven lo que creen ellos.',
  },
  {
    id: 'googlebusiness',
    area: 'Google',
    kind: 'google',
    name: 'Google Business Profile',
    scopes: ['https://www.googleapis.com/auth/business.manage'],
    title: 'Google: tus reseñas',
    reach: 'Tus agentes podrán leer las reseñas de tu ficha de Google y contestarlas.',
    before: 'Entra con la cuenta de Google que gestiona la ficha de tu negocio.',
  },
  {
    id: 'searchconsole',
    area: 'Google',
    kind: 'google',
    name: 'Google Search Console',
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    title: 'Google Search Console: tu web en Google',
    reach: 'Tus agentes podrán ver cómo te encuentra la gente en Google: qué busca, cuántos clics te llegan y en qué posición sales.',
  },
  {
    id: 'analytics',
    area: 'Google',
    kind: 'google',
    name: 'Google Analytics',
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    title: 'Google Analytics: visitas de tu web',
    reach: 'Tus agentes podrán consultar las visitas de tu web, de dónde vienen y qué páginas ven.',
  },
  {
    id: 'youtube',
    area: 'Google',
    kind: 'google',
    name: 'YouTube',
    scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    title: 'YouTube: tu canal',
    reach: 'Tus agentes podrán ver los vídeos de tu canal, sus visitas y los comentarios que reciben.',
  },
  {
    id: 'microsoft',
    area: 'Microsoft 365',
    kind: 'own',
    name: 'Microsoft 365',
    title: 'Microsoft 365: Outlook, calendario y OneDrive',
    reach:
      'Tus agentes podrán leer tu correo de Outlook y dejarte respuestas en borradores, ver y crear eventos en tu calendario, y buscar archivos y leer y rellenar tus Excel de OneDrive. Nunca envían correos ni borran nada.',
  },
  {
    id: 'instagram',
    area: 'Redes sociales',
    kind: 'own',
    name: 'Instagram',
    title: 'Instagram: publicaciones y comentarios',
    reach:
      'Tus agentes podrán ver tus publicaciones y sus estadísticas, contestar y ocultar comentarios, y publicar las fotos, reels y carruseles que hayas aprobado.',
    before: 'Tu cuenta de Instagram tiene que ser profesional (de empresa o de creador).',
  },
  {
    id: 'tiktok',
    area: 'Redes sociales',
    kind: 'own',
    name: 'TikTok',
    title: 'TikTok: vídeos y estadísticas',
    reach: 'Tus agentes podrán ver tus vídeos y sus estadísticas, y subir los vídeos que hayas aprobado.',
  },
  {
    id: 'buffer',
    area: 'Redes sociales',
    kind: 'mcp',
    name: 'Buffer',
    url: 'https://mcp.buffer.com/mcp',
    scopes: ['account:read', 'posts:read', 'posts:write', 'ideas:read', 'ideas:write', 'insights:read', 'engagements:read', 'engagements:write'],
    title: 'Buffer: Facebook, LinkedIn, X y más',
    reach: 'Tus agentes podrán preparar y programar publicaciones en las redes que tengas en Buffer (Facebook, LinkedIn, X, Pinterest, Threads…) y ver cómo funcionan.',
    before: 'Conecta antes tus redes dentro de Buffer.',
  },
  {
    id: 'holded',
    area: 'Facturas, cobros y banco',
    kind: 'mcp',
    name: 'Holded',
    url: 'https://mcp.holded.com/mcp',
    title: 'Holded: facturas y contabilidad',
    reach: 'Tus agentes podrán consultar y preparar facturas, presupuestos, contactos y gastos en tu Holded.',
    before: 'En Holded, activa la API de tu cuenta (Configuración, Desarrolladores).',
  },
  {
    id: 'xero',
    area: 'Facturas, cobros y banco',
    kind: 'mcp',
    app: true,
    name: 'Xero',
    url: 'https://api.xero.com/mcp/v1',
    // Contacts and invoices, the rest read-only: no payments, bank transactions or journals written.
    scopes: [
      'offline_access',
      'accounting.contacts',
      'accounting.invoices',
      'accounting.settings.read',
      'accounting.banktransactions.read',
      'accounting.payments.read',
      'accounting.reports.profitandloss.read',
      'accounting.reports.balancesheet.read',
      'accounting.reports.trialbalance.read',
      'accounting.reports.aged.read',
      'accounting.manualjournals.read',
    ],
    title: 'Xero: contabilidad y facturas',
    reach: 'Tus agentes podrán consultar tus cuentas e informes y preparar contactos y facturas en Xero. No registran pagos.',
  },
  {
    id: 'stripe',
    area: 'Facturas, cobros y banco',
    kind: 'mcp',
    name: 'Stripe',
    url: 'https://mcp.stripe.com',
    scopes: ['mcp'],
    title: 'Stripe: cobros',
    reach: 'Tus agentes podrán consultar pagos, clientes, suscripciones y facturas de Stripe, y preparar enlaces de pago.',
  },
  {
    id: 'paypal',
    area: 'Facturas, cobros y banco',
    kind: 'mcp',
    name: 'PayPal',
    url: 'https://mcp.paypal.com/mcp',
    title: 'PayPal: cobros',
    reach: 'Tus agentes podrán consultar pagos y facturas de PayPal y preparar facturas.',
  },
  {
    id: 'qonto',
    area: 'Facturas, cobros y banco',
    kind: 'mcp',
    name: 'Qonto',
    url: 'https://mcp.qonto.com/mcp',
    scopes: ['offline_access', 'organization.read', 'membership.read', 'team.read', 'attachment.read', 'attachment.write', 'client.read', 'client.write', 'client_invoices.read', 'client_invoice.write', 'supplier_invoice.read', 'supplier_invoice.write', 'product.read', 'product.write', 'payment_link.read', 'payment_link.write', 'einvoicing.read', 'cash_flow_category.read', 'card.read', 'sepa_direct_debit.read', 'subscription.read'],
    title: 'Qonto: tu banco de empresa',
    reach: 'Tus agentes podrán consultar movimientos, facturas de clientes y proveedores y justificantes, y preparar facturas y enlaces de pago. No hacen transferencias ni tocan tarjetas.',
  },
  {
    id: 'square',
    area: 'Facturas, cobros y banco',
    kind: 'mcp',
    name: 'Square',
    url: 'https://mcp.squareup.com/mcp',
    title: 'Square: ventas y cobros',
    reach: 'Tus agentes podrán consultar ventas, pagos, clientes, catálogo y citas de tu Square.',
  },
  {
    id: 'sumup',
    area: 'Facturas, cobros y banco',
    kind: 'mcp',
    name: 'SumUp',
    url: 'https://mcp.sumup.com/mcp',
    httpsOnly: true,
    title: 'SumUp: cobros con tarjeta',
    reach: 'Tus agentes podrán consultar los cobros y las transacciones de tu SumUp.',
  },
  {
    id: 'mailchimp',
    area: 'Correo y marketing',
    kind: 'mcp',
    name: 'Mailchimp',
    url: 'https://mcp.mailchimp.com/mcp',
    scopes: ['accounts:read', 'ads:read', 'audiences:read', 'campaigns:read', 'campaigns:create', 'campaigns:update', 'contacts:read', 'contacts:create', 'contacts:update', 'content:read', 'content:create', 'content:update', 'ecommerce:read', 'reports:read', 'segments:read', 'segments:create', 'segments:update', 'websites:read'],
    title: 'Mailchimp: boletines',
    reach: 'Tus agentes podrán consultar tus listas, contactos e informes, y preparar campañas. No las envían ni borran nada.',
  },
  {
    id: 'brevo',
    area: 'Correo y marketing',
    kind: 'mcp',
    name: 'Brevo',
    url: 'https://mcp.brevo.com/v1/brevo/mcp',
    scopes: ['all'],
    title: 'Brevo: correos y contactos',
    reach: 'Tus agentes podrán consultar y actualizar tus contactos y listas de Brevo y preparar campañas de correo.',
  },
  {
    id: 'mailerlite',
    area: 'Correo y marketing',
    kind: 'mcp',
    name: 'MailerLite',
    url: 'https://mcp.mailerlite.com/mcp',
    title: 'MailerLite: boletines',
    reach: 'Tus agentes podrán consultar suscriptores, grupos y campañas de MailerLite, y preparar campañas.',
  },
  {
    id: 'klaviyo',
    area: 'Correo y marketing',
    kind: 'mcp',
    name: 'Klaviyo',
    url: 'https://mcp.klaviyo.com/mcp',
    title: 'Klaviyo: marketing de tu tienda',
    reach: 'Tus agentes podrán consultar perfiles, listas, campañas y sus resultados en Klaviyo.',
  },
  {
    id: 'semrush',
    area: 'Correo y marketing',
    kind: 'mcp',
    name: 'Semrush',
    url: 'https://mcp.semrush.com/v1/mcp',
    title: 'Semrush: SEO y competencia',
    reach: 'Tus agentes podrán consultar palabras clave, tráfico y competidores en Semrush.',
    before: 'Necesitas un plan de Semrush con acceso a la API.',
  },
  {
    id: 'calendly',
    area: 'Citas y formularios',
    kind: 'mcp',
    name: 'Calendly',
    url: 'https://mcp.calendly.com',
    scopes: ['mcp:scheduling:read', 'mcp:scheduling:write'],
    title: 'Calendly: citas',
    reach: 'Tus agentes podrán ver tus tipos de cita, tu disponibilidad y las reservas.',
  },
  {
    id: 'calcom',
    area: 'Citas y formularios',
    kind: 'mcp',
    name: 'Cal.com',
    url: 'https://mcp.cal.com/mcp',
    title: 'Cal.com: citas',
    reach: 'Tus agentes podrán ver tus tipos de cita, tu disponibilidad y las reservas, y gestionar reservas.',
  },
  {
    id: 'typeform',
    area: 'Citas y formularios',
    kind: 'mcp',
    name: 'Typeform',
    url: 'https://api.eu.typeform.com/mcp',
    scopes: ['offline_access', 'accounts:read', 'forms:read', 'forms:write', 'responses:read', 'workspaces:read'],
    title: 'Typeform: formularios',
    reach: 'Tus agentes podrán ver tus formularios y sus respuestas, y preparar formularios nuevos.',
  },
  {
    id: 'jotform',
    area: 'Citas y formularios',
    kind: 'mcp',
    name: 'Jotform',
    url: 'https://mcp.jotform.com/',
    title: 'Jotform: formularios',
    reach: 'Tus agentes podrán ver tus formularios y sus respuestas, y preparar formularios nuevos.',
  },
  {
    id: 'tally',
    area: 'Citas y formularios',
    kind: 'mcp',
    name: 'Tally',
    url: 'https://mcp.tally.so/mcp',
    title: 'Tally: formularios',
    reach: 'Tus agentes podrán ver tus formularios y sus respuestas, y preparar formularios nuevos.',
  },
  {
    id: 'hubspot',
    area: 'Ventas y clientes',
    kind: 'mcp',
    app: true,
    name: 'HubSpot',
    url: 'https://mcp.hubspot.com',
    title: 'HubSpot: clientes y ventas',
    reach: 'Tus agentes podrán consultar y actualizar contactos, empresas, negocios, tickets y notas de tu HubSpot.',
  },
  {
    id: 'pipedrive',
    area: 'Ventas y clientes',
    kind: 'mcp',
    name: 'Pipedrive',
    url: 'https://mcp.pipedrive.ai/mcp',
    dropScopes: ['admin', 'mail-sending:full', 'mail:full'],
    title: 'Pipedrive: ventas',
    reach: 'Tus agentes podrán consultar y actualizar tratos, contactos y actividades de Pipedrive. No envían correos.',
  },
  {
    id: 'attio',
    area: 'Ventas y clientes',
    kind: 'mcp',
    name: 'Attio',
    url: 'https://mcp.attio.com/mcp',
    title: 'Attio: clientes y ventas',
    reach: 'Tus agentes podrán consultar y actualizar empresas, personas, oportunidades y notas de tu Attio.',
  },
  {
    id: 'close',
    area: 'Ventas y clientes',
    kind: 'mcp',
    name: 'Close',
    url: 'https://mcp.close.com/mcp',
    dropScopes: ['mcp.write_destructive'],
    title: 'Close: ventas',
    reach: 'Tus agentes podrán consultar y actualizar contactos, oportunidades y tareas de Close. No borran nada.',
  },
  {
    id: 'zendesk',
    area: 'Ventas y clientes',
    kind: 'mcp',
    name: 'Zendesk',
    url: 'https://mcp.zendesk.com/mcp',
    httpsOnly: true,
    title: 'Zendesk: atención al cliente',
    reach: 'Tus agentes podrán consultar las incidencias de tus clientes y preparar respuestas.',
  },
  {
    id: 'factorial',
    area: 'Equipo y tareas',
    kind: 'mcp',
    name: 'Factorial',
    url: 'https://mcp.factorialhr.com',
    title: 'Factorial: equipo, ausencias y fichajes',
    reach: 'Tus agentes podrán ver y pedir ausencias, fichajes y tareas en tu Factorial, con tus mismos permisos.',
  },
  {
    id: 'notion',
    area: 'Equipo y tareas',
    kind: 'mcp',
    name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    title: 'Notion: páginas y bases de datos',
    reach: 'Tus agentes podrán buscar, leer, crear y editar páginas y bases de datos de tu Notion.',
  },
  {
    id: 'airtable',
    area: 'Equipo y tareas',
    kind: 'mcp',
    name: 'Airtable',
    url: 'https://mcp.airtable.com/mcp',
    scopes: ['data.records:read', 'data.records:write', 'schema.bases:read', 'workspacesAndBases:read'],
    title: 'Airtable: bases de datos',
    reach: 'Tus agentes podrán leer y escribir registros en tus bases de Airtable.',
  },
  {
    id: 'monday',
    area: 'Equipo y tareas',
    kind: 'mcp',
    name: 'monday.com',
    url: 'https://mcp.monday.com/mcp',
    title: 'monday.com: tableros',
    reach: 'Tus agentes podrán consultar y actualizar tus tableros y elementos de monday.com.',
  },
  {
    id: 'linear',
    area: 'Equipo y tareas',
    kind: 'mcp',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    title: 'Linear: tareas',
    reach: 'Tus agentes podrán consultar, crear y actualizar tareas y proyectos de Linear.',
  },
  {
    id: 'asana',
    area: 'Equipo y tareas',
    kind: 'mcp',
    app: true,
    name: 'Asana',
    url: 'https://mcp.asana.com/v2/mcp',
    title: 'Asana: proyectos y tareas',
    reach: 'Tus agentes podrán consultar proyectos y crear, asignar y comentar tareas de tu Asana.',
  },
  {
    id: 'clickup',
    area: 'Equipo y tareas',
    kind: 'mcp',
    name: 'ClickUp',
    url: 'https://mcp.clickup.com/mcp',
    title: 'ClickUp: tareas',
    reach: 'Tus agentes podrán consultar, crear y actualizar tareas y documentos de ClickUp.',
  },
  {
    id: 'todoist',
    area: 'Equipo y tareas',
    kind: 'mcp',
    name: 'Todoist',
    url: 'https://ai.todoist.net/mcp',
    title: 'Todoist: tareas',
    reach: 'Tus agentes podrán consultar, crear y completar tareas de tu Todoist.',
  },
  {
    id: 'miro',
    area: 'Equipo y tareas',
    kind: 'mcp',
    name: 'Miro',
    url: 'https://mcp.miro.com/',
    title: 'Miro: pizarras',
    reach: 'Tus agentes podrán leer tus pizarras de Miro y añadirles notas, diagramas y tablas.',
  },
  {
    id: 'wix',
    area: 'Web y tienda',
    kind: 'mcp',
    name: 'Wix',
    url: 'https://mcp.wix.com/mcp',
    title: 'Wix: web, tienda y reservas',
    reach: 'Tus agentes podrán consultar y cambiar tu web de Wix, su tienda, sus reservas y su contenido.',
  },
  {
    id: 'wordpress',
    area: 'Web y tienda',
    kind: 'mcp',
    name: 'WordPress.com',
    url: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1',
    title: 'WordPress.com: tu web',
    reach: 'Tus agentes podrán leer y preparar entradas y páginas de tu web, si está alojada en WordPress.com.',
  },
  {
    id: 'webflow',
    area: 'Web y tienda',
    kind: 'mcp',
    name: 'Webflow',
    url: 'https://mcp.webflow.com/mcp',
    title: 'Webflow: tu web',
    reach: 'Tus agentes podrán consultar y cambiar el contenido de tu web en Webflow.',
  },
  {
    id: 'squarespace',
    area: 'Web y tienda',
    kind: 'mcp',
    name: 'Squarespace',
    url: 'https://mcp.squarespace.com/mcp',
    scopes: ['mcp'],
    httpsOnly: true,
    title: 'Squarespace: web y tienda',
    reach: 'Tus agentes podrán consultar pedidos, productos y contactos de tu web de Squarespace.',
  },
  {
    id: 'dropbox',
    area: 'Documentos y reuniones',
    kind: 'mcp',
    name: 'Dropbox',
    url: 'https://mcp.dropbox.com/mcp',
    scopes: ['account_info.read', 'files.metadata.read', 'files.metadata.write', 'files.content.read', 'files.content.write'],
    title: 'Dropbox: archivos',
    reach: 'Tus agentes podrán buscar, leer y guardar archivos en tu Dropbox. No comparten nada con nadie.',
  },
  {
    id: 'canva',
    area: 'Documentos y reuniones',
    kind: 'mcp',
    app: true,
    name: 'Canva',
    // Canva Connect's server, which takes our own app (the other one, mcp.canva.com, only its listed clients).
    url: 'https://api.canva.com/connect/v1/mcp',
    dropScopes: ['brandtemplate:content:write', 'help:answers:write'],
    title: 'Canva: diseños',
    reach: 'Tus agentes podrán buscar tus diseños, crear otros nuevos con tu marca, subir imágenes y comentar en tu Canva.',
  },
  {
    id: 'docusign',
    area: 'Documentos y reuniones',
    kind: 'mcp',
    app: true,
    name: 'DocuSign',
    url: 'https://mcp.docusign.com/mcp',
    dropScopes: ['aow_manage', 'spring_write', 'cors'],
    title: 'DocuSign: firmas',
    reach: 'Tus agentes podrán ver tus acuerdos y el estado de cada firma, y preparar sobres para firmar. Enviarlos lo apruebas tú.',
    before: 'Quien administre tu cuenta de DocuSign tiene que permitir el acceso de asistentes (MCP).',
  },
  {
    id: 'gamma',
    area: 'Documentos y reuniones',
    kind: 'mcp',
    name: 'Gamma',
    url: 'https://mcp.gamma.app/mcp',
    title: 'Gamma: presentaciones',
    reach: 'Tus agentes podrán crear presentaciones, documentos y webs sencillas con Gamma.',
  },
  {
    id: 'zoom',
    area: 'Documentos y reuniones',
    kind: 'mcp',
    app: true,
    name: 'Zoom',
    url: 'https://mcp.zoom.us/mcp/zoom/streamable',
    dropScopes: [
      'meeting:delete:meeting',
      'meeting:update:in_meeting_controls',
      'docs:write:collaborator',
      'docs:update:collaborator',
      'docs:delete:collaborator',
      'hub:write:content',
      'workflow:write:definition',
    ],
    title: 'Zoom: reuniones y grabaciones',
    reach: 'Tus agentes podrán buscar tus reuniones, leer sus resúmenes y transcripciones, y programar reuniones nuevas.',
  },
  {
    id: 'fireflies',
    area: 'Documentos y reuniones',
    kind: 'mcp',
    name: 'Fireflies',
    url: 'https://mcp.fireflies.ai/mcp',
    title: 'Fireflies: actas de reuniones',
    reach: 'Tus agentes podrán buscar y leer las transcripciones y resúmenes de tus reuniones grabadas con Fireflies.',
  },
  {
    id: 'granola',
    area: 'Documentos y reuniones',
    kind: 'mcp',
    name: 'Granola',
    url: 'https://mcp.granola.ai/mcp',
    title: 'Granola: notas de reuniones',
    reach: 'Tus agentes podrán buscar y leer las notas de tus reuniones en Granola.',
  },
  {
    id: 'tldv',
    area: 'Documentos y reuniones',
    kind: 'mcp',
    name: 'tl;dv',
    url: 'https://mcp.tldv.io/mcp',
    title: 'tl;dv: reuniones grabadas',
    reach: 'Tus agentes podrán buscar y leer las transcripciones y notas de tus reuniones grabadas con tl;dv.',
  },
  {
    id: 'zapier',
    area: 'Automatizaciones',
    kind: 'mcp',
    name: 'Zapier',
    url: 'https://mcp.zapier.com/api/mcp/mcp',
    title: 'Zapier: miles de aplicaciones más',
    reach: 'Tus agentes podrán usar las acciones que actives en Zapier, con cualquiera de sus miles de aplicaciones.',
    before: 'En Zapier, elige qué acciones dejas usar (mcp.zapier.com). Cada uso gasta tareas de tu plan de Zapier.',
  },
  {
    id: 'make',
    area: 'Automatizaciones',
    kind: 'mcp',
    name: 'Make',
    url: 'https://mcp.make.com',
    title: 'Make: tus escenarios',
    reach: 'Tus agentes podrán lanzar los escenarios de Make que marques como herramientas.',
    before: 'En Make, marca qué escenarios pueden usar los agentes.',
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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';

// Órdago's agents as Ghostaff agents (docs/plans/ongoing/ordago-agents-in-ghostaff.md,
// step 2): each `proyectos/<proyecto>/agentes/<agente>.yaml` of ghostaff-ai/agents
// becomes a row in `agents` that runs as its job (`ordago_job`), with the
// department and ghost Álvaro chose (2026-11-21). Worked out without the
// database, so it can be tested.

/** Álvaro, 2026-11-21: five departments; `prueba` stays out. */
const PLACES: Record<string, { name: string; ghost: string; department: string }> = {
  direccion: { name: 'Dirección', ghost: 'base', department: 'direccion' },
  correo: { name: 'Correo', ghost: 'secretaria', department: 'direccion' },
  finanzas: { name: 'Finanzas', ghost: 'finanzas', department: 'finanzas' },
  legal: { name: 'Legal', ghost: 'base', department: 'legal' },
  producto: { name: 'Producto', ghost: 'base', department: 'producto' },
  desarrollo: { name: 'Desarrollo', ghost: 'base', department: 'producto' },
  comercial: { name: 'Comercial', ghost: 'base', department: 'marketing' },
  organico: { name: 'Orgánico', ghost: 'redes', department: 'marketing' },
  seo: { name: 'SEO', ghost: 'redes', department: 'marketing' },
  productor: { name: 'Productor', ghost: 'productor', department: 'marketing' },
  lamesa: { name: 'La Mesa', ghost: 'productor', department: 'marketing' },
};

export const LEFT_OUT = new Set(['prueba']);

export interface ImportedAgent {
  slug: string;
  name: string;
  ghost: string;
  department: string;
  description: string | null;
  schedule: string | null;
  runner: 'ordago_job';
  job_project: string;
  job_region: string;
  job_name: string;
  job_identity: string;
}

/** «dice qué dice la ley…» → «Dice qué dice la ley…», on one line. */
function sentence(s: unknown): string | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = s.replace(/\s+/g, ' ').trim().slice(0, 1000);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The agents of one project folder (`…/agents/proyectos/ordago`). */
export function readProjectAgents(projectDir: string): ImportedAgent[] {
  const project = basename(projectDir);
  const conf = parse(readFileSync(join(projectDir, 'proyecto.yaml'), 'utf8')) as { gcp?: { proyecto?: string; region?: string } };
  const gcp = conf.gcp?.proyecto;
  const region = conf.gcp?.region;
  if (!gcp || !region) throw new Error(`${projectDir}/proyecto.yaml has no gcp.proyecto and gcp.region`);
  const dir = join(projectDir, 'agentes');
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.slice(0, -'.yaml'.length))
    .filter((slug) => !LEFT_OUT.has(slug))
    .sort()
    .map((slug) => {
      const a = parse(readFileSync(join(dir, `${slug}.yaml`), 'utf8')) as { descripcion?: string; horario?: string };
      const place = PLACES[slug] ?? { name: slug.charAt(0).toUpperCase() + slug.slice(1), ghost: 'base', department: 'direccion' };
      const job = `${project}-${slug}`;
      return {
        slug,
        ...place,
        description: sentence(a.descripcion),
        schedule: typeof a.horario === 'string' ? a.horario : null,
        runner: 'ordago_job' as const,
        job_project: gcp,
        job_region: region,
        job_name: job,
        job_identity: `${job}@${gcp}.iam.gserviceaccount.com`,
      };
    });
}

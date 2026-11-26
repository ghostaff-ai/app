// Every organisation gets a record in our record store (docs/plans/ongoing/record-store.md,
// decision 4): the tick makes one for each organisation still without any, so a failure retries on
// its own. An organisation that brought its own GitHub repo as master (record_host `github`) is left
// alone.

import { MAIN_AGENT_NAME } from '@ghostaff/shared';
import { agentUsername, type ForgejoAdmin, recordRepoName } from './forgejo';
import { type HookAgent, preReceiveHook } from './recordHook';
import type { RecordSyncStore } from './recordSync';

/** An agent of the organisation on our runner, as the record's hook needs it. */
export interface RecordAgent {
  id: string;
  slug: string;
  /** The organisation's main agent keeps the company's memory (agents.is_main). */
  isMain: boolean;
}

export interface ProvisionDeps {
  store: Pick<RecordSyncStore, 'orgsWithoutRecord' | 'setOwnRecord'>;
  admin: ForgejoAdmin;
  adminUser: string;
  /** The organisation's agents on our runner: the only ones that push to its record. */
  agentsOf(orgId: string): Promise<RecordAgent[]>;
}

/** Who may push what to the record (recordHook.ts): each agent on our runner, the main agent also the company's memory. */
export const hookAgents = (agents: RecordAgent[]): HookAgent[] =>
  agents.map((a) => ({ username: agentUsername(a.id), slug: a.slug, writesCompany: a.isMain }));

/** The record's first commit: how it is laid out, for the people and agents who read it. */
export function recordSeed(orgName: string): { path: string; content: string }[] {
  return [
    {
      path: 'AGENTS.md',
      content: `# ${orgName}

El registro de ${orgName} en Ghostaff: lo que sus agentes saben y hacen, con su historia. Cada cambio es un
commit, con quién lo hizo y cuándo.

- \`memoria/empresa/\`: qué es ${orgName} y cómo trabaja. La guarda ${MAIN_AGENT_NAME}; las personas la corrigen desde Ghostaff.
- \`memoria/agentes/<agente>/\`: lo que cada agente ha aprendido haciendo su trabajo. Cada agente escribe solo en la suya.
- \`agentes/<agente>/AGENTS.md\`: las instrucciones de cada agente. Solo las cambian personas, desde Ghostaff.
- \`por-decidir/\`: lo que espera la decisión de una persona.
- \`externos/\`: las personas, empresas y servicios con los que trabaja ${orgName}, y qué hace cada uno. Los añade o confirma una persona desde Ghostaff; un agente los propone.
`,
    },
    { path: 'memoria/empresa/.gitkeep', content: '' },
    { path: 'por-decidir/.gitkeep', content: '' },
    { path: 'externos/.gitkeep', content: '' },
  ];
}

/** Makes the records still missing; one line per organisation, for the tick's answer. Never throws for one organisation. */
export async function provisionRecords(deps: ProvisionDeps): Promise<string[]> {
  const orgs = await deps.store.orgsWithoutRecord();
  if (!orgs.length) return [];
  await deps.admin.ensureOwner();
  const out: string[] = [];
  for (const org of orgs) {
    const repo = recordRepoName(org.id);
    try {
      const hook = preReceiveHook(deps.adminUser, hookAgents(await deps.agentsOf(org.id)));
      await deps.admin.ensureRecord(repo, recordSeed(org.name), hook);
      out.push((await deps.store.setOwnRecord(org.id, repo)) ? `${org.slug}: record made, ${repo}` : `${org.slug}: had a record meanwhile`);
    } catch (e) {
      out.push(`${org.slug}: record not made: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  appendHistoryRow,
  applySync,
  markWrittenBack,
  DECISIONS_DIR,
  HISTORY_PATH,
  historyRow,
  readDecision,
  recordIdFromPath,
  writeAnswer,
} from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';
import { readProjectAgents } from './agents';
import { importHealth } from './healthImport';
import { planSync, type RecordFile } from './plan';
import { projectUrlFromKey } from './projectUrl';

// The record → database job, run by hand until it moves to Cloud Run Jobs.
//
//   pnpm sync:por-decidir --org ordago --record ~/githubs/ordago-app/business [--write-back]
//   pnpm --filter @ghostaff/sync org add-org --slug ordago --name Órdago
//   pnpm --filter @ghostaff/sync org add-member --org ordago --email a@b.c --name Álvaro [--role owner]
//   pnpm --filter @ghostaff/sync org set-record --org ordago --repo ordago-app/business --installation 123
//     (the record connector: from then on the engine syncs it every five minutes)
//   pnpm --filter @ghostaff/sync org add-agents --org ordago --from ~/githubs/ghostaff-ai/agents/proyectos/ordago
//     (Órdago's agents in Equipo, each running as its job; again to refresh them)
//   pnpm --filter @ghostaff/sync org add-agents --org ordago --from … --runner ghostaff --only legal
//     (those agents move to Ghostaff's own runner: task, model, tools, turns and timetable from their yaml)
//   … --runner ghostaff --only legal --on-demand
//     (the same, without the timetable: it runs only when written to, and its old job keeps the timetable)
//   pnpm --filter @ghostaff/sync org import-health --org <personal slug> --provider whoop --dir ~/Desktop/whoop-export/data/<date>
//     (a Whoop export into a personal space's kept health history; again with the same folder changes nothing)
//
// It writes with the service-role key, which bypasses row-level security, so it
// runs only on our machines and in the engine, never in the app. The key comes
// from the environment (apps/sync/.env locally, Secret Manager in the engine).

function admin(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.SUPABASE_URL || (key ? projectUrlFromKey(key) : null);
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_SERVICE_ROLE_KEY (`secret env ghostaff-ai/app` for the hosted project), plus SUPABASE_URL for a local one (see apps/sync/.env.example).',
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function orgBySlug(db: SupabaseClient, slug: string): Promise<string> {
  const { data, error } = await db.from('organizations').select('id').eq('slug', slug).maybeSingle<{ id: string }>();
  if (error) throw error;
  if (!data) throw new Error(`No organisation «${slug}». Create it with: org add-org --slug ${slug} --name …`);
  return data.id;
}

function readRecord(recordPath: string): { files: RecordFile[]; commit: string | null } {
  const dir = join(recordPath, DECISIONS_DIR);
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const files = readdirSync(dir).flatMap((name) => {
    const id = recordIdFromPath(name);
    return id ? [{ id, yaml: readFileSync(join(dir, name), 'utf8') }] : [];
  });
  let commit: string | null = null;
  try {
    commit = execFileSync('git', ['-C', recordPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // Not a git checkout: fine for a test folder.
  }
  return { files, commit };
}

async function syncPorDecidir(opts: { org: string; record: string; writeBack: boolean }) {
  const db = admin();
  const orgId = await orgBySlug(db, opts.org);
  const { files, commit } = readRecord(opts.record);

  const { data: existing, error } = await db.from('decisions').select('*').eq('org_id', orgId).returns<DecisionRow[]>();
  if (error) throw error;

  const { data: agents, error: agentsError } = await db.from('agents').select('id, slug, name, ghost').eq('org_id', orgId);
  if (agentsError) throw agentsError;

  const plan = planSync({ orgId, files, existing: existing ?? [], agents: agents ?? [], commit, now: new Date() });

  await applySync(db, plan);

  for (const w of plan.writeBacks) {
    if (!opts.writeBack) continue;
    const path = join(opts.record, DECISIONS_DIR, `${w.recordId}.yaml`);
    const yaml = readFileSync(path, 'utf8');
    writeFileSync(path, writeAnswer(yaml, w.recordId, w.answer));
    const historyFile = join(opts.record, HISTORY_PATH);
    const csv = existsSync(historyFile) ? readFileSync(historyFile, 'utf8') : null;
    writeFileSync(historyFile, appendHistoryRow(csv, historyRow(readDecision(w.recordId, yaml), w.answer)));
    await markWrittenBack(db, [w.rowId]);
  }

  console.log(
    [
      `${opts.org}: ${plan.upserts.length} in the record, ${plan.close.length} closed`,
      plan.writeBacks.length
        ? opts.writeBack
          ? `${plan.writeBacks.length} app answers written into ${opts.record} (not committed): ${plan.writeBacks.map((w) => w.recordId).join(', ')}`
          : `${plan.writeBacks.length} app answers waiting to be written back (run with --write-back): ${plan.writeBacks.map((w) => w.recordId).join(', ')}`
        : null,
      ...plan.invalid.map((i) => `skipped ${i.id}: ${i.error}`),
      ...plan.conflicts.map((c) => `conflict on ${c.recordId}: app said ${c.app}, record says ${c.record}; kept the record's`),
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function addOrg(opts: { slug: string; name: string }) {
  const db = admin();
  const { data, error } = await db.from('organizations').upsert({ slug: opts.slug, name: opts.name }, { onConflict: 'slug' }).select('id').single();
  if (error) throw error;
  // Not made through create_organization, so it has no main agent yet; safe to repeat.
  const { error: mainError } = await db.rpc('ensure_main_agent', { target_org: data.id });
  if (mainError) throw mainError;
  console.log(`organisation ${opts.slug} ready`);
}

async function setRecord(opts: { org: string; repo: string; installation: string }) {
  const installation = Number(opts.installation);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(opts.repo)) throw new Error('--repo is owner/name');
  if (!Number.isInteger(installation) || installation <= 0) throw new Error('--installation is the GitHub App installation id');
  const { data, error } = await admin()
    .from('organizations')
    .update({ record_host: 'github', record_repo: opts.repo, record_installation: installation, record_sync_error: null })
    .eq('slug', opts.org)
    .select('slug');
  if (error) throw error;
  if (!data?.length) throw new Error(`No organisation «${opts.org}»`);
  console.log(`${opts.org}'s record is ${opts.repo} (installation ${installation}); the engine syncs it on its next tick`);
}

async function addAgents(opts: { org: string; from: string; runner?: 'ghostaff'; only?: string[]; onDemand?: boolean }) {
  const db = admin();
  const orgId = await orgBySlug(db, opts.org);
  const agents = readProjectAgents(opts.from, { runner: opts.runner, only: opts.only, onDemand: opts.onDemand });
  if (agents.length === 0) throw new Error('No agent to import: check --from and --only');
  // Upsert by (org, slug): running it again refreshes the job and the text, and keeps the agent's
  // threads, runs and access levels. The partial unique index needs the conflict target spelled out.
  for (const a of agents) {
    const { data: found, error: e1 } = await db
      .from('agents')
      .select('id, runner, task_in_record')
      .eq('org_id', orgId)
      .eq('slug', a.slug)
      .maybeSingle<{ id: string; runner: string; task_in_record: boolean }>();
    if (e1) throw e1;
    // A refresh of every agent never moves one back off our runner: that takes saying so (and its job turned back on).
    if (found?.runner === 'ghostaff' && a.runner !== 'ghostaff') {
      console.log(`kept    ${a.name.padEnd(11)} on our runner (move it back only by hand)`);
      continue;
    }
    // Moving onto our runner, its timetable counts from now: the tick starts it at its next fire time, never a missed one.
    const moved = a.runner === 'ghostaff' ? { ...a, last_scheduled_at: new Date().toISOString() } : a;
    // Its instructions in the record (agentes/<slug>/AGENTS.md) are the master: the yaml's prompt never replaces them.
    const row = found?.task_in_record && 'task' in moved ? (({ task: _yaml, ...rest }) => rest)(moved) : moved;
    const { error } = found
      ? await db.from('agents').update(row).eq('id', found.id)
      : await db.from('agents').insert({ ...row, org_id: orgId, member_default: 'read' });
    if (error) throw error;
    const where = a.runner === 'ghostaff' ? `our runner, ${a.model}${a.schedule ? '' : ', when written to'}` : a.job_name;
    console.log(`${found ? 'updated' : 'added  '} ${a.name.padEnd(11)} ${a.department.padEnd(10)} ${where}`);
  }
}

async function addMember(opts: { org: string; email: string; name: string; role: string }) {
  const db = admin();
  const orgId = await orgBySlug(db, opts.org);
  const email = opts.email.trim().toLowerCase();
  // Find or create the login. Creating it confirmed lets the person sign in
  // with the emailed code straight away.
  let userId: string | undefined;
  for (let page = 1; !userId; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
  }
  const { error } = await db
    .from('memberships')
    .upsert({ org_id: orgId, user_id: userId, display_name: opts.name, role: opts.role }, { onConflict: 'org_id,user_id' });
  if (error) throw error;
  // Someone added by hand skips the welcome screen; a profile they already have is kept.
  const profile = await db.from('profiles').upsert({ user_id: userId, full_name: opts.name }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (profile.error) throw profile.error;
  console.log(`${email} is ${opts.role} of ${opts.org}, signs as ${opts.name}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      org: { type: 'string' },
      record: { type: 'string' },
      'write-back': { type: 'boolean', default: false },
      slug: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      role: { type: 'string', default: 'member' },
      repo: { type: 'string' },
      installation: { type: 'string' },
      from: { type: 'string' },
      runner: { type: 'string' },
      only: { type: 'string' },
      'on-demand': { type: 'boolean', default: false },
      provider: { type: 'string' },
      dir: { type: 'string' },
    },
  });
  const need = (k: keyof typeof values) => {
    const v = values[k];
    if (typeof v !== 'string' || !v) throw new Error(`--${k} is required`);
    return v;
  };
  switch (command) {
    case 'por-decidir':
      return syncPorDecidir({ org: need('org'), record: need('record'), writeBack: !!values['write-back'] });
    case 'add-org':
      return addOrg({ slug: need('slug'), name: need('name') });
    case 'add-agents': {
      const runner = values.runner;
      if (runner !== undefined && runner !== 'ghostaff') throw new Error('--runner is ghostaff (or left out: each agent runs as its job)');
      const only = values.only?.split(',').map((s) => s.trim()).filter(Boolean);
      return addAgents({ org: need('org'), from: need('from'), runner, only, onDemand: !!values['on-demand'] });
    }
    case 'set-record':
      return setRecord({ org: need('org'), repo: need('repo'), installation: need('installation') });
    case 'add-member': {
      const role = need('role');
      if (role !== 'owner' && role !== 'member') throw new Error('--role is owner or member');
      return addMember({ org: need('org'), email: need('email'), name: need('name'), role });
    }
    case 'import-health': {
      if (need('provider') !== 'whoop') throw new Error('--provider is whoop (the only band with an import today)');
      const counts = await importHealth(admin(), { org: need('org'), provider: 'whoop', dir: need('dir') });
      console.log(`Imported ${counts.records} records and ${counts.metrics} daily metrics into ${values.org}`);
      return;
    }
    default:
      throw new Error('Commands: por-decidir, add-org, add-member, set-record, add-agents, import-health');
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

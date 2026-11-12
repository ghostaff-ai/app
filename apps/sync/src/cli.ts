import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  appendHistoryRow,
  DECISIONS_DIR,
  HISTORY_PATH,
  historyRow,
  readDecision,
  recordIdFromPath,
  writeAnswer,
} from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';
import { planSync, type RecordFile } from './plan';

// The record → database job, run by hand until it moves to Cloud Run Jobs.
//
//   pnpm sync:por-decidir --org ordago --record ~/githubs/ordago-app/business [--write-back]
//   pnpm --filter @ghostaff/sync org add-org --slug ordago --name Órdago
//   pnpm --filter @ghostaff/sync org add-member --org ordago --email a@b.c --name Álvaro [--role owner]
//
// It writes with the service-role key, which bypasses row-level security, so it
// runs only on our machines and in the engine, never in the app. The key comes
// from the environment (apps/sync/.env locally, Secret Manager in the engine).

function admin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see apps/sync/.env.example).');
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

  const plan = planSync({ orgId, files, existing: existing ?? [], commit, now: new Date() });

  // Two batches, each with the same columns: in a mixed batch PostgREST would
  // write NULL into the answer columns of the rows that do not carry one, and
  // wipe an app answer that has not been written back yet.
  const withAnswer = plan.upserts.filter((u) => u.answer);
  const withoutAnswer = plan.upserts.filter((u) => !u.answer);
  for (const batch of [withAnswer, withoutAnswer]) {
    if (!batch.length) continue;
    const { error: e } = await db.from('decisions').upsert(batch, { onConflict: 'org_id,record_id' });
    if (e) throw e;
  }
  if (plan.close.length) {
    const { error: e } = await db.from('decisions').update({ closed_at: new Date().toISOString() }).in('id', plan.close);
    if (e) throw e;
  }

  for (const w of plan.writeBacks) {
    if (!opts.writeBack) continue;
    const path = join(opts.record, DECISIONS_DIR, `${w.recordId}.yaml`);
    const yaml = readFileSync(path, 'utf8');
    writeFileSync(path, writeAnswer(yaml, w.recordId, w.answer));
    const historyFile = join(opts.record, HISTORY_PATH);
    const csv = existsSync(historyFile) ? readFileSync(historyFile, 'utf8') : null;
    writeFileSync(historyFile, appendHistoryRow(csv, historyRow(readDecision(w.recordId, yaml), w.answer)));
    const { error: e } = await db.from('decisions').update({ written_back_at: new Date().toISOString() }).eq('id', w.rowId);
    if (e) throw e;
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
  const { error } = await admin().from('organizations').upsert({ slug: opts.slug, name: opts.name }, { onConflict: 'slug' });
  if (error) throw error;
  console.log(`organisation ${opts.slug} ready`);
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
    case 'add-member': {
      const role = need('role');
      if (role !== 'owner' && role !== 'member') throw new Error('--role is owner or member');
      return addMember({ org: need('org'), email: need('email'), name: need('name'), role });
    }
    default:
      throw new Error('Commands: por-decidir, add-org, add-member');
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

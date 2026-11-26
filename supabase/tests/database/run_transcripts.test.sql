-- Runs' transcripts (20261126810000_run_transcripts.sql): a private bucket no
-- person reads, not even their own organisation's (only the engine does, for a
-- run); which agents read their organisation's runs is the service role's to
-- set; the tick's list of expired transcripts is the engine's alone.
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

insert into public.agents (id, org_id, name, ghost, department, member_default, slug) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Dirección', 'base', 'direccion', 'talk', 'direccion');

insert into public.agent_runs (id, org_id, agent_id, origin) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'schedule');

-- What the engine stores with the service role: one old, one recent.
insert into storage.objects (bucket_id, name, created_at) values
  ('run-transcripts', '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001.jsonl.gz', now() - interval '91 days'),
  ('run-transcripts', '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000002.jsonl.gz', now());

select is((select public from storage.buckets where id = 'run-transcripts'), false, 'the bucket is private');
select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and (qual like '%run-transcripts%' or with_check like '%run-transcripts%'))::int,
  0, 'no policy opens the bucket to anyone: only the engine, with the service role');

select is((select reads_org_runs from public.agents where id = '20000000-0000-0000-0000-000000000001'), false,
  'an agent reads only its own runs by default');

select lives_ok(
  $$ update public.agent_runs set transcript_path =
       '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001.jsonl.gz'
     where id = '40000000-0000-0000-0000-000000000001' $$,
  'the engine notes where the run''s transcript is');
select throws_ok(
  $$ update public.agent_runs set transcript_path = '../otra/x.jsonl.gz' where id = '40000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a transcript path is <org>/<agent>/<run>.jsonl.gz and nothing else');

select is(
  (select array_agg(n) from public.expired_run_transcripts(now() - interval '90 days') as n),
  array['10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001.jsonl.gz'],
  'the tick finds only the transcripts older than 90 days');

-- Ana, an owner of the organisation whose transcripts they are.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

select is((select count(*) from storage.objects where bucket_id = 'run-transcripts')::int, 0,
  'not even an owner of the organisation reads its transcripts directly');
select throws_ok(
  $$ update public.agents set reads_org_runs = true where id = '20000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'an owner cannot let an agent read the others'' runs from the app');
select throws_ok(
  $$ update public.agent_runs set transcript_path = null where id = '40000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'nor change where a run''s transcript is');
select throws_ok(
  $$ select public.expired_run_transcripts(now()) $$,
  '42501', null, 'nor list the bucket through the tick''s function');

-- Carla, of another organisation.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'run-transcripts')::int, 0,
  'another organisation''s member reads none');

select * from finish();
rollback;

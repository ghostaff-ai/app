-- General's daily summaries (20261127610000_general_digests.sql): only the
-- engine reads and writes them; the days due are each organisation's finished
-- Madrid days with messages in General and no summary yet.
begin;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com');
insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería');
insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana');

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;
insert into ids select 'general', id from public.threads where org_id = '10000000-0000-0000-0000-000000000001' and kind = 'general';

-- Two Madrid days: 23:30 Madrid on the 24th is 22:30 UTC; 00:30 Madrid on the 25th is 23:30 UTC the 24th.
insert into public.messages (thread_id, org_id, author_kind, author_user, author_name, parts, created_at)
select (select id from ids where name = 'general'), '10000000-0000-0000-0000-000000000001', 'person',
       '00000000-0000-0000-0000-00000000000a', 'Ana', '[{"type": "text", "text": "hola"}]', at
from unnest(array['2026-11-24T22:30:00Z', '2026-11-24T23:30:00Z', '2026-11-25T10:00:00Z']::timestamptz[]) at;

select results_eq(
  $$ select day from public.general_digests_due('2026-11-20T00:00:00Z', '2026-11-25T23:00:00Z') $$,
  $$ values ('2026-11-24'::date), ('2026-11-25'::date) $$,
  'the days due are the Madrid days with messages in General');

insert into public.general_digests (org_id, day, summary, through_message)
values ('10000000-0000-0000-0000-000000000001', '2026-11-24', 'Ana saludó.', gen_random_uuid());
select results_eq(
  $$ select day from public.general_digests_due('2026-11-20T00:00:00Z', '2026-11-25T23:00:00Z') $$,
  $$ values ('2026-11-25'::date) $$,
  '... less the ones already summarised');
select is(
  (select count(*) from public.general_digests_due('2026-11-20T00:00:00Z', '2026-11-24T23:00:00Z')),
  0::bigint, '... and nothing from today, which starts at midnight in Madrid');

-- A member sees and does nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok($$ select * from public.general_digests $$, '42501', null, 'a member doesn''t read the summaries');
select throws_ok(
  $$ insert into public.general_digests (org_id, day, summary, through_message) values ('10000000-0000-0000-0000-000000000001', '2026-11-25', 'x', gen_random_uuid()) $$,
  '42501', null, '... nor writes one');
select throws_ok($$ select * from public.general_digests_due(now() - interval '7 days', now()) $$, '42501', null, '... nor asks which days are due');
reset role;

select is((select count(*) from public.general_digests), 1::bigint, 'the engine reads them');

select * from finish();
rollback;

-- Read ticks (20261128120000_read_ticks.sql): up to when everyone else who
-- reads a chat has read it, never who; nothing for someone outside it.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dani@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');
insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');
insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'member', 'Dani'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids select 'general', id from public.threads where org_id = '10000000-0000-0000-0000-000000000001' and kind = 'general';

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is(public.thread_read_by_all((select id from ids where name = 'general')), '-infinity'::timestamptz, 'nobody else has opened it: nothing read');

reset role;
insert into public.thread_reads (thread_id, user_id, org_id, read_at) values
  ((select id from ids where name = 'general'), '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', '2026-11-26T10:00:00Z');
set local role authenticated;
select is(public.thread_read_by_all((select id from ids where name = 'general')), '-infinity'::timestamptz, 'one of them read it: still not all');

reset role;
insert into public.thread_reads (thread_id, user_id, org_id, read_at) values
  ((select id from ids where name = 'general'), '00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000001', '2026-11-26T09:00:00Z');
set local role authenticated;
select is(public.thread_read_by_all((select id from ids where name = 'general')), '2026-11-26T09:00:00Z'::timestamptz, 'all of them: up to the earliest mark');
-- The caller's own mark doesn't count.
reset role;
insert into public.thread_reads (thread_id, user_id, org_id, read_at) values
  ((select id from ids where name = 'general'), '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '2026-11-26T08:00:00Z');
set local role authenticated;
select is(public.thread_read_by_all((select id from ids where name = 'general')), '2026-11-26T09:00:00Z'::timestamptz, '... never counting your own');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is(public.thread_read_by_all((select id from ids where name = 'general')), null, 'someone of another organisation learns nothing');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from public.thread_reads where user_id <> '00000000-0000-0000-0000-00000000000a'), 0::bigint, '... and the marks themselves stay private');

select * from finish();
rollback;

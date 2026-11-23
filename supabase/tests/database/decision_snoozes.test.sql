-- «Más tarde» (20261124600000_decision_snoozes.sql): a person puts a decision
-- aside for themselves only, within 30 days, and brings it back; nobody else
-- sees or touches it, and nothing crosses organisations.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');
insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'org-a', 'Org A'),
  ('10000000-0000-0000-0000-000000000002', 'org-b', 'Org B');
insert into public.memberships (org_id, user_id, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'Carla'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'Bea');
insert into public.decisions (id, org_id, record_id, source_path, area, kind, question, context, proposed_by, created_on) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'fin-a', 'por-decidir/fin-a.yaml', 'finanzas', 'precio', '¿A?', 'ctx', 'finanzas', '2026-11-17');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ select public.snooze_decision('20000000-0000-0000-0000-000000000001', now() + interval '1 day') $$,
  'Ana puts a decision aside until tomorrow');
select lives_ok(
  $$ select public.snooze_decision('20000000-0000-0000-0000-000000000001', now() + interval '2 days') $$,
  '... and again, moving it');
select is((select count(*) from public.decision_snoozes), 1::bigint, '... one row, hers');
select throws_ok(
  $$ select public.snooze_decision('20000000-0000-0000-0000-000000000001', now() - interval '1 hour') $$,
  '22023', null, 'not into the past');
select throws_ok(
  $$ select public.snooze_decision('20000000-0000-0000-0000-000000000001', now() + interval '31 days') $$,
  '22023', null, 'nor past 30 days');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.decision_snoozes), 0::bigint, 'a colleague does not see Ana''s');
select public.unsnooze_decision('20000000-0000-0000-0000-000000000001');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from public.decision_snoozes), 1::bigint, '... nor can bring it back for her');
select public.unsnooze_decision('20000000-0000-0000-0000-000000000001');
select is((select count(*) from public.decision_snoozes), 0::bigint, 'Ana brings it back');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ select public.snooze_decision('20000000-0000-0000-0000-000000000001', now() + interval '1 day') $$,
  'P0002', null, 'another organisation cannot touch it');

select * from finish();
rollback;

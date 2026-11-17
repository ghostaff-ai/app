-- An answer given in the app can be taken back until the agent has it, only by
-- whoever gave it, and never across organisations.
begin;
select plan(7);

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
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'fin-a', 'por-decidir/fin-a.yaml', 'finanzas', 'quien-pago', '¿A?', 'ctx', 'finanzas', '2026-11-17'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'fin-b', 'por-decidir/fin-b.yaml', 'finanzas', 'quien-pago', '¿B?', 'ctx', 'finanzas', '2026-11-17');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
do $$ begin
  perform public.answer_decision('20000000-0000-0000-0000-000000000001', 'ok');
  perform public.answer_decision('20000000-0000-0000-0000-000000000002', 'no');
end $$;

select is(
  (select answer from public.unanswer_decision('20000000-0000-0000-0000-000000000001')),
  null, 'Ana takes back her answer before the agent has it');
select ok(
  (select answer = 'ok' from public.answer_decision('20000000-0000-0000-0000-000000000001', 'ok')),
  '... and can answer it again');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select throws_ok(
  $$ select public.unanswer_decision('20000000-0000-0000-0000-000000000002') $$,
  '42501', 'only who answered can take it back', 'Carla cannot take back Ana''s answer');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ select public.unanswer_decision('20000000-0000-0000-0000-000000000002') $$,
  'P0002', 'decision not found', 'Bea, in another organisation, learns nothing');

reset role;
update public.decisions set written_back_at = now() where id = '20000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ select public.unanswer_decision('20000000-0000-0000-0000-000000000002') $$,
  '22023', 'the agent already has the answer', 'once written back, the answer stays');

set local role anon;
select throws_ok(
  $$ select public.unanswer_decision('20000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon cannot call it');

reset role;
select is(
  (select jsonb_typeof(sources) from public.decisions where id = '20000000-0000-0000-0000-000000000001'),
  'array', 'sources default to an empty list');

select * from finish();
rollback;

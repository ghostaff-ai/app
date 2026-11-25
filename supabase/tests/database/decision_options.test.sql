-- A decision with options is answered with one of them; ok means the agent's
-- pick, and an app from before options still answers. The agent that asked is a
-- row of the same organisation, readable with the decision.
begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');
insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'org-a', 'Org A'),
  ('10000000-0000-0000-0000-000000000002', 'org-b', 'Org B');
insert into public.memberships (org_id, user_id, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Ana'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'Bea');
insert into public.agents (id, org_id, name, ghost, department) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Redes', 'redes', 'marketing');
insert into public.decisions (id, org_id, record_id, source_path, area, kind, question, context, proposed_by, created_on, options, recommended_option, high_stakes, agent_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'redes-a', 'por-decidir/redes-a.yaml', 'redes', 'cuando-publicar', '¿Cuándo?', 'ctx', 'redes', '2026-11-25',
   '[{"id":"lunes","text":"El lunes"},{"id":"viernes","text":"El viernes"},{"id":"nada","text":"No publicarlo"}]', 'lunes', true, '30000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'redes-b', 'por-decidir/redes-b.yaml', 'redes', 'cuando-publicar', '¿Cuándo?', 'ctx', 'redes', '2026-11-25',
   '[{"id":"lunes","text":"El lunes"},{"id":"viernes","text":"El viernes"}]', 'lunes', false, null),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'redes-c', 'por-decidir/redes-c.yaml', 'redes', 'titulo', '¿Sí?', 'ctx', 'redes', '2026-11-25',
   '[]', null, false, null);

select throws_ok(
  $$ insert into public.decisions (org_id, record_id, source_path, area, kind, question, context, proposed_by, created_on, options)
     values ('10000000-0000-0000-0000-000000000001', 'redes-x', 'por-decidir/redes-x.yaml', 'redes', 't', '¿?', 'c', 'redes', '2026-11-25', '[{"id":"a","text":"A"},{"id":"b","text":"B"}]') $$,
  '23514', null, 'options need a pick');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

select is(
  (select array[answer, answer_option] from public.answer_decision('20000000-0000-0000-0000-000000000001', option_id => 'viernes')),
  array['no', 'viernes'], 'another option than the pick is a no, with the option');
select is(
  (select answer_option from public.unanswer_decision('20000000-0000-0000-0000-000000000001')),
  null, 'taking it back takes back the option');
select is(
  (select array[answer, answer_option] from public.answer_decision('20000000-0000-0000-0000-000000000001', option_id => 'lunes')),
  array['ok', 'lunes'], 'the pick is an ok');
select is(
  (select array[answer, answer_option] from public.answer_decision('20000000-0000-0000-0000-000000000002', 'ok')),
  array['ok', 'lunes'], 'an app from before options: ok takes the pick');
select throws_ok(
  $$ select public.answer_decision('20000000-0000-0000-0000-000000000003', option_id => 'lunes') $$,
  '22023', 'not one of the options', 'a yes-or-no decision has no options to pick');
select throws_ok(
  $$ select public.answer_decision('20000000-0000-0000-0000-000000000003', 'no', option_id => 'x') $$,
  '22023', 'not one of the options', 'an unknown option is refused');
select is(
  (select a.name from public.decisions d join public.agents a on a.id = d.agent_id where d.id = '20000000-0000-0000-0000-000000000001'),
  'Redes', 'a member reads the agent that asked');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ select public.answer_decision('20000000-0000-0000-0000-000000000003', option_id => 'lunes') $$,
  'P0002', 'decision not found', 'another organisation learns nothing, options or not');

set local role anon;
select throws_ok(
  $$ select public.answer_decision('20000000-0000-0000-0000-000000000003', 'ok') $$,
  '42501', null, 'anon cannot call it');

select * from finish();
rollback;

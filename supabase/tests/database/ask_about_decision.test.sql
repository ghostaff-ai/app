-- «Preguntar»: a member writes to the agent that asked, in their own chat, with
-- the decision quoted; never across organisations, never without an agent.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');
insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'org-a', 'Org A'),
  ('10000000-0000-0000-0000-000000000002', 'org-b', 'Org B');
insert into public.memberships (org_id, user_id, display_name, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Ana', 'owner'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'Bea', 'owner');
insert into public.agents (id, org_id, name, ghost, department) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Redes', 'redes', 'marketing');
insert into public.decisions (id, org_id, record_id, source_path, area, kind, question, context, proposed_by, created_on, agent_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'redes-a', 'por-decidir/redes-a.yaml', 'redes', 't', '¿Publico?', 'c', 'redes', '2026-11-25', '30000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'nadie-b', 'por-decidir/nadie-b.yaml', 'redes', 't', '¿Y esto?', 'c', 'nadie', '2026-11-25', null);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

select is(
  (select parts->0->>'type' from public.ask_about_decision('20000000-0000-0000-0000-000000000001', '¿Por qué el lunes?')),
  'decision_quote', 'the message quotes the decision first');
select is(
  (select count(*)::int from public.threads where agent_id = '30000000-0000-0000-0000-000000000001' and personal_of = '00000000-0000-0000-0000-00000000000a'),
  1, '... in Ana''s own chat with the agent');
select is(
  (select thread_id from public.ask_about_decision('20000000-0000-0000-0000-000000000001', 'Otra cosa')),
  (select id from public.threads where agent_id = '30000000-0000-0000-0000-000000000001' and personal_of = '00000000-0000-0000-0000-00000000000a'),
  'asking again writes in the same chat');
select throws_ok(
  $$ select public.ask_about_decision('20000000-0000-0000-0000-000000000002', 'Hola') $$,
  '22023', 'no agent to ask about this decision', 'a decision without an agent cannot be asked about');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ select public.ask_about_decision('20000000-0000-0000-0000-000000000001', 'Hola') $$,
  'P0002', 'decision not found', 'another organisation learns nothing');

set local role anon;
select throws_ok(
  $$ select public.ask_about_decision('20000000-0000-0000-0000-000000000001', 'Hola') $$,
  '42501', null, 'anon cannot call it');

select * from finish();
rollback;

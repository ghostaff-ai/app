-- What an agent remembers of a long conversation (docs/plans/ongoing/agent-context.md):
-- its summary is the engine's alone, since it can carry what the agent read with
-- its tools, and so is the search over the conversation's older messages.
begin;
select plan(18);

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
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas');
insert into public.threads (id, org_id, agent_id, title, created_by) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Finanzas', '00000000-0000-0000-0000-00000000000a');
insert into public.messages (id, thread_id, org_id, author_kind, author_user, author_name, parts, created_at) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'person',
   '00000000-0000-0000-0000-00000000000a', 'Ana', '[{"type": "text", "text": "La reunión con el banco es el martes"}]', '2026-11-02 10:00+01'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'person',
   '00000000-0000-0000-0000-00000000000a', 'Ana', '[{"type": "text", "text": "Cambia el IVA del 50%_ de las facturas"}]', '2026-11-20 10:00+01'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'person',
   '00000000-0000-0000-0000-00000000000a', 'Ana', '[{"type": "text", "text": "Otra cosa del banco"}, {"type": "decision_quote", "decisionId": "x", "question": "reunion"}]', '2026-11-25 10:00+01');
insert into public.conversation_summaries (thread_id, agent_id, org_id, summary, through_at, through_message) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Ana quiere ver al banco.', '2026-11-02 10:00+01', '50000000-0000-0000-0000-000000000001');

-- The engine's search: every word, ignoring case and accents, in a date range, newest first.
select results_eq(
  $$ select id from public.search_thread_messages('40000000-0000-0000-0000-000000000001', array['REUNION', 'banco'], null, null, 10) $$,
  $$ values ('50000000-0000-0000-0000-000000000001'::uuid) $$,
  'every word must be in the text, accents and case aside (a quoted decision is not text)');
select results_eq(
  $$ select id from public.search_thread_messages('40000000-0000-0000-0000-000000000001', array['banco'], null, null, 10) $$,
  $$ values ('50000000-0000-0000-0000-000000000003'::uuid), ('50000000-0000-0000-0000-000000000001'::uuid) $$,
  'newest first');
select results_eq(
  $$ select id from public.search_thread_messages('40000000-0000-0000-0000-000000000001', null, '2026-11-10', '2026-11-21', 10) $$,
  $$ values ('50000000-0000-0000-0000-000000000002'::uuid) $$,
  'no words: what was said between two dates');
select results_eq(
  $$ select id from public.search_thread_messages('40000000-0000-0000-0000-000000000001', array['50%_'], null, null, 10) $$,
  $$ values ('50000000-0000-0000-0000-000000000002'::uuid) $$,
  '% and _ are plain characters');
select is(
  (select body from public.search_thread_messages('40000000-0000-0000-0000-000000000001', array['otra'], null, null, 10)),
  'Otra cosa del banco', 'returns the text of the message');
select is(
  (select count(*)::int from public.search_thread_messages('40000000-0000-0000-0000-000000000001', array['banco'], null, null, 1)),
  1, 'at most max_rows');

-- The engine keeps a summary only when it reaches further, and only for an agent of the thread's organisation.
select is(public.save_conversation_summary('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Más nuevo', '2026-11-20 10:00+01', '50000000-0000-0000-0000-000000000002'),
  true, 'a summary that reaches further replaces the stored one');
select is((select summary from public.conversation_summaries), 'Más nuevo', '... and is the one stored');
select is(public.save_conversation_summary('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Viejo', '2026-11-02 10:00+01', '50000000-0000-0000-0000-000000000001'),
  false, 'an older one is not kept');
select is((select summary from public.conversation_summaries), 'Más nuevo', '... and the stored one stays');
insert into public.agents (id, org_id, name, ghost, department) values
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Otra', 'finanzas', 'finanzas');
select is(public.save_conversation_summary('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'x', now(), gen_random_uuid()),
  false, 'never for an agent of another organisation');

-- Ana, owner of the organisation, sees no summary and cannot write one or search.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ select count(*) from public.conversation_summaries $$,
  '42501', null, 'a member of the organisation cannot read the summaries');
select throws_ok(
  $$ update public.conversation_summaries set summary = 'x' $$,
  '42501', null, '... nor change one');
select throws_ok(
  $$ select * from public.search_thread_messages('40000000-0000-0000-0000-000000000001', array['banco'], null, null, 10) $$,
  '42501', null, '... nor search');
select throws_ok(
  $$ select public.save_conversation_summary('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'z', now(), gen_random_uuid()) $$,
  '42501', null, '... nor save one through the engine''s function');

-- Bea, of another organisation, neither.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ insert into public.conversation_summaries (thread_id, agent_id, org_id, summary, through_at, through_message)
     values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'y', now(), gen_random_uuid()) $$,
  '42501', null, 'another organisation''s member cannot write one');
select throws_ok(
  $$ select * from public.search_thread_messages('40000000-0000-0000-0000-000000000001', array['banco'], null, null, 10) $$,
  '42501', null, '... nor search');

set local role anon;
select throws_ok(
  $$ select count(*) from public.conversation_summaries $$,
  '42501', null, 'anon neither');

select * from finish();
rollback;

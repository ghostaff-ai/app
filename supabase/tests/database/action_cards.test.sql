-- The OK cards in Decisiones (20261126630000_action_cards.sql): a person lists
-- the pending actions they would approve, in conversations they see, once the
-- agent has finished writing; puts one aside for themselves only; and the daily
-- push leaves an aside card out. Nothing crosses organisations.
begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');
insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');
insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');
insert into public.agents (id, org_id, name, ghost, department) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Redes', 'redes', 'marketing');
-- A shared conversation, and Bea's own chat with Redes, which Ana does not see.
insert into public.threads (id, org_id, agent_id, title, visibility) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Reel', 'write');
insert into public.threads (id, org_id, agent_id, title, visibility, personal_of) values
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Bea', 'private', '00000000-0000-0000-0000-00000000000b');
insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts, state) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', 'Redes',
   '[{"type": "action", "actionId": "50000000-0000-0000-0000-000000000001", "label": "Publicar", "preview": "texto: Hola", "status": "pending"}]', 'done'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', 'Redes', '[]', 'working'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', 'Redes', '[]', 'done');
insert into public.agent_actions (id, org_id, thread_id, message_id, agent_id, tool, input, label, decider, requested_by) values
  -- An owner's, shared and finished: Ana's card.
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'instagram_publish', '{}', 'Publicar en Instagram', 'owner', '00000000-0000-0000-0000-00000000000a'),
  -- Still being written: nobody's card yet.
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'instagram_publish', '{}', 'A medias', 'owner', '00000000-0000-0000-0000-00000000000a'),
  -- Bea's own routine, in her own chat: hers, and Ana never sees it.
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
   '40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'send_mail', '{}', 'Enviar el resumen', 'requester', '00000000-0000-0000-0000-00000000000b');
insert into public.agent_actions (id, org_id, thread_id, message_id, agent_id, tool, input, label, decider, requested_by, status) values
  ('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'instagram_publish', '{}', 'Ya hecho', 'owner', '00000000-0000-0000-0000-00000000000a', 'done');
insert into public.device_tokens (user_id, token, platform, bundle_id, time_zone) values
  ('00000000-0000-0000-0000-00000000000a', 'tok-ana', 'android', 'ai.ghostaff.app.dev', 'Europe/Madrid');

select results_eq(
  $$ select waiting from public.daily_push_candidates() where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  $$ values (2) $$, 'the daily push counts both of Ana''s owner cards (the one being written too)');

set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select results_eq(
  $$ select id, agent_name, label, preview from public.my_pending_actions('10000000-0000-0000-0000-000000000001') $$,
  $$ values ('50000000-0000-0000-0000-000000000001'::uuid, 'Redes', 'Publicar en Instagram', 'texto: Hola') $$,
  'an owner lists the pending card of a finished message, with its preview; not one being written, decided, or in a chat she does not see');
select lives_ok(
  $$ select public.snooze_action('50000000-0000-0000-0000-000000000001', now() + interval '1 day') $$,
  'she puts it aside until tomorrow');
select lives_ok(
  $$ select public.snooze_action('50000000-0000-0000-0000-000000000001', now() + interval '2 days') $$,
  '... and again, moving it');
select is((select count(*) from public.action_snoozes), 1::bigint, '... one row, hers');
select throws_ok(
  $$ select public.snooze_action('50000000-0000-0000-0000-000000000001', now() - interval '1 hour') $$,
  '22023', null, 'not into the past');
select throws_ok(
  $$ select public.snooze_action('50000000-0000-0000-0000-000000000003', now() + interval '1 day') $$,
  'P0002', null, 'not an action in a chat she does not see');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq(
  $$ select id from public.my_pending_actions('10000000-0000-0000-0000-000000000001') $$,
  $$ values ('50000000-0000-0000-0000-000000000003'::uuid) $$,
  'a member lists only the card of her own routine, not an owner''s');
select is((select count(*) from public.action_snoozes), 0::bigint, 'she does not see Ana''s snooze');
select public.unsnooze_action('50000000-0000-0000-0000-000000000001');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.my_pending_actions('10000000-0000-0000-0000-000000000001')), 0::bigint, 'another organisation lists none');
select throws_ok(
  $$ select public.snooze_action('50000000-0000-0000-0000-000000000001', now() + interval '1 day') $$,
  'P0002', null, '... nor puts one aside');

reset role;
select results_eq(
  $$ select waiting from public.daily_push_candidates() where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  $$ values (1) $$, 'the daily push leaves out the card Ana put aside (a colleague could not bring it back)');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select public.unsnooze_action('50000000-0000-0000-0000-000000000001');
select is((select count(*) from public.action_snoozes), 0::bigint, 'Ana brings it back');
select throws_ok($$ insert into public.action_snoozes (action_id, user_id, org_id, until)
  values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', now() + interval '1 day') $$,
  '42501', null, 'snoozes are written only through snooze_action');

select * from finish();
rollback;

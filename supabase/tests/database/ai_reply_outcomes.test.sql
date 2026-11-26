-- Model routing, phase 0 (20261126950000_model_routing_phase0.sql): what became
-- of each reply an agent wrote, read as the caller. A decided card wins; else
-- the next person's message; else nothing. A member reads only replies in
-- conversations they see, and nothing crosses organisations.
begin;
select plan(9);

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
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Redes', 'redes', 'marketing'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Taller', 'finanzas', 'finanzas');
-- A shared conversation, Bea's own chat (Ana does not see it), and one in the other organisation.
insert into public.threads (id, org_id, agent_id, title, visibility) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Reel', 'write'),
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Facturas', 'write');
insert into public.threads (id, org_id, agent_id, title, visibility, personal_of) values
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Bea', 'private', '00000000-0000-0000-0000-00000000000b');

insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_user, author_name, parts, created_at) values
  -- Four replies in the shared conversation, an hour apart...
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', null, 'Redes', '[]', now() - interval '5 hours'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', null, 'Redes', '[]', now() - interval '4 hours'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', null, 'Redes', '[]', now() - interval '3 hours'),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', null, 'Redes', '[]', now() - interval '2 hours'),
  -- ... and Ana's message five minutes after the last.
  ('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'person',
   null, '00000000-0000-0000-0000-00000000000a', 'Ana', '[]', now() - interval '115 minutes'),
  -- A reply in Bea's own chat, which nobody has answered.
  ('40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', null, 'Redes', '[]', now() - interval '1 hour'),
  ('40000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'agent',
   '20000000-0000-0000-0000-000000000002', null, 'Taller', '[]', now() - interval '1 hour');

-- Cards: approved as drafted, approved after «Editar», rejected.
insert into public.agent_actions (org_id, thread_id, message_id, agent_id, tool, input, drafted_input, label, status) values
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 'instagram_publish', '{"caption": "Hola"}', null, 'Publicar', 'done'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000001', 'instagram_publish', '{"caption": "Hola a todos"}', '{"caption": "Hola"}', 'Publicar', 'done'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003',
   '20000000-0000-0000-0000-000000000001', 'instagram_publish', '{"caption": "Hola"}', null, 'Publicar', 'rejected');

-- What the engine writes, as the service role: a row per reply when it finished, and a failure.
insert into public.connections (id, org_id, kind, provider, method, hint, connected_by_name) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'ai', 'anthropic', 'api_key', 'aaaa', 'Ana'),
  ('50000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'ai', 'anthropic', 'api_key', 'zzzz', 'Carla');
insert into public.ai_usage (org_id, connection_id, agent_id, source, outcome, model, effort, message_id, input_tokens, cache_read_tokens, cost_usd, at)
select '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
       'chat', 'ok', 'claude-opus-5-5', 'low', m.id, 100, 9000, 0.01, m.created_at + interval '10 seconds'
from public.messages m where m.author_kind = 'agent' and m.org_id = '10000000-0000-0000-0000-000000000001';
insert into public.ai_usage (org_id, connection_id, source, outcome, message_id, at) values
  ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'chat', 'failed', '40000000-0000-0000-0000-000000000004', now() - interval '2 hours'),
  ('10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000009', 'chat', 'ok', '40000000-0000-0000-0000-000000000009', now() - interval '1 hour');

select throws_ok(
  $$ insert into public.ai_usage (org_id, connection_id, source, outcome, effort)
     values ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'chat', 'ok', 'turbo') $$,
  '23514', null, 'an effort the API does not have is refused');
select throws_ok(
  $$ insert into public.ai_usage (org_id, connection_id, source, outcome, tier)
     values ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'chat', 'ok', 'opus') $$,
  '23514', null, '... and so is a tier that is a model''s name');

set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select results_eq(
  $$ select message_id, outcome, next_message_id, seconds_to_next
     from public.ai_reply_outcomes('10000000-0000-0000-0000-000000000001', current_date - 30) order by at $$,
  $$ values
     ('40000000-0000-0000-0000-000000000001'::uuid, 'accepted', null::uuid, null::integer),
     ('40000000-0000-0000-0000-000000000002'::uuid, 'edited', null::uuid, null::integer),
     ('40000000-0000-0000-0000-000000000003'::uuid, 'rejected', null::uuid, null::integer),
     ('40000000-0000-0000-0000-000000000004'::uuid, 'followed_up', '40000000-0000-0000-0000-000000000005'::uuid, 290) $$,
  'an owner reads each answered reply in a conversation she sees: a decided card wins, else the next person''s message, after how long; not the failure, not Bea''s own chat');
select is(
  (select sum(cache_read_tokens) from public.ai_reply_outcomes('10000000-0000-0000-0000-000000000001', current_date - 30)),
  36000::numeric, '... with each reply''s cached tokens');
select is(
  (select count(*) from public.ai_reply_outcomes('10000000-0000-0000-0000-000000000001', current_date - 30)
   where message_id = '40000000-0000-0000-0000-000000000006'),
  0::bigint, '... and nothing of a chat she does not see');
select is(
  (select count(*) from public.ai_reply_outcomes('10000000-0000-0000-0000-000000000002', current_date - 30)),
  0::bigint, '... nor of another organisation, asking for it by id');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq(
  $$ select outcome from public.ai_reply_outcomes('10000000-0000-0000-0000-000000000001', current_date - 30)
     where message_id = '40000000-0000-0000-0000-000000000006' $$,
  $$ values ('none') $$,
  'Bea reads the reply in her own chat, which nobody answered yet');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is(
  (select count(*) from public.ai_reply_outcomes('10000000-0000-0000-0000-000000000001', current_date - 30)),
  0::bigint, 'another organisation''s owner reads none of the bakery''s');
select is(
  (select count(*) from public.ai_reply_outcomes('10000000-0000-0000-0000-000000000002', current_date - 30)),
  1::bigint, '... and her own reply');

select * from finish();
rollback;

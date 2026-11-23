-- An agent's proposed actions: seen only in the threads a person may see, in
-- their own organisation, and written by nobody but the engine (invariant 1,
-- and apps/engine/src/actions.ts: an action runs from this table, never from
-- a message the app could have changed).
begin;
select plan(7);

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

-- What the engine writes, as the service role: Redes, one thread, its reply proposing a post.
insert into public.agents (id, org_id, name, ghost, department) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Redes', 'redes', 'marketing');
insert into public.agent_access (agent_id, user_id, org_id, level) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'none');
insert into public.threads (id, org_id, agent_id, title, visibility) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Reel', 'write');
insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', 'Redes', '[]');
insert into public.agent_actions (org_id, thread_id, message_id, agent_id, tool, input, label, requested_by) values
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 'instagram_publish', '{"kind": "reel"}', 'Publicar en Instagram', '00000000-0000-0000-0000-00000000000a');

select throws_ok(
  $$ insert into public.agent_actions (org_id, thread_id, message_id, tool, input, label)
     values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
             'publish now; drop', '{}', 'x') $$,
  '23514', null, 'a tool name is a plain name');

set local role authenticated;

-- Ana, owner: sees the action in her thread, but cannot approve it by writing the table.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select label from public.agent_actions), 'Publicar en Instagram', 'the owner sees the proposed action');
select throws_ok($$ update public.agent_actions set status = 'done' $$, '42501', null, '... and cannot mark it done from the app');
select throws_ok(
  $$ update public.agent_actions set input = '{"kind": "carousel"}' $$,
  '42501', null, '... nor change what it will do');

-- Bea, a member set to «none» on Redes: sees nothing of its threads.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.agent_actions), 0::bigint, 'a member who may not see the agent sees none of its actions');

-- Carla, another organisation's owner.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.agent_actions), 0::bigint, 'another organisation sees none');

reset role;
select is((select status from public.agent_actions where org_id = '10000000-0000-0000-0000-000000000001'), 'pending', 'still pending');

select * from finish();
rollback;

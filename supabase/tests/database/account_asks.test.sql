-- An agent's asks for an account (connector-in-chat.md): the engine alone
-- reads and writes them. Nobody in the app, not even an owner of the same
-- organisation, can see one or mark it done, which would let the agent go on.
begin;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

-- What the engine writes, as the service role: Redes asks for Notion in its reply.
insert into public.agents (id, org_id, name, ghost, department) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Redes', 'redes', 'marketing');
insert into public.threads (id, org_id, agent_id, title, visibility) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Notas', 'write');
insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', 'Redes', '[]');
insert into public.account_asks (org_id, thread_id, message_id, agent_id, connector, name, need, requested_by) values
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 'notion', 'Notion', 'connect', '00000000-0000-0000-0000-00000000000a');

select throws_ok(
  $$ insert into public.account_asks (org_id, thread_id, message_id, agent_id, connector, name, need)
     values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
             '20000000-0000-0000-0000-000000000001', null, 'Notion', 'connect') $$,
  '23514', null, 'an app to connect names its connector');
select throws_ok(
  $$ insert into public.account_asks (org_id, thread_id, message_id, agent_id, connector, name, need)
     values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
             '20000000-0000-0000-0000-000000000001', 'Notion; drop', 'Notion', 'connect') $$,
  '23514', null, 'a connector is a plain id');

set local role authenticated;

-- Ana, owner of the organisation: neither sees the ask nor can settle it.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok($$ select count(*) from public.account_asks $$, '42501', null, 'an owner cannot read the asks from the app');
select throws_ok($$ update public.account_asks set status = 'done' $$, '42501', null, '... nor mark one done');
select throws_ok(
  $$ insert into public.account_asks (org_id, thread_id, message_id, agent_id, connector, name, need)
     values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
             '20000000-0000-0000-0000-000000000001', 'notion', 'Notion', 'connect') $$,
  '42501', null, '... nor write one');

-- Carla, another organisation's owner.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select throws_ok($$ select count(*) from public.account_asks $$, '42501', null, 'another organisation cannot read them either');

reset role;
select is((select status from public.account_asks), 'open', 'the ask is still open');

select * from finish();
rollback;

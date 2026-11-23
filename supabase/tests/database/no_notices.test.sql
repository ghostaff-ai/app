-- No «Avisos» (20261123300000_no_notices.sql): what an agent does on its own
-- lands in the private chat of every member who may see it, each their own;
-- not in the chat of a member with no access, nor across organisations; and
-- only the engine posts it.
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dani@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'member', 'Dani'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

-- Finanzas: members may read it by default; Dani may not see it at all.
insert into public.agents (id, org_id, name, ghost, department, member_default) values
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'read');
insert into public.agent_access (agent_id, user_id, org_id, level) values
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000001', 'none');

-- The engine reports twice.
set local role service_role;
select is(public.post_to_personal_chats('20000000-0000-0000-0000-000000000002', 'Cierre de mes listo'), 2, 'it reaches the owner and the member who may see the agent');
select is(public.post_to_personal_chats('20000000-0000-0000-0000-000000000002', 'Factura nueva'), 2, '... again');
select is(
  (select count(*) from public.threads where agent_id = '20000000-0000-0000-0000-000000000002'), 2::bigint,
  'one chat each, opened the first time');
select throws_ok(
  $$ select public.post_to_personal_chats('20000000-0000-0000-0000-000000000002', '  ') $$,
  '22023', null, 'an empty message is refused');

reset role;
set local role authenticated;

-- Bea: her own chat, with both, unread.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq(
  $$ select personal, last_author, last_text, unread from public.my_threads('10000000-0000-0000-0000-000000000001') $$,
  $$ values (true, 'Finanzas'::text, 'Factura nueva'::text, true) $$,
  'Bea finds it in her chat, unread');
select is((select count(*) from public.messages), 2::bigint, '... both messages, and nobody else''s');
select throws_ok(
  $$ select public.post_to_personal_chats('20000000-0000-0000-0000-000000000002', 'Hola') $$,
  '42501', null, 'a person cannot post as the agent');

-- Ana, the owner: her own copy.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from public.my_threads('10000000-0000-0000-0000-000000000001') where personal), 1::bigint, 'the owner has hers');
select is((select count(*) from public.messages), 2::bigint, '... and sees only her own copy');

-- Dani may not see Finanzas: nothing.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select is((select count(*) from public.threads) + (select count(*) from public.messages), 0::bigint, 'a member with no access gets nothing');

-- Carla, another organisation: nothing.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.threads) + (select count(*) from public.messages), 0::bigint, 'another organisation gets nothing');

select * from finish();
rollback;

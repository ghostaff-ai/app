-- Only an organisation's owners choose which connected accounts each of its
-- agents may use, through set_agent_accounts (invariant 1).
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
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Finanzas', 'finanzas', 'finanzas');

select is((select accounts from public.agents where id = '20000000-0000-0000-0000-000000000001'), null::text[], 'a new agent uses every connected account');

set local role authenticated;

-- Ana, owner of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ select public.set_agent_accounts('20000000-0000-0000-0000-000000000001', array['instagram', 'google', 'instagram']) $$,
  'an owner chooses an agent''s accounts');
select is((select accounts from public.agents where id = '20000000-0000-0000-0000-000000000001'), array['google', 'instagram'], '... kept once each, in order');
select lives_ok(
  $$ select public.set_agent_accounts('20000000-0000-0000-0000-000000000001', null) $$,
  '... and gives it every account again');
select is((select accounts from public.agents where id = '20000000-0000-0000-0000-000000000001'), null::text[], '... which is null');
select throws_ok(
  $$ select public.set_agent_accounts('20000000-0000-0000-0000-000000000001', array['Not a provider!']) $$,
  '22023', null, 'only provider names');
select throws_ok(
  $$ select public.set_agent_accounts('20000000-0000-0000-0000-000000000002', array['google']) $$,
  '42501', null, 'an owner cannot touch another organisation''s agent');

-- Bea, a member of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ select public.set_agent_accounts('20000000-0000-0000-0000-000000000001', array['google']) $$,
  '42501', null, 'a member cannot choose an agent''s accounts');
select throws_ok(
  $$ update public.agents set accounts = array['google'] $$,
  '42501', null, 'nobody writes the table directly');

select * from finish();
rollback;

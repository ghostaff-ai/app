-- Each agent's photo (20261128980000_agent_photos.sql, docs/plans/ongoing/agent-photo.md): whoever
-- may see the agent reads it, nobody else does, another organisation never does, and only the
-- engine writes it.
begin;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'beto@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');
insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');
insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Beto'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');
insert into public.agents (id, org_id, name, ghost, department) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Cuentas', 'finanzas', 'finanzas'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Legal', 'base', 'legal'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Redes', 'redes', 'marketing'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Comercial', 'base', 'marketing');
-- Beto doesn't see Legal.
insert into public.agent_access (org_id, agent_id, user_id, level) values
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'none');

insert into public.agent_photos (agent_id, org_id, blocks, sha) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '[{"kind":"figure","title":"Saldo","value":1}]', 'a1'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '[]', 'a2'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '[]', 'a3');

select throws_ok(
  $$ insert into public.agent_photos (agent_id, org_id, sha) values ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'x') $$,
  '23503', null, 'a photo is always in its agent''s organisation');
select throws_ok(
  $$ update public.agent_photos set blocks = (select jsonb_agg(x) from generate_series(1, 13) x) where agent_id = '30000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'at most twelve blocks');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is(
  (select array_agg(agent_id::text) from public.agent_photos),
  array['30000000-0000-0000-0000-000000000001'],
  'a member reads the photo of each agent they may see, not of one they may not, nor another organisation''s');
select throws_ok(
  $$ update public.agent_photos set sha = 'x' $$,
  '42501', null, '... and changes none');
select throws_ok(
  $$ insert into public.agent_photos (agent_id, org_id, sha) values ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'x') $$,
  '42501', null, '... nor writes one');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*)::int from public.agent_photos), 2, 'an owner reads every agent''s photo of her organisation');
select throws_ok($$ delete from public.agent_photos $$, '42501', null, '... and deletes none');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is(
  (select array_agg(agent_id::text) from public.agent_photos),
  array['30000000-0000-0000-0000-000000000003'],
  'another organisation''s owner reads only her own');

select * from finish();
rollback;

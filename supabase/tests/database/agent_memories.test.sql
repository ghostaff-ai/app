-- Each agent's own memory (20261128600000_agent_memories.sql, docs/plans/ongoing/agent-context.md PR 2):
-- every agent has a slug, its store's folder in the record; whoever may see the agent reads its
-- store, nobody else does, and nobody but the engine writes it or searches it.
begin;
select plan(18);

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

-- The slug: from the name, accents and spaces aside, unique in the organisation, kept when given.
insert into public.agents (id, org_id, name, ghost, department) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Atención al Cliente', 'finanzas', 'finanzas'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Atención al cliente', 'finanzas', 'finanzas'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '2º Finanzas', 'finanzas', 'finanzas'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Atención al cliente', 'finanzas', 'finanzas');
insert into public.agents (id, org_id, name, ghost, department, slug) values
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Legal', 'finanzas', 'finanzas', 'abogado');

select is((select slug from public.agents where id = '30000000-0000-0000-0000-000000000001'), 'atencion-al-cliente', 'a new agent gets its slug from its name');
select is((select slug from public.agents where id = '30000000-0000-0000-0000-000000000002'), 'atencion-al-cliente-2', 'a taken slug gets a suffix');
select is((select slug from public.agents where id = '30000000-0000-0000-0000-000000000003'), 'agente-2-finanzas', 'a slug always starts with a letter');
select is((select slug from public.agents where id = '30000000-0000-0000-0000-000000000004'), 'atencion-al-cliente', 'unique in its organisation only');
select is((select slug from public.agents where id = '30000000-0000-0000-0000-000000000005'), 'abogado', 'a slug given is kept');
select is(public.agent_slug_for('10000000-0000-0000-0000-000000000001', repeat('muy largo ', 10)), 'muy-largo-muy-largo-muy-largo-muy-largo-m', 'never longer than a slug may be');

-- Only Ana and Beto see Atención al cliente; Beto doesn't see Legal.
insert into public.agent_access (org_id, agent_id, user_id, level) values
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000b', 'none');

insert into public.memories (org_id, store, agent_id, path, content, sha, updated_by) values
  ('10000000-0000-0000-0000-000000000001', 'agente', '30000000-0000-0000-0000-000000000001', 'como-trabajo.md', 'Ana quiere las respuestas en tres líneas.', 'b1', 'Atención al cliente (por Ana)'),
  ('10000000-0000-0000-0000-000000000001', 'agente', '30000000-0000-0000-0000-000000000002', 'como-trabajo.md', 'Otro agente, el mismo fichero.', 'b2', null),
  ('10000000-0000-0000-0000-000000000001', 'agente', '30000000-0000-0000-0000-000000000005', 'contratos.md', 'Revisar cláusulas de permanencia.', 'b3', null),
  ('10000000-0000-0000-0000-000000000001', 'empresa', null, 'como-trabajo.md', 'La empresa también puede tenerlo.', 'b4', null);

select throws_ok(
  $$ insert into public.memories (org_id, store, path, content, sha) values ('10000000-0000-0000-0000-000000000001', 'agente', 'x.md', 'x', 's') $$,
  '23514', null, 'an agent''s store names its agent');
select throws_ok(
  $$ insert into public.memories (org_id, store, agent_id, path, content, sha) values ('10000000-0000-0000-0000-000000000001', 'empresa', '30000000-0000-0000-0000-000000000001', 'y.md', 'x', 's') $$,
  '23514', null, '... and Empresa names none');
select throws_ok(
  $$ insert into public.memories (org_id, store, agent_id, path, content, sha) values ('10000000-0000-0000-0000-000000000002', 'agente', '30000000-0000-0000-0000-000000000001', 'z.md', 'x', 's') $$,
  '23503', null, 'an agent''s store is in its own organisation');
select throws_ok(
  $$ insert into public.memories (org_id, store, agent_id, path, content, sha) values ('10000000-0000-0000-0000-000000000001', 'empresa', null, 'como-trabajo.md', 'x', 's') $$,
  '23505', null, 'one file per path in each store, Empresa too');

insert into public.memories (org_id, store, agent_id, path, content, sha) values ('10000000-0000-0000-0000-000000000001', 'empresa', null, 'como-trabajo.md', 'Cambiado.', 'b5')
  on conflict (org_id, store, agent_id, path) do update set content = excluded.content;
select is((select content from public.memories where store = 'empresa' and path = 'como-trabajo.md'), 'Cambiado.', 'the engine''s upsert finds Empresa''s file by its key');

select is(
  (select array_agg(path) from public.search_agent_memories('30000000-0000-0000-0000-000000000001', array['TRES', 'líneas'])),
  array['como-trabajo.md'], 'the engine searches one agent''s store, every word, in any case');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is(
  (select array_agg(agent_id::text order by agent_id) from public.memories where store = 'agente'),
  array['30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'],
  'a member reads the store of each agent they may see, not of one they may not');
select throws_ok(
  $$ update public.memories set content = 'x' where store = 'agente' $$,
  '42501', null, '... and changes none');
select throws_ok(
  $$ select * from public.search_agent_memories('30000000-0000-0000-0000-000000000001', array['tres']) $$,
  '42501', null, '... nor searches');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*)::int from public.memories where store = 'agente'), 3, 'an owner reads every agent''s store');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*)::int from public.memories), 0, 'another organisation''s member reads nothing');

set local role anon;
select throws_ok($$ select count(*) from public.memories $$, '42501', null, 'anon neither');

select * from finish();
rollback;

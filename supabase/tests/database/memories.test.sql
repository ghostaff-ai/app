-- The organisation's memory (20261127900000_memories.sql): every member reads it, another
-- organisation's member doesn't, nobody but the engine writes it or searches it.
begin;
select plan(10);

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

insert into public.memories (org_id, store, path, content, sha, updated_by) values
  ('10000000-0000-0000-0000-000000000001', 'empresa', 'proveedores/gestoria.md', 'Trabajamos con la Gestoría López desde 2024.', 'a1', 'Secretaría (por Ana)'),
  ('10000000-0000-0000-0000-000000000001', 'empresa', 'facturas/2026-10-acme.md', 'Factura de Acme, octubre: 1.200 €.', 'a2', 'Secretaría (por Beto)');

select throws_ok(
  $$ insert into public.memories (org_id, store, path, content, sha) values ('10000000-0000-0000-0000-000000000001', 'empresa', '../fuera.md', 'x', 's') $$,
  '23514', null, 'a path never leaves the store');

select throws_ok(
  $$ insert into public.memories (org_id, store, path, content, sha) values ('10000000-0000-0000-0000-000000000001', 'empresa', 'a.md', repeat('x', 10241), 's') $$,
  '23514', null, 'a file holds 10 kB at most');

select is(
  (select array_agg(path order by path) from public.search_memories('10000000-0000-0000-0000-000000000001', 'empresa', array['GESTORÍA', 'lópez'])),
  array['proveedores/gestoria.md'], 'the search finds the files holding every word, in any case');

select is(
  (select count(*)::int from public.search_memories('10000000-0000-0000-0000-000000000001', 'empresa', array['factura', 'gestoría'])),
  0, 'every word, not any');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*)::int from public.memories), 2, 'a member reads the whole memory, whoever filed it');
select throws_ok(
  $$ update public.memories set content = 'otra cosa' where path = 'proveedores/gestoria.md' $$,
  '42501', null, 'a member cannot change it from the app');
select throws_ok(
  $$ insert into public.memories (org_id, store, path, content, sha) values ('10000000-0000-0000-0000-000000000001', 'empresa', 'nuevo.md', 'x', 's') $$,
  '42501', null, 'nor add to it');
select throws_ok(
  $$ select * from public.search_memories('10000000-0000-0000-0000-000000000001', 'empresa', array['factura']) $$,
  '42501', null, 'the search is the engine''s');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ delete from public.memories $$,
  '42501', null, 'an owner cannot delete it from the app either');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*)::int from public.memories), 0, 'another organisation sees none of it');

select * from finish();
rollback;

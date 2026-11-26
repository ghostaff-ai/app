-- External parties (20261126800000_external_parties.sql): every member sees
-- the organisation's list; only an owner adds, changes or removes a party;
-- nothing crosses organisations; the app never writes the table; a party
-- being removed is hidden until the record lets it go.
begin;
select plan(18);

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

insert into public.agents (id, org_id, name, ghost, department, member_default, runner, is_main) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'talk', 'chat', false),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Finanzas', 'finanzas', 'finanzas', 'talk', 'chat', false);

-- One the record already has (written by the sync, as the service role does).
insert into public.external_parties (id, org_id, path, kind, name, role, departments, content_hash) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'externos/gestoria-lopez.md', 'company',
   'Gestoría López', 'Presenta el IVA cada trimestre', '{finanzas}', 'abc'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'externos/imprenta.md', 'company',
   'Imprenta', 'Imprime los carteles', '{marketing}', 'def');

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;

-- Ana, an owner.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
insert into ids select 'ana', public.save_external_party(
  '10000000-0000-0000-0000-000000000001', null, 'person', '  Ana López ', 'Hace las ilustraciones', '{marketing}',
  'ana@ejemplo.com', '', 'https://analopez.es', '20000000-0000-0000-0000-000000000001');
select results_eq(
  $$ select name, added_by_name, proposed_by_name, pending, phone from public.external_parties where id = (select id from ids where name = 'ana') $$,
  $$ values ('Ana López', 'Ana', 'Finanzas'::text, 'save'::text, null::text) $$,
  'an owner adds one, confirming an agent''s proposal, and it waits for the record');
select lives_ok(
  $$ select public.save_external_party('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'company',
       'Gestoría López', 'Presenta el IVA y las nóminas', '{finanzas,direccion}', null, '910000000', null, null) $$,
  'she changes one the record has');
select results_eq(
  $$ select role, pending, path from public.external_parties where id = '30000000-0000-0000-0000-000000000001' $$,
  $$ values ('Presenta el IVA y las nóminas', 'save'::text, 'externos/gestoria-lopez.md'::text) $$,
  '... which keeps its file and waits to be written');
select throws_ok(
  $$ select public.save_external_party('10000000-0000-0000-0000-000000000001', null, 'friend', 'X', 'Y', '{}', null, null, null, null) $$,
  '23514', null, 'a kind must be person, company or service');
select throws_ok(
  $$ select public.save_external_party('10000000-0000-0000-0000-000000000001', null, 'person', 'X', ' ', '{}', null, null, null, null) $$,
  '23514', null, 'what it does is required');
select throws_ok(
  $$ select public.save_external_party('10000000-0000-0000-0000-000000000001', null, 'person', 'X', 'Y', '{ventas}', null, null, null, null) $$,
  '23514', null, 'departments are the organisation''s');
select throws_ok(
  $$ select public.save_external_party('10000000-0000-0000-0000-000000000001', null, 'person', 'X', 'Y', '{}', 'no-es-un-correo', null, null, null) $$,
  '23514', null, 'an email looks like one');
select throws_ok(
  $$ select public.save_external_party('10000000-0000-0000-0000-000000000001', null, 'person', 'X', 'Y', '{}', null, null, null, '20000000-0000-0000-0000-000000000002') $$,
  '22023', null, 'the proposing agent is one of this organisation''s');
select throws_ok(
  $$ select public.save_external_party('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'company', 'Mía', 'Ya', '{}', null, null, null, null) $$,
  '22023', null, 'nobody changes another organisation''s party through their own');
select throws_ok(
  $$ insert into public.external_parties (org_id, kind, name, role) values ('10000000-0000-0000-0000-000000000001', 'person', 'X', 'Y') $$,
  '42501', null, 'the app never writes the table');

-- Bea, a member.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ select public.save_external_party('10000000-0000-0000-0000-000000000001', null, 'person', 'X', 'Y', '{}', null, null, null, null) $$,
  '42501', null, 'a member does not add one');

select results_eq($$ select name from public.external_parties order by name $$, $$ values ('Ana López'), ('Gestoría López') $$,
  'a member sees the list');

-- Ana again.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
-- Removing: a party the record never had goes at once; one it has waits, hidden.
select lives_ok($$ select public.remove_external_party((select id from ids where name = 'ana')) $$, 'she removes one');
select is((select count(*)::int from public.external_parties where id = (select id from ids where name = 'ana')), 0,
  '... never written, so it is gone at once');
select lives_ok($$ select public.remove_external_party('30000000-0000-0000-0000-000000000001') $$, 'she removes the gestoría');
select is((select count(*)::int from public.external_parties where org_id = '10000000-0000-0000-0000-000000000001'), 0,
  '... which members no longer see while the record lets it go');

-- Carla, the other organisation's owner.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select results_eq($$ select name from public.external_parties $$, $$ values ('Imprenta') $$,
  'another organisation sees only its own');
select throws_ok(
  $$ select public.remove_external_party('30000000-0000-0000-0000-000000000001') $$,
  '42501', null, '... and removes nothing of anyone else''s');

select * from finish();
rollback;

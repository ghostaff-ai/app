-- The organisation's keys (docs/plans/ongoing/secrets-from-the-app.md): one row
-- per secret its agents get as variables, holding only what a person reads about
-- it, never the value. A member reads their organisation's, never another's, and
-- nobody writes them from the app: the engine and apps/sync do, with the service role.
begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'berto@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Berto'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

-- What the engine writes, as the service role: a stored key, and a member's that waits for an owner.
select lives_ok(
  $$ insert into public.org_secrets (org_id, name, label, maker, stored_by, stored_by_name, stored_at) values
       ('10000000-0000-0000-0000-000000000001', 'elevenlabs', 'Clave de ElevenLabs', 'elevenlabs',
        '00000000-0000-0000-0000-00000000000a', 'Ana', now()) $$,
  'the engine stores a key''s row');
select lives_ok(
  $$ insert into public.org_secrets (org_id, name, label, pending_by, pending_by_name, pending_at) values
       ('10000000-0000-0000-0000-000000000001', 'correo-info', 'Contraseña de info@panaderia.es',
        '00000000-0000-0000-0000-00000000000b', 'Berto', now()) $$,
  '... and a member''s that waits, never stored yet');
insert into public.org_secrets (org_id, name, label, stored_by_name, stored_at) values
  ('10000000-0000-0000-0000-000000000002', 'elevenlabs', 'ElevenLabs', 'Ghostaff', now());

select is((select status from public.org_secrets where name = 'correo-info'), 'ok', 'a row is healthy until a run misses its value');

select throws_ok(
  $$ insert into public.org_secrets (org_id, name, label, stored_by_name, stored_at)
     values ('10000000-0000-0000-0000-000000000001', 'elevenlabs', 'Otra', 'Ana', now()) $$,
  '23505', null, 'one row per organisation and name');
select throws_ok(
  $$ insert into public.org_secrets (org_id, name, label, stored_by_name, stored_at)
     values ('10000000-0000-0000-0000-000000000001', 'Correo Info', 'Correo', 'Ana', now()) $$,
  '23514', null, 'a name is lower case, digits and hyphens, as in the vault');
select throws_ok(
  $$ insert into public.org_secrets (org_id, name, label, stored_by_name, stored_at)
     values ('10000000-0000-0000-0000-000000000001', 'meta', '   ', 'Ana', now()) $$,
  '23514', null, 'a label is never empty');
select throws_ok(
  $$ insert into public.org_secrets (org_id, name, label) values ('10000000-0000-0000-0000-000000000001', 'meta', 'Meta') $$,
  '23514', null, 'a row is either stored or waiting: never neither');
select throws_ok(
  $$ insert into public.org_secrets (org_id, name, label, stored_at)
     values ('10000000-0000-0000-0000-000000000001', 'meta', 'Meta', now()) $$,
  '23514', null, 'stored says by whom');
select throws_ok(
  $$ insert into public.org_secrets (org_id, name, label, stored_by_name, stored_at, status)
     values ('10000000-0000-0000-0000-000000000001', 'meta', 'Meta', 'Ana', now(), 'leaked') $$,
  '23514', null, 'the health is ok or missing');
select hasnt_column('public', 'org_secrets', 'value', 'the row has no column for the value');

set local role authenticated;

-- Berto, a member of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.org_secrets), 2::bigint, 'a member reads only his organisation''s keys');
select throws_ok(
  $$ insert into public.org_secrets (org_id, name, label, pending_by_name, pending_at)
     values ('10000000-0000-0000-0000-000000000001', 'meta', 'Meta', 'Berto', now()) $$,
  '42501', null, 'a member cannot write a row from the app (the engine does)');

-- Carla, owner of the workshop.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select label from public.org_secrets), 'ElevenLabs', 'another organisation''s owner reads only her own');

-- Ana, owner of the bakery: even an owner writes only through the engine.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ update public.org_secrets set label = 'hack' $$,
  '42501', null, 'an owner cannot change a row from the app');
select throws_ok(
  $$ delete from public.org_secrets $$,
  '42501', null, '... nor delete one');

set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select is((select count(*) from public.org_secrets), 0::bigint, 'nobody signed out reads any');

select * from finish();
rollback;

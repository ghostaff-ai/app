-- The organisation's secrets an agent gets as variables (20261127400000_agent_secrets.sql):
-- a map of variable to secret name, never a value; no variable the runner or a tool relies on;
-- and no one but the service role sets it.
begin;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'ana@example.com');
insert into public.organizations (id, slug, name) values ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería');
insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana');
insert into public.agents (id, org_id, name, ghost, department, member_default, slug) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Correo', 'secretaria', 'direccion', 'read', 'correo');

select is((select secrets from public.agents where id = '20000000-0000-0000-0000-000000000001'), '{}'::jsonb, 'an agent has no secrets by default');

select lives_ok(
  $$ update public.agents set secrets = '{"CORREO_INFO_PASSWORD": "correo-info", "ELEVENLABS_API_KEY": "elevenlabs"}'
     where id = '20000000-0000-0000-0000-000000000001' $$,
  'the service role names the secrets and the variable each becomes');

select throws_ok(
  $$ update public.agents set secrets = '{"correo_password": "correo-info"}' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a variable is upper case, digits and underscores');

select throws_ok(
  $$ update public.agents set secrets = '{"PATH": "correo-info"}' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'no secret replaces a variable the runner sets');

select throws_ok(
  $$ update public.agents set secrets = '{"CLAUDE_CODE_OAUTH_TOKEN": "correo-info"}' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'nor the Claude credential');

select throws_ok(
  $$ update public.agents set secrets = '{"CLOUDSDK_AUTH_ACCESS_TOKEN_FILE": "correo-info"}' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'nor anything gcloud reads');

select throws_ok(
  $$ update public.agents set secrets = '{"CORREO_INFO_PASSWORD": "Correo Info"}' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a secret name is lower case, digits and hyphens');

select throws_ok(
  $$ update public.agents set secrets = '{"CORREO_INFO_PASSWORD": {"value": "hunter22"}}' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a name, never an object with a value in it');

select throws_ok(
  $$ update public.agents set secrets = '[{"env": "CORREO_INFO_PASSWORD", "name": "correo-info"}]' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a map, not a list');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ update public.agents set secrets = '{}' where id = '20000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'an owner cannot change it from the app');

select * from finish();
rollback;

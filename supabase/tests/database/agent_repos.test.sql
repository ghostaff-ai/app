-- The repos an agent may use besides its record (20261126700000_agent_repos.sql):
-- a short list of {repo, write}, each repo once, and no one but the service role sets it.
begin;
select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'ana@example.com');
insert into public.organizations (id, slug, name) values ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería');
insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana');
insert into public.agents (id, org_id, name, ghost, department, member_default, slug) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'SEO', 'base', 'marketing', 'read', 'seo');

select is((select repos from public.agents where id = '20000000-0000-0000-0000-000000000001'), '[]'::jsonb, 'an agent has no repos besides its record by default');

select lives_ok(
  $$ update public.agents set repos = '[{"repo": "panaderia/web", "write": false}, {"repo": "panaderia/app", "write": true}]'
     where id = '20000000-0000-0000-0000-000000000001' $$,
  'the service role sets which repos and which it may write');

select throws_ok(
  $$ update public.agents set repos = '[{"repo": "panaderia/web"}]' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'each repo says whether it may be written');

select throws_ok(
  $$ update public.agents set repos = '[{"repo": "panaderia/web --upload-pack=x", "write": false}]' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a repo is owner/name and nothing else');

select throws_ok(
  $$ update public.agents set repos = '[{"repo": "panaderia/web", "write": false, "token": "x"}]' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'nothing else rides along in the list');

select throws_ok(
  $$ update public.agents set repos = '[{"repo": "panaderia/web", "write": false}, {"repo": "Panaderia/Web", "write": true}]'
     where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'each repo once');

select throws_ok(
  $$ update public.agents set repos = '{"repo": "panaderia/web", "write": false}' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a list, not one repo');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ update public.agents set repos = '[]' where id = '20000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'an owner cannot change it from the app');

select * from finish();
rollback;

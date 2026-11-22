-- Several AI accounts per organisation: any number of them, in the order an
-- owner sets, named by an owner, and their usage readable only by members of
-- their own organisation (invariant 1). Outside accounts stay one per provider.
begin;
select plan(21);

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

-- What the engine writes, as the service role: two sign-ins to Claude and a key.
insert into public.connections (id, org_id, kind, provider, method, hint, connected_by_name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'ai', 'claude', 'subscription', 'aaaa', 'Ana'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'ai', 'claude', 'subscription', 'bbbb', 'Ana'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'ai', 'anthropic', 'api_key', 'cccc', 'Ana'),
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'ai', 'anthropic', 'api_key', 'zzzz', 'Carla');

select is(
  (select array_agg(position order by id) from public.connections where org_id = '10000000-0000-0000-0000-000000000001'),
  array[1, 2, 3],
  'an organisation holds two Claude subscriptions and a key, each placed after the last');
select is(
  (select position from public.connections where id = '20000000-0000-0000-0000-000000000009'),
  1, '... and another organisation''s list starts at 1');

-- Outside accounts stay one per provider.
insert into public.connections (org_id, kind, provider, method, hint, connected_by_name)
values ('10000000-0000-0000-0000-000000000001', 'account', 'google', 'oauth', 'ana@gmail.com', 'Ana');
select throws_ok(
  $$ insert into public.connections (org_id, kind, provider, method, hint, connected_by_name)
     values ('10000000-0000-0000-0000-000000000001', 'account', 'google', 'oauth', 'otra@gmail.com', 'Ana') $$,
  '23505', null, 'a second Google account in one organisation is refused');
select lives_ok(
  $$ insert into public.connections (org_id, kind, provider, method, hint, connected_by_name)
     values ('10000000-0000-0000-0000-000000000001', 'account', 'google', 'oauth', 'nueva@gmail.com', 'Ana')
     on conflict (org_id, account_key) do update set hint = excluded.hint $$,
  '... and the engine replaces it through (org_id, account_key)');
select is(
  (select position from public.connections where kind = 'account' and org_id = '10000000-0000-0000-0000-000000000001'),
  0, 'an outside account takes no place in the AI order');

insert into public.agents (id, org_id, name, ghost, department) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Contable', 'finanzas', 'finanzas');
insert into public.ai_usage (org_id, connection_id, agent_id, source, outcome, input_tokens, output_tokens, cost_usd) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'chat', 'ok', 1000, 200, 0.008),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'chat', 'ok', 500, 100, 0.004),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'run', 'limited', 0, 0, null),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000009', null, 'chat', 'ok', 9, 9, 0.001);

set local role authenticated;

-- Bea, a member of the bakery: she sees the order and the usage, and changes neither.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.ai_usage), 3::bigint, 'a member reads her organisation''s AI usage only');
select is(
  (select sum(uses) from public.ai_usage_daily('10000000-0000-0000-0000-000000000001', current_date - 30)
   where connection_id = '20000000-0000-0000-0000-000000000003'),
  2::numeric, '... summed by day: two replies on the key');
select is(
  (select sum(failures) from public.ai_usage_daily('10000000-0000-0000-0000-000000000001', current_date - 30)
   where connection_id = '20000000-0000-0000-0000-000000000001'),
  1::numeric, '... and one failure on the first subscription');
select is(
  (select count(*) from public.ai_usage_daily('10000000-0000-0000-0000-000000000002', current_date - 30)),
  0::bigint, '... and nothing of another organisation, even asking for it by id');
select throws_ok(
  $$ select public.set_ai_order('10000000-0000-0000-0000-000000000001',
     array['20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002']::uuid[]) $$,
  '42501', null, 'a member cannot reorder the AI accounts');
select throws_ok(
  $$ select public.rename_ai_connection('20000000-0000-0000-0000-000000000001', 'Mía') $$,
  '42501', null, '... nor name one');
select throws_ok(
  $$ insert into public.ai_usage (org_id, connection_id, source, outcome) values
     ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'chat', 'ok') $$,
  '42501', null, '... nor write usage');

-- Ana, owner of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ select public.set_ai_order('10000000-0000-0000-0000-000000000001',
     array['20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002']::uuid[]) $$,
  'an owner puts the key first');
select is(
  (select array_agg(id order by position) from public.connections where kind = 'ai'),
  array['20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002']::uuid[],
  '... and the order is hers');
select throws_ok(
  $$ select public.set_ai_order('10000000-0000-0000-0000-000000000001',
     array['20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001']::uuid[]) $$,
  '22023', null, 'an order that leaves an account out is refused');
select throws_ok(
  $$ select public.set_ai_order('10000000-0000-0000-0000-000000000001',
     array['20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000009']::uuid[]) $$,
  '22023', null, '... and so is one that slips in another organisation''s');
select throws_ok(
  $$ select public.set_ai_order('10000000-0000-0000-0000-000000000002', array['20000000-0000-0000-0000-000000000009']::uuid[]) $$,
  '42501', null, 'an owner cannot reorder another organisation''s accounts');
select lives_ok(
  $$ select public.rename_ai_connection('20000000-0000-0000-0000-000000000002', '  Claude   de Jaime ') $$,
  'an owner names a subscription');
select is(
  (select label from public.connections where id = '20000000-0000-0000-0000-000000000002'),
  'Claude de Jaime', '... with its spaces tidied');
select lives_ok(
  $$ select public.rename_ai_connection('20000000-0000-0000-0000-000000000002', '') $$,
  '... and an empty name gives the provider''s back');
select throws_ok(
  $$ select public.rename_ai_connection('20000000-0000-0000-0000-000000000009', 'Mía') $$,
  '42501', null, 'an owner cannot name another organisation''s account');

select * from finish();
rollback;

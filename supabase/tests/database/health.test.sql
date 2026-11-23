-- Kept health history (docs/plans/ongoing/wearables.md): only a personal space
-- holds it, only the engine (service role) writes it, its person reads it, and
-- nobody in another organisation sees any of it (invariant 1, AGENTS.md rule 2).
begin;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com');

insert into public.organizations (id, slug, name, kind, created_by) values
  ('10000000-0000-0000-0000-000000000001', 'personal-ana', 'Personal', 'personal', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-000000000002', 'panaderia', 'Panadería', 'company', '00000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-000000000003', 'personal-bea', 'Personal', 'personal', '00000000-0000-0000-0000-00000000000b');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'owner', 'Bea'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', 'owner', 'Bea');

-- As the engine.
select lives_ok($$
  insert into health.sources (id, org_id, provider, external_user_id, consented_at, consent_version)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'whoop', '42', now(), 'import-v1')
$$, 'the engine keeps a source in a personal space');

select lives_ok($$
  insert into health.records (org_id, source_id, provider, kind, external_id, starts_at, ends_at, payload, updated_at) values
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'whoop', 'cycle', '1', now(), now(), '{}', now()),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'whoop', 'sleep', 'a', now(), now(), '{}', now())
$$, '... its records');

select lives_ok($$
  insert into health.metrics (org_id, source_id, source, day, metric, value, unit) values
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'whoop', '2026-11-10', 'strain', 12.3, 'score'),
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'whoop', '2026-11-10', 'hrv_ms', 54.2, 'ms')
$$, '... and its daily metrics');

select throws_ok($$
  insert into health.sources (org_id, provider, external_user_id, consented_at, consent_version)
  values ('10000000-0000-0000-0000-000000000002', 'whoop', '43', now(), 'import-v1')
$$, '22023', null, 'a company space cannot hold health data');

select throws_ok($$
  update health.sources set org_id = '10000000-0000-0000-0000-000000000002'
  where id = '20000000-0000-0000-0000-000000000001'
$$, '22023', null, '... nor can a source be moved into one');

select throws_ok($$
  insert into health.sources (org_id, provider, external_user_id, consented_at, consent_version)
  values ('10000000-0000-0000-0000-000000000001', 'whoop', '42', now(), 'import-v1')
$$, '23505', null, 'one source per band account in a space');

select throws_ok($$
  insert into health.records (org_id, source_id, provider, kind, external_id, payload, updated_at)
  values ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'whoop', 'cycle', '9', '{}', now())
$$, '23503', null, 'a record cannot claim another space than its source''s');

-- As Ana, in her personal space.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from health.sources), 1::bigint, 'Ana reads her source');
select is((select count(*) from health.records), 2::bigint, '... her records');
select is((select count(*) from health.metrics), 2::bigint, '... and her metrics');
select throws_ok($$
  insert into health.metrics (org_id, source_id, source, day, metric, value, unit)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'whoop', '2026-11-11', 'strain', 1, 'score')
$$, '42501', null, 'she cannot write a metric herself');
select throws_ok($$ update health.metrics set value = 0 $$, '42501', null, '... nor change one');
select throws_ok($$ delete from health.records $$, '42501', null, '... nor delete a record');
select throws_ok(
  $$ select health.replace_metrics('20000000-0000-0000-0000-000000000001', '[]') $$,
  '42501', null, '... nor replace her metrics');

-- As Bea, from another organisation.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from health.sources), 0::bigint, 'Bea sees none of Ana''s sources');
select is((select count(*) from health.records) + (select count(*) from health.metrics), 0::bigint,
  '... records or metrics');

-- Bea, invited into Ana's personal space, still doesn't read Ana's health.
reset role;
insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'owner', 'Bea');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from health.sources), 0::bigint, 'Bea, a member of Ana''s personal space, sees none of her sources');
select is((select count(*) from health.records) + (select count(*) from health.metrics), 0::bigint,
  '... records or metrics: health is only its own person''s');

-- Back as the engine: recomputed metrics replace the old ones in one go.
reset role;
select health.replace_metrics('20000000-0000-0000-0000-000000000001',
  '[{"day": "2026-11-12", "metric": "strain", "value": 5, "unit": "score"}]');
select is((select count(*) from health.metrics), 1::bigint, 'replacing leaves only the new metrics');
select is((select org_id::text || ' ' || day::text from health.metrics),
  '10000000-0000-0000-0000-000000000001 2026-11-12', '... in the source''s own space');

-- Deleting the source deletes its history.
delete from health.sources where id = '20000000-0000-0000-0000-000000000001';
select is((select count(*) from health.records), 0::bigint, 'deleting a source deletes its records');
select is((select count(*) from health.metrics), 0::bigint, '... and its metrics');

select * from finish();
rollback;

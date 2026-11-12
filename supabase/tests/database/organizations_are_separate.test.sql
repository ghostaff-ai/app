-- Invariant 1: one organisation's rows are never visible to another's members,
-- and nobody answers a decision outside their own organisation.
begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'org-a', 'Org A'),
  ('10000000-0000-0000-0000-000000000002', 'org-b', 'Org B');

insert into public.memberships (org_id, user_id, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Ana'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'Bea');

insert into public.decisions (id, org_id, record_id, source_path, area, kind, question, context, proposed_by, created_on) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'seo-a', 'por-decidir/seo-a.yaml', 'seo', 'titulo-web', '¿A?', 'ctx', 'seo', '2026-11-12'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'seo-b', 'por-decidir/seo-b.yaml', 'seo', 'titulo-web', '¿B?', 'ctx', 'seo', '2026-11-12'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'direccion-regla-x', 'por-decidir/direccion-regla-x.yaml', 'direccion', 'regla', '¿Regla?', 'ctx', 'direccion', '2026-11-12');

-- Anonymous: nothing.
set local role anon;
select is((select count(*) from public.decisions), 0::bigint, 'anon sees no decisions');
select is((select count(*) from public.organizations), 0::bigint, 'anon sees no organisations');

-- Ana, member of A only.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

select is((select count(*) from public.organizations), 1::bigint, 'Ana sees one organisation');
select is((select slug from public.organizations), 'org-a', '... and it is hers');
select is((select count(*) from public.decisions where org_id = '10000000-0000-0000-0000-000000000002'), 0::bigint, 'Ana sees none of B''s decisions');
select is((select count(*) from public.memberships), 1::bigint, 'Ana sees only her organisation''s members');

select throws_ok(
  $$ select public.answer_decision('20000000-0000-0000-0000-000000000002', 'ok') $$,
  'P0002', 'decision not found', 'Ana cannot answer B''s decision');

select is_empty(
  $$ update public.decisions set answer = 'ok', answered_at = now(), answered_by_name = 'x'
     where id = '20000000-0000-0000-0000-000000000001' returning id $$,
  'members cannot write decisions directly, only through answer_decision()');

select is(
  (select answered_by_name from public.answer_decision('20000000-0000-0000-0000-000000000001', 'ok', '  vale  ')),
  'Ana', 'Ana answers her own decision and signs with her display name');

select throws_ok(
  $$ select public.answer_decision('20000000-0000-0000-0000-000000000001', 'no') $$,
  '22023', 'decision already answered', 'an answer is final');

select throws_ok(
  $$ select public.answer_decision('20000000-0000-0000-0000-000000000003', 'ok') $$,
  '22023', 'a rule is signed with its text', 'a rule needs its signed text');

select is(
  (select answer_text from public.answer_decision('20000000-0000-0000-0000-000000000003', 'ok', null, 'Los títulos hablan como quien busca.')),
  'Los títulos hablan como quien busca.', 'a rule is answered with its signed text');

select * from finish();
rollback;

-- Files in the chat (20261128940000_chat_files.sql): whoever may read the chat
-- opens its files and sees them listed; nobody else; a deleted message's file
-- is opened by nobody; only the engine writes the bucket.
begin;
select plan(9);

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
-- Finanzas, which Bea doesn't see.
insert into public.agents (id, org_id, name, ghost, department, member_default) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'none');

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;
insert into ids select 'general', id from public.threads where org_id = '10000000-0000-0000-0000-000000000001' and kind = 'general';
insert into ids values ('finanzas', public.agent_chat('20000000-0000-0000-0000-000000000001'));

insert into public.messages (id, thread_id, org_id, author_kind, author_user, author_name, parts) values
  ('40000000-0000-0000-0000-000000000001', (select id from ids where name = 'general'), '10000000-0000-0000-0000-000000000001', 'person',
   '00000000-0000-0000-0000-00000000000a', 'Ana', '[{"type": "document", "path": "p1", "mediaType": "application/pdf", "name": "presupuesto.pdf", "size": 2400}]'),
  ('40000000-0000-0000-0000-000000000002', (select id from ids where name = 'finanzas'), '10000000-0000-0000-0000-000000000001', 'person',
   '00000000-0000-0000-0000-00000000000a', 'Ana', '[{"type": "document", "path": "p2", "mediaType": "image/jpeg", "name": "factura.jpg", "size": 90000}]');
insert into storage.objects (bucket_id, name)
select 'documents', '10000000-0000-0000-0000-000000000001/' || (select id from ids where name = 'general') || '/40000000-0000-0000-0000-000000000001/presupuesto.pdf'
union all
select 'documents', '10000000-0000-0000-0000-000000000001/' || (select id from ids where name = 'finanzas') || '/40000000-0000-0000-0000-000000000002/factura.jpg';

select is((select public from storage.buckets where id = 'documents'), false, 'the bucket is private');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'documents'), 2::bigint, 'an owner opens the files of every chat she reads');
select results_eq($$ select part->>'name' from public.list_files('10000000-0000-0000-0000-000000000001') order by 1 $$, $$ values ('factura.jpg'), ('presupuesto.pdf') $$, '... and sees them all listed');
select results_eq(
  $$ select part->>'name' from public.list_files('10000000-0000-0000-0000-000000000001', (select id from ids where name = 'general')) $$,
  $$ values ('presupuesto.pdf') $$, '... or one chat''s');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq($$ select name from storage.objects where bucket_id = 'documents' $$, $$ values ('10000000-0000-0000-0000-000000000001/' || (select id from ids where name = 'general') || '/40000000-0000-0000-0000-000000000001/presupuesto.pdf') $$, 'a member opens General''s file, not one of a chat she can''t read');
select results_eq($$ select part->>'name' from public.list_files('10000000-0000-0000-0000-000000000001') $$, $$ values ('presupuesto.pdf') $$, '... nor sees it listed');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'documents'), 0::bigint, 'another organisation opens nothing');
select is((select count(*) from public.list_files('10000000-0000-0000-0000-000000000001')), 0::bigint, '... and sees nothing listed');

reset role;
select is(public.delete_message_of('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a'), 'documents:p1', 'deleting a message gives the engine its file to remove');

select * from finish();
rollback;

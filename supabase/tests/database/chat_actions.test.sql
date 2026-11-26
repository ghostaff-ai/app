-- What you do with a message (20261128130000_chat_actions.sql): reply quoting
-- it, react, edit within 15 minutes, delete for everyone, pin, forward to an
-- agent; nothing across organisations, nothing in someone else's name.
begin;
select plan(22);

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
insert into public.agents (id, org_id, name, ghost, department, member_default) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'none');

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;
insert into ids select 'general', id from public.threads where org_id = '10000000-0000-0000-0000-000000000001' and kind = 'general';

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
insert into ids select 'bea', id from public.post_message((select id from ids where name = 'general'), 'Mañana abro yo a las 7');

-- Ana replies quoting Bea's message.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
insert into ids select 'ana', id from public.post_message((select id from ids where name = 'general'), 'Perfecto', (select id from ids where name = 'bea'));
select is(
  (select (parts->0) - 'messageId' from public.messages where id = (select id from ids where name = 'ana')),
  '{"type": "quote", "authorName": "Bea", "kind": "text", "text": "Mañana abro yo a las 7"}'::jsonb,
  'a reply carries what it quotes, as a snapshot');
select is((select parts->1->>'text' from public.messages where id = (select id from ids where name = 'ana')), 'Perfecto', '... before its own words');
select throws_ok(
  $$ select public.post_message((select id from ids where name = 'general'), 'x', gen_random_uuid()) $$,
  '22023', null, 'a quote must be of a message in that chat');

-- Reactions: one per person, replaced, taken away.
select lives_ok($$ select public.react((select id from ids where name = 'bea'), '👍') $$, 'a member reacts');
select lives_ok($$ select public.react((select id from ids where name = 'bea'), '❤️') $$, '... and changes it');
select results_eq($$ select emoji from public.message_reactions $$, $$ values ('❤️'::text) $$, '... one reaction per person');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select lives_ok($$ select public.react((select id from ids where name = 'bea'), '😂') $$, 'another member reacts too');
select is((select count(*) from public.message_reactions), 2::bigint, '... and sees both');
select lives_ok($$ select public.react((select id from ids where name = 'bea'), null) $$, '... and takes hers away');
select is((select count(*) from public.message_reactions), 1::bigint, '... leaving the other');
select throws_ok($$ insert into public.message_reactions (message_id, user_id, thread_id, org_id, emoji) values ((select id from ids where name = 'bea'), '00000000-0000-0000-0000-00000000000a', (select id from ids where name = 'general'), '10000000-0000-0000-0000-000000000001', 'x') $$, '42501', null, 'nobody writes reactions but through react');

-- Editing: your own text, within 15 minutes.
select lives_ok($$ select public.edit_message((select id from ids where name = 'bea'), 'Mañana abro yo a las 8') $$, 'its author edits a message');
select is((select (edited_at is not null) from public.messages where id = (select id from ids where name = 'bea')), true, '... marked edited');
select throws_ok($$ select public.edit_message((select id from ids where name = 'ana'), 'hackeado') $$, 'P0002', null, 'nobody edits someone else''s');
reset role;
update public.messages set created_at = now() - interval '20 minutes' where id = (select id from ids where name = 'bea');
set local role authenticated;
select throws_ok($$ select public.edit_message((select id from ids where name = 'bea'), 'tarde') $$, '22023', null, '... nor after 15 minutes');

-- Pinning.
select lives_ok($$ select public.pin_message((select id from ids where name = 'general'), (select id from ids where name = 'bea')) $$, 'a member pins a message');
select is((select pinned_message from public.threads where id = (select id from ids where name = 'general')), (select id from ids where name = 'bea'), '... at the top of the chat');

-- Forwarding to an agent: only one the person may talk to.
select throws_ok($$ select public.forward_to_agent((select id from ids where name = 'ana'), '20000000-0000-0000-0000-000000000001') $$, '42501', null, 'Bea can''t forward to an agent she can''t talk to');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is(
  (select parts->0->>'type' || ':' || (parts->0->>'from') || ':' || (parts->0->>'text') from public.forward_to_agent((select id from ids where name = 'bea'), '20000000-0000-0000-0000-000000000001')),
  'forward:General:Mañana abro yo a las 8', 'an owner forwards it to Finanzas, in its chat, saying where it came from');

-- Another organisation: nothing.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select throws_ok($$ select public.react((select id from ids where name = 'bea'), '👍') $$, 'P0002', null, 'another organisation can''t react');
select is((select count(*) from public.message_reactions), 0::bigint, '... nor see the reactions');

-- Deleting, for the engine: the author's only; the words, the reactions and the pin go.
reset role;
select is(public.delete_message_of((select id from ids where name = 'bea'), '00000000-0000-0000-0000-00000000000b'), null, 'its author deletes it (no audio to remove)');

select * from finish();
rollback;

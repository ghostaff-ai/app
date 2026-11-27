-- Typing channels (20261128950000_chat_presence.sql): which chat a topic names,
-- and that the policies stand on realtime.messages.
begin;
select plan(4);

select is(public.typing_thread('typing:30000000-0000-0000-0000-000000000001'), '30000000-0000-0000-0000-000000000001'::uuid, 'a typing topic names its chat');
select is(public.typing_thread('thread:30000000-0000-0000-0000-000000000001'), null, '... another topic names none');
select is(public.typing_thread('typing:x'' or 1=1'), null, '... nor a malformed one');
select is(
  (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'members % typing %'),
  2::bigint, 'who hears and who says it are both checked');

select * from finish();
rollback;

-- «Está escribiendo…» and «está grabando un audio…», as in WhatsApp
-- (docs/plans/ready/chat-like-whatsapp.md, phase 4): a Realtime broadcast on a
-- private channel per chat, `typing:<thread>`, nothing stored. Only who may
-- read a chat hears it; only who may write in it says it.

/** The chat a typing channel is about, or null when the topic isn't one. */
create function public.typing_thread(topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when topic ~ '^typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substring(topic from 8)::uuid end;
$$;

create policy "members hear who is typing in chats they may read"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.typing_thread(realtime.topic()) is not null
    and public.thread_level(public.typing_thread(realtime.topic())) <> 'none'
  );

create policy "members say they are typing in chats they may write in"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.typing_thread(realtime.topic()) is not null
    and public.thread_level(public.typing_thread(realtime.topic())) = 'talk'
  );

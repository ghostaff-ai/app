-- Files in the chat, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md,
-- phase 3, decision 2): photos, the camera and documents, in General and every
-- chat with an agent. One private store in the EU (Supabase Storage, Frankfurt,
-- invariant 2), the shape business-brain.md planned for documents: a
-- `document` part with its path, type, name and size. Each chat lists its
-- files, and Empresa › Archivos every file of the chats the person may read.

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do nothing;

/**
 * Whether the signed-in person may open the file stored at `object_name`,
 * `<org>/<thread>/<message>/<name>`: whoever may read its message's chat, while
 * the message isn't deleted. The engine writes them (service role), nobody else.
 */
create function public.can_read_document(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
      then coalesce((
        select public.thread_level(m.thread_id) <> 'none'
        from public.messages m
        where m.id = split_part(object_name, '/', 3)::uuid
          and m.org_id = split_part(object_name, '/', 1)::uuid
          and m.deleted_at is null
      ), false)
    else false
  end;
$$;

revoke execute on function public.can_read_document(text) from public, anon;
grant execute on function public.can_read_document(text) to authenticated;

create policy "members open the files of chats they may read"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.can_read_document(name));

/**
 * The files of the chats the person may read in an organisation, newest first:
 * one chat's with `target_thread`. Runs as the caller, so row-level security
 * on messages decides what comes back.
 */
create function public.list_files(target_org uuid, target_thread uuid default null, max_rows integer default 300)
returns table (message_id uuid, thread_id uuid, thread_title text, thread_kind text, author_name text, created_at timestamptz, part jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.thread_id, t.title, t.kind, m.author_name, m.created_at, p
  from public.messages m
  join public.threads t on t.id = m.thread_id
  cross join lateral jsonb_array_elements(m.parts) p
  where m.org_id = target_org
    and (target_thread is null or m.thread_id = target_thread)
    and m.deleted_at is null
    and p->>'type' = 'document'
  order by m.created_at desc
  limit least(coalesce(max_rows, 300), 1000);
$$;

revoke execute on function public.list_files(uuid, uuid, integer) from public, anon;
grant execute on function public.list_files(uuid, uuid, integer) to authenticated;

-- delete_message_of: a deleted message's file goes too (the engine removes the bytes).
create or replace function public.delete_message_of(target_message uuid, member uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
  stored text;
begin
  select * into m from public.messages x where x.id = target_message;
  if not found or m.author_kind <> 'person' or m.author_user is distinct from member or m.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  select coalesce(
           case when p->>'type' = 'voice' then 'voice-notes:' || (p->>'path') end,
           case when p->>'type' = 'document' then 'documents:' || (p->>'path') end)
    into stored
  from jsonb_array_elements(m.parts) p
  where p->>'type' in ('voice', 'document')
  limit 1;
  update public.messages set parts = '[]'::jsonb, deleted_at = now() where id = m.id;
  delete from public.message_reactions where message_id = m.id;
  update public.threads set pinned_message = null where pinned_message = m.id;
  return stored;
end;
$$;

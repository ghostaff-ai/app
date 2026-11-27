-- What you do with a message, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md,
-- phase 2): reply quoting it, react with an emoji, edit it within 15 minutes,
-- delete it for everyone, pin it, forward it to an agent. Everything through
-- functions that check the caller; reactions are live through Realtime.

alter table public.messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz;

alter table public.threads
  add column pinned_message uuid references public.messages (id) on delete set null;

-- Quoting and forwarding ---------------------------------------------------------

/**
 * A message as another quotes it: who wrote it, its kind and its words (a voice
 * note's transcript), cut short. A snapshot, as the agent reads it. Null for a
 * message not in `target_thread` (a quote stays in its chat) or deleted.
 */
create function public.quote_part(target_message uuid, target_thread uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'type', 'quote',
    'messageId', m.id,
    'authorName', m.author_name,
    'kind', case when exists (select 1 from jsonb_array_elements(m.parts) p where p->>'type' = 'voice') then 'voice' else 'text' end,
    'text', left(coalesce((select string_agg(p->>'text', ' ') from jsonb_array_elements(m.parts) p where p->>'type' = 'text'), ''), 300)
  )
  from public.messages m
  where m.id = target_message and m.thread_id = target_thread and m.deleted_at is null;
$$;

revoke execute on function public.quote_part(uuid, uuid) from public, anon, authenticated;
grant execute on function public.quote_part(uuid, uuid) to service_role;

/** Writes in a chat the person may talk in, quoting one of its messages if `quoted` is given. */
drop function public.post_message(uuid, text);
create function public.post_message(target_thread uuid, body text, quoted uuid default null)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.threads;
  me text;
  clean text := trim(body);
  quote jsonb;
  msg public.messages;
begin
  select * into t from public.threads x where x.id = target_thread;
  if not found or public.thread_level(target_thread) <> 'talk' then
    raise exception 'you may not write in this thread' using errcode = '42501';
  end if;
  if nullif(clean, '') is null or length(clean) > 8000 then
    raise exception 'a message of up to 8000 characters is required' using errcode = '22023';
  end if;
  if quoted is not null then
    quote := public.quote_part(quoted, t.id);
    if quote is null then
      raise exception 'that message is not in this chat' using errcode = '22023';
    end if;
  end if;
  select m.display_name into me from public.memberships m where m.org_id = t.org_id and m.user_id = auth.uid();

  insert into public.messages (thread_id, org_id, author_kind, author_user, author_name, parts)
  values (t.id, t.org_id, 'person', auth.uid(), me,
          case when quote is null then '[]'::jsonb else jsonb_build_array(quote) end
          || jsonb_build_array(jsonb_build_object('type', 'text', 'text', clean)))
  returning * into msg;
  update public.threads set last_message_at = msg.created_at where id = t.id;
  return msg;
end;
$$;

revoke execute on function public.post_message(uuid, text, uuid) from public, anon;
grant execute on function public.post_message(uuid, text, uuid) to authenticated;

/**
 * Forwards a message the person can read to an agent they may talk to: a
 * message of theirs in the agent's chat with what they forward, which the
 * agent answers (the app asks it to). Returns the new message.
 */
create function public.forward_to_agent(target_message uuid, target_agent uuid)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.messages;
  a public.agents;
  t public.threads;
  chat uuid;
  me text;
  msg public.messages;
begin
  select * into src from public.messages x where x.id = target_message and x.deleted_at is null;
  if not found or public.thread_level(src.thread_id) = 'none' then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  select * into a from public.agents x where x.id = target_agent and x.org_id = src.org_id;
  if not found or public.agent_level(a.id) <> 'talk' then
    raise exception 'you may not talk to this agent' using errcode = '42501';
  end if;
  select * into t from public.threads x where x.id = src.thread_id;
  chat := public.agent_chat(a.id);
  select m.display_name into me from public.memberships m where m.org_id = a.org_id and m.user_id = auth.uid();
  insert into public.messages (thread_id, org_id, author_kind, author_user, author_name, parts)
  values (chat, a.org_id, 'person', auth.uid(), me, jsonb_build_array(
    public.quote_part(src.id, src.thread_id) || jsonb_build_object('type', 'forward', 'from', t.title, 'at', src.created_at)))
  returning * into msg;
  update public.threads set last_message_at = msg.created_at where id = chat;
  return msg;
end;
$$;

revoke execute on function public.forward_to_agent(uuid, uuid) from public, anon;
grant execute on function public.forward_to_agent(uuid, uuid) to authenticated;

-- Editing and deleting -----------------------------------------------------------

/** Changes the words of the person's own text message, within 15 minutes of writing it. */
create function public.edit_message(target_message uuid, body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
  clean text := trim(body);
begin
  select * into m from public.messages x where x.id = target_message;
  if not found or m.author_kind <> 'person' or m.author_user is distinct from auth.uid() or m.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from jsonb_array_elements(m.parts) p where p->>'type' = 'voice') then
    raise exception 'a voice note cannot be edited' using errcode = '22023';
  end if;
  if m.created_at < now() - interval '15 minutes' then
    raise exception 'too late to edit' using errcode = '22023';
  end if;
  if nullif(clean, '') is null or length(clean) > 8000 then
    raise exception 'a message of up to 8000 characters is required' using errcode = '22023';
  end if;
  update public.messages x
  set parts = coalesce((select jsonb_agg(p) from jsonb_array_elements(x.parts) p where p->>'type' <> 'text'), '[]'::jsonb)
              || jsonb_build_array(jsonb_build_object('type', 'text', 'text', clean)),
      edited_at = now()
  where x.id = m.id
  returning * into m;
  return m;
end;
$$;

revoke execute on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

/**
 * Deletes a person's own message for everyone: its words go, «Se eliminó este
 * mensaje» stays in its place. Returns its voice note's path, for the engine to
 * remove the audio (it runs this as the service role, for `member`).
 */
create function public.delete_message_of(target_message uuid, member uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
  audio text;
begin
  select * into m from public.messages x where x.id = target_message;
  if not found or m.author_kind <> 'person' or m.author_user is distinct from member or m.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  select p->>'path' into audio from jsonb_array_elements(m.parts) p where p->>'type' = 'voice' limit 1;
  update public.messages set parts = '[]'::jsonb, deleted_at = now() where id = m.id;
  delete from public.message_reactions where message_id = m.id;
  update public.threads set pinned_message = null where pinned_message = m.id;
  return audio;
end;
$$;

-- Pinning --------------------------------------------------------------------------

/** Pins a message at the top of its chat, or unpins with null; anyone who writes there may. */
create function public.pin_message(target_thread uuid, target_message uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.thread_level(target_thread) <> 'talk' then
    raise exception 'you may not write in this thread' using errcode = '42501';
  end if;
  if target_message is not null and not exists (
    select 1 from public.messages m where m.id = target_message and m.thread_id = target_thread and m.deleted_at is null
  ) then
    raise exception 'that message is not in this chat' using errcode = '22023';
  end if;
  update public.threads set pinned_message = target_message where id = target_thread;
end;
$$;

revoke execute on function public.pin_message(uuid, uuid) from public, anon;
grant execute on function public.pin_message(uuid, uuid) to authenticated;

-- Reactions -------------------------------------------------------------------------

-- One reaction per person and message, as in WhatsApp; a new one replaces it.
create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index message_reactions_thread on public.message_reactions (thread_id);

alter table public.message_reactions enable row level security;
-- Realtime sends removals with the whole row, so the thread filter matches them.
alter table public.message_reactions replica identity full;

create policy "members read the reactions in chats they may read"
  on public.message_reactions for select to authenticated
  using (public.is_member(org_id) and public.thread_level(thread_id) <> 'none');

revoke insert, update, delete, truncate on public.message_reactions from anon, authenticated;

alter publication supabase_realtime add table public.message_reactions;

/** Reacts to a message with an emoji, replacing the person's earlier one; null or empty takes it away. */
create function public.react(target_message uuid, emoji text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
begin
  select * into m from public.messages x where x.id = target_message and x.deleted_at is null;
  if not found or public.thread_level(m.thread_id) <> 'talk' then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if nullif(trim(emoji), '') is null then
    delete from public.message_reactions r where r.message_id = m.id and r.user_id = auth.uid();
    return;
  end if;
  if length(trim(emoji)) > 16 then
    raise exception 'one emoji' using errcode = '22023';
  end if;
  insert into public.message_reactions (message_id, user_id, thread_id, org_id, emoji)
  values (m.id, auth.uid(), m.thread_id, m.org_id, trim(emoji))
  on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
end;
$$;

revoke execute on function public.react(uuid, text) from public, anon;
grant execute on function public.react(uuid, text) to authenticated;

revoke execute on function public.delete_message_of(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_message_of(uuid, uuid) to service_role;

-- A deleted message's voice note is heard by nobody, until the engine removes it.
create or replace function public.can_hear_voice_note(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$'
      then coalesce((
        select public.thread_level(m.thread_id) <> 'none'
        from public.messages m
        where m.id = split_part(split_part(object_name, '/', 3), '.', 1)::uuid
          and m.org_id = split_part(object_name, '/', 1)::uuid
          and m.deleted_at is null
      ), false)
    else false
  end;
$$;

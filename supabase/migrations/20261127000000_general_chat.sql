-- General: the people's chat (docs/plans/ready/general-chat.md, Jaime
-- 2026-11-26). Every organisation has one chat without an agent where its
-- members talk to each other, mostly by voice notes, as in a WhatsApp group.
-- Every member reads and writes it; agents answer there only when a message
-- @mentions them (the engine decides that), and the reply notifies only
-- whoever asked.

-- The shape ----------------------------------------------------------------------

alter table public.threads
  add column kind text not null default 'agent' check (kind in ('agent', 'general'));

alter table public.threads alter column agent_id drop not null;

-- An agent's chat has its agent; General has none.
alter table public.threads
  add constraint threads_kind_agent check ((kind = 'agent') = (agent_id is not null));

create unique index threads_one_general_per_org on public.threads (org_id) where kind = 'general';

-- One General per organisation, made with it ------------------------------------

/** An organisation's General, made the first time it is asked for. Returns its id. */
create function public.general_chat(target_org uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat uuid;
begin
  insert into public.threads (org_id, kind, title)
  values (target_org, 'general', 'General')
  on conflict (org_id) where kind = 'general' do nothing;
  select t.id into chat from public.threads t where t.org_id = target_org and t.kind = 'general';
  return chat;
end;
$$;

revoke execute on function public.general_chat(uuid) from public, anon, authenticated;
grant execute on function public.general_chat(uuid) to service_role;

create function public.organizations_general_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.general_chat(new.id);
  return null;
end;
$$;

revoke execute on function public.organizations_general_chat() from public, anon, authenticated;

create trigger organizations_general_chat
  after insert on public.organizations
  for each row execute function public.organizations_general_chat();

select public.general_chat(o.id) from public.organizations o;

-- The rule -----------------------------------------------------------------------

/**
 * A member's level on a chat: on an agent's, their level on the agent; on
 * General, `talk` for every member of the organisation. For the engine
 * (service role), which acts with the rights of whoever asked;
 * thread_level() is it for the signed-in person.
 */
create or replace function public.thread_level_for(target_thread uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case t.kind
      when 'general' then
        case when exists (select 1 from public.memberships m where m.org_id = t.org_id and m.user_id = member)
          then 'talk' else 'none' end
      else public.agent_level_for(t.agent_id, member)
    end
    from public.threads t
    where t.id = target_thread
  ), 'none');
$$;

-- The list -----------------------------------------------------------------------

-- Each chat the person sees, General included (`kind`), with its newest word.
-- `last_voice_ms` is the length of the newest message's voice note, if it is
-- one: in General the list says «Nota de voz · 0:38», not its transcript.
drop function public.my_threads(uuid, uuid);
create function public.my_threads(target_org uuid, target_agent uuid default null)
returns table (
  id uuid,
  kind text,
  agent_id uuid,
  title text,
  created_at timestamptz,
  last_message_at timestamptz,
  last_author text,
  last_text text,
  last_voice_ms integer,
  unread boolean,
  following boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.kind, t.agent_id, t.title, t.created_at, t.last_message_at,
         lm.author_name, lm.text, lm.voice_ms,
         coalesce(lm.author_user is distinct from auth.uid()
                  and coalesce(lm.finished_at, lm.created_at) > coalesce(r.read_at, '-infinity'), false),
         public.follows_thread(t.id, auth.uid())
  from public.threads t
  left join public.thread_reads r on r.thread_id = t.id and r.user_id = auth.uid()
  left join lateral (
    select m.author_name, m.author_user, m.created_at, m.finished_at,
           (select string_agg(p->>'text', ' ') from jsonb_array_elements(m.parts) p where p->>'type' = 'text') as text,
           (select round((p->>'durationMs')::numeric)::integer from jsonb_array_elements(m.parts) p
            where p->>'type' = 'voice' and jsonb_typeof(p->'durationMs') = 'number' limit 1) as voice_ms
    from public.messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where t.org_id = target_org and (target_agent is null or t.agent_id = target_agent)
  order by t.last_message_at desc
  limit 200;
$$;

revoke execute on function public.my_threads(uuid, uuid) from public, anon;
grant execute on function public.my_threads(uuid, uuid) to authenticated;

-- Pushes -------------------------------------------------------------------------

/** «Nota de voz · 0:38», or the message's text, for a push from General. */
create function public.general_push_body(parts jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select 'Nota de voz' || case when jsonb_typeof(p->'durationMs') = 'number' then
              ' · ' || (round((p->>'durationMs')::numeric)::bigint / 60000)::text || ':' || lpad(((round((p->>'durationMs')::numeric)::bigint / 1000) % 60)::text, 2, '0')
            else '' end
     from jsonb_array_elements(parts) p
     where p->>'type' = 'voice'
     limit 1),
    left((select string_agg(p->>'text', ' ') from jsonb_array_elements(parts) p where p->>'type' = 'text'), 180),
    'Mensaje');
$$;

/**
 * Queues the pushes a message sends. In an agent's chat: when an agent message
 * is finished, a reply push for each person who sees the chat, follows it and
 * has a phone (group-chat-per-agent.md, decision 7). In General
 * (general-chat.md): a person's message, as it is written, for every other
 * member with a phone, as in a group; an agent's reply, once finished, only for
 * whoever asked (decision 7). Whether they read it since is checked when the
 * engine claims it.
 */
create or replace function public.messages_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.threads;
  asker uuid;
begin
  select * into t from public.threads x where x.id = new.thread_id;

  if t.kind = 'general' then
    if new.author_kind = 'person' then
      if tg_op <> 'INSERT' then
        return null;
      end if;
      insert into public.push_outbox (user_id, org_id, kind, thread_id, message_id, title, body, data, collapse_id)
      select m.user_id, t.org_id, 'reply', t.id, new.id, new.author_name, public.general_push_body(new.parts),
             jsonb_build_object('kind', 'reply', 'orgId', t.org_id, 'route', '/general'),
             t.id::text
      from public.memberships m
      where m.org_id = t.org_id
        and m.user_id is distinct from new.author_user
        and exists (select 1 from public.device_tokens d where d.user_id = m.user_id)
      on conflict do nothing;
      return null;
    end if;

    if new.state not in ('done', 'failed') or (tg_op = 'UPDATE' and old.state is distinct from 'working') then
      return null;
    end if;
    select q.author_user into asker from public.messages q where q.id = new.reply_to and q.author_kind = 'person';
    if asker is null then
      return null;
    end if;
    insert into public.push_outbox (user_id, org_id, kind, thread_id, message_id, title, body, data, collapse_id)
    select asker, t.org_id, 'reply', t.id, new.id, new.author_name,
           case new.state when 'done' then 'Te ha contestado en General' else 'No ha podido acabar' end,
           jsonb_build_object('kind', 'reply', 'orgId', t.org_id, 'route', '/general'),
           t.id::text
    where exists (select 1 from public.memberships m where m.org_id = t.org_id and m.user_id = asker)
      and exists (select 1 from public.device_tokens d where d.user_id = asker)
    on conflict do nothing;
    return null;
  end if;

  if new.author_kind <> 'agent' or new.state not in ('done', 'failed')
     or (tg_op = 'UPDATE' and old.state is distinct from 'working') then
    return null;
  end if;

  insert into public.push_outbox (user_id, org_id, kind, thread_id, message_id, title, body, data, collapse_id)
  select m.user_id, t.org_id, 'reply', t.id, new.id, new.author_name,
         case new.state when 'done' then 'Te ha contestado' else 'No ha podido acabar' end,
         jsonb_build_object('kind', 'reply', 'orgId', t.org_id, 'route', '/chat/' || t.agent_id),
         t.id::text
  from public.memberships m
  where m.org_id = t.org_id
    and public.follows_thread(t.id, m.user_id)
    and public.thread_level_for(t.id, m.user_id) <> 'none'
    and exists (select 1 from public.device_tokens d where d.user_id = m.user_id)
  on conflict do nothing;
  return null;
end;
$$;

-- What each person has read of the team chat (docs/plans/ongoing/team-chat.md,
-- decision 10: an unread dot on the agent's row), and the list of threads a
-- person may see with their last message.

-- Messages keep the order they were written in, even several in one
-- transaction (the engine may write a few at once): the clock, not the
-- transaction's start.
alter table public.messages alter column created_at set default clock_timestamp();

create table public.thread_reads (
  thread_id uuid not null references public.threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  read_at timestamptz not null default clock_timestamp(),
  primary key (thread_id, user_id)
);

create index thread_reads_user on public.thread_reads (user_id);

alter table public.thread_reads enable row level security;

create policy "each person reads their own marks"
  on public.thread_reads for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete, truncate on public.thread_reads from anon, authenticated;

/** Marks a thread the person may see as read up to now. */
create function public.mark_thread_read(target_thread uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.threads;
begin
  select * into t from public.threads x where x.id = target_thread;
  if not found or public.thread_level(target_thread) = 'none' then
    raise exception 'thread not found' using errcode = 'P0002';
  end if;
  insert into public.thread_reads (thread_id, user_id, org_id, read_at)
  values (t.id, auth.uid(), t.org_id, clock_timestamp())
  on conflict (thread_id, user_id) do update set read_at = clock_timestamp();
end;
$$;

revoke execute on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;

/**
 * The threads of an organisation the person may see, newest first, each with
 * its last message and whether someone else wrote after the person last read
 * it. Runs as the caller, so the policies on threads and messages decide.
 * `target_agent` narrows it to one agent.
 */
create function public.my_threads(target_org uuid, target_agent uuid default null)
returns table (
  id uuid,
  agent_id uuid,
  title text,
  created_at timestamptz,
  last_message_at timestamptz,
  last_author text,
  last_text text,
  unread boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.agent_id, t.title, t.created_at, t.last_message_at,
         lm.author_name, lm.text,
         coalesce(lm.author_user is distinct from auth.uid() and lm.created_at > coalesce(r.read_at, '-infinity'), false)
  from public.threads t
  left join public.thread_reads r on r.thread_id = t.id and r.user_id = auth.uid()
  left join lateral (
    select m.author_name, m.author_user, m.created_at,
           (select string_agg(p->>'text', ' ') from jsonb_array_elements(m.parts) p where p->>'type' = 'text') as text
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

-- Agents answer in the team chat (docs/plans/ongoing/team-chat.md, step 3).
-- The engine writes an agent's reply as it is written: one message that starts
-- «working» with a line of what it is doing, grows its text, and ends «done»
-- (or «failed»). Everyone in the thread watches it through Realtime.

alter table public.messages
  add column state text not null default 'done' check (state in ('working', 'done', 'failed')),
  -- What the agent did, in plain words, one line per step («Leyendo la conversación»).
  add column steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  add column finished_at timestamptz;

-- One reply at a time per thread: a second request while one is being written
-- fails to insert, so two people writing at once don't get two answers.
create unique index messages_one_working_per_thread on public.messages (thread_id) where state = 'working';

-- The level of any member on an agent, for the engine (service role), which
-- acts with the rights of the person who asked. agent_level() is the same rule
-- for the signed-in person.
create function public.agent_level_for(target_agent uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.role = 'owner' then 'talk'
      else coalesce(x.level, a.member_default)
    end
    from public.agents a
    join public.memberships m on m.org_id = a.org_id and m.user_id = member
    left join public.agent_access x on x.agent_id = a.id and x.user_id = member
    where a.id = target_agent
  ), 'none');
$$;

revoke execute on function public.agent_level_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_level_for(uuid, uuid) to service_role;

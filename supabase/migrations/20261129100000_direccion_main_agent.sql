-- The main agent becomes Dirección (docs/plans/ongoing/direccion-main-agent.md):
-- one agent leads every organisation, answers in chat and launches itself on
-- our runner for what needs real work. Here: its name and slug, and the brief a
-- run is launched with.

-- What a run was asked to do, when an agent launched it with a brief: the main
-- agent itself (trabajar_a_fondo) or another agent it brought in
-- (encargar_a_agente). The run's prompt shows it besides the conversation.
alter table public.agent_runs add column brief text check (length(brief) <= 8000);

-- Every main agent still called Secretaría becomes Dirección, and so does its
-- chat's title (the chat is titled with its agent's name). Not where the
-- organisation already has an agent called Dirección (Órdago's, on our runner):
-- that one becomes the main agent by hand (the plan's «Órdago» step).
with renamed as (
  update public.agents a
  set name = 'Dirección'
  where a.is_main
    and a.name = 'Secretaría'
    and not exists (select 1 from public.agents x where x.org_id = a.org_id and x.id <> a.id and x.name = 'Dirección')
  returning a.id
)
update public.threads t
set title = 'Dirección'
from renamed r
where t.agent_id = r.id;

-- Its slug stays: its own memory lives under it (agents_fill_slug gave every
-- agent one). A new main agent gets `direccion` from its name, or the next
-- free one.

-- As in 20261126300000_main_agent.sql, hired as Dirección.
create or replace function public.hire_main_agent(target_org uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.agents (org_id, name, ghost, department, created_by, member_default, is_main)
  -- The name repeats MAIN_AGENT_NAME in packages/shared: change both together.
  select o.id, 'Dirección', 'secretaria', 'direccion', o.created_by, 'talk', true
  from public.organizations o where o.id = target_org
  returning id;
$$;

revoke execute on function public.hire_main_agent(uuid) from public, anon, authenticated;

/**
 * A finished message from an agent in a given chat: the answer of a run the
 * main agent launched from that chat (delegation.ts), which holds no «working»
 * message meanwhile so the chat stays free. The agent and the chat must be of
 * the same organisation. Returns the message's id. For the engine (service role).
 */
create function public.post_in_thread(target_thread uuid, target_agent uuid, body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
  t public.threads;
  msg public.messages;
begin
  select * into a from public.agents x where x.id = target_agent;
  select * into t from public.threads x where x.id = target_thread;
  if a.id is null or t.id is null or a.org_id <> t.org_id then
    raise exception 'agent or chat not found' using errcode = 'P0002';
  end if;
  if nullif(trim(body), '') is null then
    raise exception 'a message is required' using errcode = '22023';
  end if;
  insert into public.messages (thread_id, org_id, author_kind, author_agent, author_name, parts, state, finished_at)
  values (t.id, t.org_id, 'agent', a.id, a.name, jsonb_build_array(jsonb_build_object('type', 'text', 'text', body)), 'done', clock_timestamp())
  returning * into msg;
  update public.threads set last_message_at = msg.created_at where id = t.id;
  return msg.id;
end;
$$;

revoke execute on function public.post_in_thread(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.post_in_thread(uuid, uuid, text) to service_role;

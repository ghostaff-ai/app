-- «Preguntar» on a decision (docs/plans/ready/decision-model.md, decision 7):
-- the person writes to the agent that asked, in their own chat with it, and the
-- message carries the decision quoted above their words, so the agent answers
-- knowing which one. Same rights as chat_with: you must be able to talk to
-- that agent, and the decision must be of your organisation.

create function public.ask_about_decision(target_decision uuid, body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.decisions;
  a public.agents;
  chat uuid;
  me text;
  clean text := trim(body);
  msg public.messages;
begin
  select * into d from public.decisions x where x.id = target_decision;
  if not found or not public.is_member(d.org_id) then
    raise exception 'decision not found' using errcode = 'P0002';
  end if;
  select * into a from public.agents x where x.id = d.agent_id and x.org_id = d.org_id;
  if not found then
    raise exception 'no agent to ask about this decision' using errcode = '22023';
  end if;
  if public.agent_level(a.id) <> 'talk' then
    raise exception 'you may not talk to this agent' using errcode = '42501';
  end if;
  if nullif(clean, '') is null or length(clean) > 8000 then
    raise exception 'a message of up to 8000 characters is required' using errcode = '22023';
  end if;

  insert into public.threads (org_id, agent_id, title, created_by, personal_of)
  values (a.org_id, a.id, a.name, auth.uid(), auth.uid())
  on conflict (agent_id, personal_of) where personal_of is not null do nothing;
  select t.id into chat from public.threads t where t.agent_id = a.id and t.personal_of = auth.uid();
  select m.display_name into me from public.memberships m where m.org_id = a.org_id and m.user_id = auth.uid();

  insert into public.messages (thread_id, org_id, author_kind, author_user, author_name, parts)
  values (chat, a.org_id, 'person', auth.uid(), me, jsonb_build_array(
    jsonb_build_object('type', 'decision_quote', 'decisionId', d.id, 'question', d.question),
    jsonb_build_object('type', 'text', 'text', clean)))
  returning * into msg;
  update public.threads set last_message_at = msg.created_at where id = chat;
  return msg;
end;
$$;

revoke execute on function public.ask_about_decision(uuid, text) from public, anon;
grant execute on function public.ask_about_decision(uuid, text) to authenticated;

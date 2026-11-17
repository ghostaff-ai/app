-- The parts of a decision the app lays out in fixed places, from the optional
-- por-decidir fields (ordago-app/business por-decidir/README.md, «Los campos
-- opcionales»), and taking back an answer the agent does not have yet
-- (docs/plans/ongoing/app-design.md).

alter table public.decisions
  add column recommendation text,   -- `recomienda`: the OK button's label
  add column if_yes text,           -- `con_si`
  add column if_no text,            -- `con_no`
  add column quote text,            -- `cita`
  add column sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'), -- `fuentes`: [{ text, link? }]
  add column due_on date;           -- `vence`

-- The app's answer stays changeable until the sync has written it into the
-- record, where the agent reads it. Only the person who gave it can take it
-- back, and only while it is still theirs alone.
create function public.unanswer_decision(decision_id uuid)
returns public.decisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.decisions;
begin
  select * into d from public.decisions where id = decision_id for update;
  if not found or not public.is_member(d.org_id) then
    raise exception 'decision not found' using errcode = 'P0002';
  end if;
  if d.answer is null then
    raise exception 'decision not answered' using errcode = '22023';
  end if;
  if d.answer_source <> 'app' or d.written_back_at is not null or d.closed_at is not null then
    raise exception 'the agent already has the answer' using errcode = '22023';
  end if;
  if d.answered_by is distinct from auth.uid() then
    raise exception 'only who answered can take it back' using errcode = '42501';
  end if;

  update public.decisions set
    answer = null,
    answered_by = null,
    answered_by_name = null,
    answered_at = null,
    answer_note = null,
    answer_text = null,
    answer_source = null
  where id = decision_id
  returning * into d;

  return d;
end;
$$;

revoke execute on function public.unanswer_decision(uuid) from public, anon;
grant execute on function public.unanswer_decision(uuid) to authenticated;

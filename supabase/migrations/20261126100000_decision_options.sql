-- The decision model (docs/plans/ready/decision-model.md, decisions 2–4): a
-- decision offers 2 or 3 options with one marked as the agent's pick, may be
-- marked high-stakes, and points at the agent row that asked. All of it comes
-- from the record's por-decidir files (ordago-app/business por-decidir/README.md,
-- «Opciones en vez de sí o no»); a yes-or-no decision keeps `options` empty.
--
-- `answer` stays ok/no, and ok means «took the agent's pick»: what the record's
-- history and earned autonomy count. With options, `answer_option` says which.

alter table public.decisions
  -- [{ id, text, if? }]: `opciones` with `texto` and `con`.
  add column options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 3),
  -- `recomienda` when there are options: the id of the agent's pick.
  add column recommended_option text,
  -- `importancia: alta`.
  add column high_stakes boolean not null default false,
  -- The agent that asked, matched from `propone` by the sync; null when no agent row matches.
  add column agent_id uuid references public.agents (id) on delete set null,
  add column answer_option text,
  add constraint decisions_options_pick check (
    (jsonb_array_length(options) = 0 and recommended_option is null)
    or (jsonb_array_length(options) >= 2 and recommended_option is not null)
  ),
  add constraint decisions_answer_option check (answer_option is null or answer is not null);

create index decisions_agent_id_idx on public.decisions (agent_id) where agent_id is not null;

-- The answer with an option. `option_id` names one of the decision's options;
-- `answer` is then worked out (ok for the pick, no for any other). An app from
-- before options sends only ok or no: ok takes the pick, no leaves the option empty.
drop function public.answer_decision(uuid, text, text, text);

create function public.answer_decision(
  decision_id uuid,
  answer text default null,
  note text default null,
  signed_text text default null,
  option_id text default null
)
returns public.decisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.decisions;
  signer text;
  chosen_answer text := answer;
  chosen_option text := nullif(trim(option_id), '');
begin
  select * into d from public.decisions where id = decision_id for update;
  if not found or not public.is_member(d.org_id) then
    -- Same error either way: a non-member learns nothing about the row.
    raise exception 'decision not found' using errcode = 'P0002';
  end if;

  if chosen_option is not null then
    if not exists (select 1 from jsonb_array_elements(d.options) o where o->>'id' = chosen_option) then
      raise exception 'not one of the options' using errcode = '22023';
    end if;
    chosen_answer := case when chosen_option = d.recommended_option then 'ok' else 'no' end;
    if answer is not null and answer <> chosen_answer then
      raise exception 'ok is the recommended option, no any other' using errcode = '22023';
    end if;
  elsif jsonb_array_length(d.options) > 0 and chosen_answer = 'ok' then
    chosen_option := d.recommended_option;
  end if;

  if chosen_answer is null or chosen_answer not in ('ok', 'no') then
    raise exception 'answer must be ok or no' using errcode = '22023';
  end if;
  if d.closed_at is not null then
    raise exception 'decision is closed' using errcode = '22023';
  end if;
  if d.answer is not null then
    raise exception 'decision already answered' using errcode = '22023';
  end if;

  if length(coalesce(note, '')) > 2000 or length(coalesce(signed_text, '')) > 2000 then
    raise exception 'note too long' using errcode = '22001';
  end if;
  if nullif(trim(signed_text), '') is not null and d.kind <> 'regla' then
    raise exception 'only a rule carries signed text' using errcode = '22023';
  end if;
  if d.kind = 'regla' and chosen_answer = 'ok' and nullif(trim(signed_text), '') is null then
    raise exception 'a rule is signed with its text' using errcode = '22023';
  end if;

  select m.display_name into signer
  from public.memberships m
  where m.org_id = d.org_id and m.user_id = auth.uid();

  update public.decisions set
    answer = chosen_answer,
    answer_option = chosen_option,
    answered_by = auth.uid(),
    answered_by_name = signer,
    answered_at = now(),
    answer_note = nullif(trim(note), ''),
    answer_text = case when chosen_answer = 'ok' then nullif(trim(signed_text), '') end,
    answer_source = 'app',
    written_back_at = null
  where id = decision_id
  returning * into d;

  return d;
end;
$$;

revoke execute on function public.answer_decision(uuid, text, text, text, text) from public, anon;
grant execute on function public.answer_decision(uuid, text, text, text, text) to authenticated;

-- Taking an answer back also takes back the option.
create or replace function public.unanswer_decision(decision_id uuid)
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
    answer_option = null,
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

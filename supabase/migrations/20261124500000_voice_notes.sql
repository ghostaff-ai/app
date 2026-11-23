-- Voice notes in the chat (docs/plans/ongoing/voice.md): a person records an
-- audio in their chat with an agent, it is kept so it can be played back, and
-- its transcript is what the agent reads.
--
-- The audio lives in a private bucket of this project (Frankfurt: invariant 2),
-- at <org_id>/<thread_id>/<message_id>.<ext>. Only the engine writes there,
-- with the service role: there is no insert, update or delete policy, so a
-- person can't write through the Storage API (rule 2). A person hears a note
-- when they may read its thread, which thread_level decides as everywhere
-- else: never someone else's personal chat, nothing across organisations.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-notes', 'voice-notes', false, 10485760, array['audio/*'])
on conflict (id) do nothing;

/** Whether the signed-in person may hear the voice note stored at `object_name`. */
create function public.can_hear_voice_note(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
      then public.thread_level(split_part(object_name, '/', 2)::uuid) <> 'none'
    else false
  end;
$$;

revoke execute on function public.can_hear_voice_note(text) from public, anon;
grant execute on function public.can_hear_voice_note(text) to authenticated;

create policy "people hear the voice notes of threads they may read"
  on storage.objects for select to authenticated
  using (bucket_id = 'voice-notes' and public.can_hear_voice_note(name));

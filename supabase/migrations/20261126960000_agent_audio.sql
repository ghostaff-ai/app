-- Audio from an agent (docs/plans/ongoing/agent-audio.md): an mp3 or m4a an
-- agent made in its run on our runner, played in the agent's chat with the
-- voice notes' player.
--
-- The runner uploads each before it reports (POST /runs/:id/audio); the run
-- keeps them here until its report posts them in the chat, or the tick closes
-- a run that never reported and removes them. Each entry: { path, mediaType,
-- title }, the path in the «voice-notes» bucket at
-- <org_id>/<thread_id>/<message_id>.<ext>, so the read policy by the message's
-- chat (can_hear_voice_note) covers it as it is. Only the engine reads it:
-- authenticated has a grant per column on agent_runs, and none for this one.

alter table public.agent_runs
  add column audio jsonb not null default '[]'::jsonb check (jsonb_typeof(audio) = 'array');

-- An episode is larger than a voice note: 25 MB for the bucket, while the
-- engine keeps voice notes to their own 10 MB (transcribe.ts).
update storage.buckets set file_size_limit = 26214400 where id = 'voice-notes';

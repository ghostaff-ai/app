-- An agent's instructions are a file of its organisation's record, agentes/<slug>/AGENTS.md
-- (docs/plans/ready/agent-memory.md, «The agent's instructions live beside its memory»).
--
-- The engine's sync reads the file on every tick and keeps `agents.task` as its projection, for
-- the chat and the app; our runner reads the file itself from its clone. `task_in_record` says
-- which master `task` has: true while the record has the file, false while `task` is the row's own
-- (an agent imported from a YAML, or an organisation whose record has no file for it yet). When the
-- file goes, `task` keeps its last projection and becomes the row's own again.

alter table public.agents
  add column task_in_record boolean not null default false;

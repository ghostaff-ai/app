-- Our own record store (docs/plans/ongoing/record-store.md).
--
-- An organisation's record is either a repo in our Forgejo, made by the engine
-- with the organisation (`ghostaff`, `record_repo` = `records/<org id>`), or a
-- repo it brings on GitHub as master, reached through our GitHub App
-- (`github`: Órdago while it migrates). Members read it as before; only the
-- service role sets it (record_connector.test.sql).

alter table public.organizations
  add column record_host text check (record_host in ('github', 'ghostaff'));

update public.organizations set record_host = 'github' where record_repo is not null;

alter table public.organizations drop constraint organizations_record_complete;
alter table public.organizations add constraint organizations_record_complete check (
  (record_host is null and record_repo is null and record_installation is null)
  or (record_host = 'github' and record_repo is not null and record_installation is not null)
  or (record_host = 'ghostaff' and record_repo is not null and record_installation is null)
);

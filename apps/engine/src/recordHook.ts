// The pre-receive hook of one organisation's record in our record store
// (docs/plans/ongoing/record-store.md, decision 3): what each agent may push, checked by Forgejo
// itself, by pusher, so it holds even when an agent gets past the runner's guard. The engine writes it
// whole whenever the organisation's agents change; a person never edits it.
//
// The rules (docs/plans/ready/agent-memory.md):
// - the engine, Forgejo's admin, writes anything: it writes for people, after their OK;
// - no agent changes an `AGENTS.md`: instructions change only through an owner;
// - `memoria/empresa/` only the main agent may push there, once it runs on our runner (today it is a
//   chat agent, so no agent can: people change it from Ghostaff);
// - in `memoria/agentes/`, each agent only its own folder;
// - `externos/` no agent: who the organisation works with is added or confirmed by a person
//   (external-parties.md, decision 1); an agent proposes one with a settings tool;
// - only `main`, never deleted.
//
// POSIX sh: Forgejo's image is Alpine (busybox). Forgejo gives the pusher as GITEA_PUSHER_NAME.

export interface HookAgent {
  /** Its Forgejo user (forgejo.ts agentUsername). */
  username: string;
  /** Its folder under memoria/agentes/. */
  slug: string;
  /** Keeps the company's memory (memoria/empresa/). */
  writesCompany: boolean;
}

const SAFE_USER = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const SAFE_SLUG = /^[a-z][a-z0-9_-]{0,40}$/; // agents.slug's own check

export function preReceiveHook(adminUser: string, agents: HookAgent[]): string {
  if (!SAFE_USER.test(adminUser)) throw new Error(`unsafe admin username: ${adminUser}`);
  const cases = agents.map((a) => {
    if (!SAFE_USER.test(a.username) || !SAFE_SLUG.test(a.slug)) throw new Error(`unsafe agent in the record's hook: ${a.username} ${a.slug}`);
    return `  ${a.username}) own=${a.slug}; company=${a.writesCompany ? 'yes' : 'no'} ;;`;
  });
  return `#!/bin/sh
# Written by the Ghostaff engine (apps/engine/src/recordHook.ts); it rewrites this file whole.
zero=0000000000000000000000000000000000000000
deny() { echo "Registro: $1" >&2; exit 1; }
case "$GITEA_PUSHER_NAME" in
  ${adminUser}) exit 0 ;;
${cases.join('\n')}
  *) deny "no puedes escribir en este registro." ;;
esac
while read -r old new ref; do
  [ "$ref" = "refs/heads/main" ] || deny "solo se escribe en main ($ref)."
  [ "$new" = "$zero" ] && deny "main no se borra."
  if [ "$old" = "$zero" ]; then
    changed=$(git -c core.quotePath=false ls-tree -r --name-only "$new")
  else
    changed=$(git -c core.quotePath=false diff --no-renames --name-only "$old" "$new")
  fi
  printf '%s\\n' "$changed" | while IFS= read -r f; do
    case "$f" in
      '') ;;
      AGENTS.md|*/AGENTS.md) deny "las instrucciones ($f) solo las cambia una persona desde Ghostaff. Propón el cambio en tu respuesta." ;;
      memoria/empresa/*) [ "$company" = yes ] || deny "la memoria de la empresa ($f) la cambian las personas desde Ghostaff." ;;
      memoria/agentes/"$own"/*) ;;
      memoria/agentes/*) deny "esa memoria ($f) es de otro agente." ;;
      memoria/*) deny "en memoria/ solo escribes en memoria/agentes/$own/ ($f)." ;;
      externos/*) deny "con quién trabaja la organización ($f) lo añade o confirma una persona desde Ghostaff. Propónlo en tu respuesta." ;;
    esac
  done || exit 1
done
exit 0
`;
}

// Links a person types, made into ones that open. On their own so any service can use them
// without importing services/index.ts (externalParties.ts would otherwise make a require cycle).

/** `ana.example`, `https://ana.example/` → `https://ana.example/`; empty stays empty. */
export function normalizeLink(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
}

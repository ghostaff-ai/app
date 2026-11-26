// Gives the organisation named COMPANY (or OWNER_NAME's personal space) two stand-in AI accounts, an Anthropic
// key and then a Claude subscription, written straight into the local Supabase
// with its service-role key, so the flow can get past the step that asks an
// owner to connect an AI account (conectar-ia) and then reorder them in
// Conexiones. No real key exists in e2e and no engine runs, so only the rows
// the app reads are made. A space that already has an AI account is left as
// it is: the seeded company (scripts/e2e/seed.sh) is shared by two flows.
// Runs on the host, in Maestro's JavaScript.
const base = SUPABASE_URL || 'http://127.0.0.1:54321';
const headers = { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
// A company by its name (COMPANY), or a personal space by its owner's name
// (OWNER_NAME): every personal space is called «Personal».
const personal = typeof OWNER_NAME !== 'undefined' && OWNER_NAME;
const orgs = personal
  ? json(
      http.get(
        base +
          '/rest/v1/memberships?select=id:org_id,organizations!inner(kind)&role=eq.owner&organizations.kind=eq.personal&display_name=eq.' +
          encodeURIComponent(OWNER_NAME),
        { headers: headers },
      ).body,
    )
  : json(http.get(base + '/rest/v1/organizations?select=id&name=eq.' + encodeURIComponent(COMPANY), { headers: headers }).body);
if (!orgs || orgs.length !== 1)
  throw new Error('Expected one space for ' + (personal ? OWNER_NAME : COMPANY) + ', got ' + JSON.stringify(orgs));
const already = json(
  http.get(base + '/rest/v1/connections?select=id&kind=eq.ai&org_id=eq.' + orgs[0].id, { headers: headers }).body,
);
// One at a time: each goes last in the order (the key 1st, the subscription 2nd).
(already.length ? [] : [
  { provider: 'anthropic', method: 'api_key', hint: 'e2e0' },
  { provider: 'claude', method: 'subscription', hint: 'e2e1' },
]).forEach(function (c) {
  const res = http.post(base + '/rest/v1/connections', {
    headers: headers,
    body: JSON.stringify({ org_id: orgs[0].id, kind: 'ai', provider: c.provider, method: c.method, hint: c.hint, connected_by_name: 'E2E' }),
  });
  if (res.status !== 201) throw new Error('Could not add the connection: ' + res.status + ' ' + res.body);
});

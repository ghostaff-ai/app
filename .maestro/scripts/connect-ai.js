// Gives the organisation named COMPANY two stand-in AI accounts, an Anthropic
// key and then a Claude subscription, written straight into the local Supabase
// with its service-role key, so the flow can get past the step that asks an
// owner to connect an AI account (conectar-ia) and then reorder them in
// Conexiones. No real key exists in e2e and no engine runs, so only the rows
// the app reads are made. Runs on the host, in Maestro's JavaScript.
const base = SUPABASE_URL || 'http://127.0.0.1:54321';
const headers = { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const orgs = json(http.get(base + '/rest/v1/organizations?select=id&name=eq.' + encodeURIComponent(COMPANY), { headers: headers }).body);
if (!orgs || orgs.length !== 1) throw new Error('Expected one organisation named ' + COMPANY + ', got ' + JSON.stringify(orgs));
// One at a time: each goes last in the order (the key 1st, the subscription 2nd).
[
  { provider: 'anthropic', method: 'api_key', hint: 'e2e0' },
  { provider: 'claude', method: 'subscription', hint: 'e2e1' },
].forEach(function (c) {
  const res = http.post(base + '/rest/v1/connections', {
    headers: headers,
    body: JSON.stringify({ org_id: orgs[0].id, kind: 'ai', provider: c.provider, method: c.method, hint: c.hint, connected_by_name: 'E2E' }),
  });
  if (res.status !== 201) throw new Error('Could not add the connection: ' + res.status + ' ' + res.body);
});

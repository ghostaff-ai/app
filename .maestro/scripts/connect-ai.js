// Gives the organisation named COMPANY a stand-in Anthropic key, written straight
// into the local Supabase with its service-role key, so the flow can get past
// the step that asks an owner to connect an AI account (conectar-ia). No real
// key exists in e2e and no engine runs, so only the row the app reads is made.
// Runs on the host, in Maestro's JavaScript.
const base = SUPABASE_URL || 'http://127.0.0.1:54321';
const headers = { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const orgs = json(http.get(base + '/rest/v1/organizations?select=id&name=eq.' + encodeURIComponent(COMPANY), { headers: headers }).body);
if (!orgs || orgs.length !== 1) throw new Error('Expected one organisation named ' + COMPANY + ', got ' + JSON.stringify(orgs));
const res = http.post(base + '/rest/v1/connections', {
  headers: headers,
  body: JSON.stringify({ org_id: orgs[0].id, kind: 'ai', provider: 'anthropic', method: 'api_key', hint: 'e2e0', connected_by_name: 'E2E' }),
});
if (res.status !== 201) throw new Error('Could not add the connection: ' + res.status + ' ' + res.body);

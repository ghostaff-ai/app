// The agent's answer in team-chat.yaml. No engine runs in e2e, so this writes
// the reply the way the engine leaves a finished one (apps/engine/src/chatStore.ts:
// an agent message, state done, the conversation's last_message_at touched),
// into the conversation that holds the person's message MESSAGE in the company
// COMPANY, with the local Supabase's service-role key. The app has to show it
// live, through Realtime. It finds the conversation only by that message, so it
// holds however conversations are kept (group-chat-per-agent.md). Runs on the
// host, in Maestro's JavaScript.
const base = SUPABASE_URL || 'http://127.0.0.1:54321';
const headers = { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const get = function (path) {
  const res = http.get(base + '/rest/v1/' + path, { headers: headers });
  if (res.status !== 200) throw new Error('GET ' + path + ': ' + res.status + ' ' + res.body);
  return json(res.body);
};

const orgs = get('organizations?select=id&name=eq.' + encodeURIComponent(COMPANY));
if (orgs.length !== 1) throw new Error('Expected one company ' + COMPANY + ', got ' + JSON.stringify(orgs));
const org = orgs[0].id;

const sent = get(
  'messages?select=thread_id&author_kind=eq.person&org_id=eq.' + org +
    '&parts=cs.' + encodeURIComponent(JSON.stringify([{ text: MESSAGE }])) +
    '&order=created_at.desc&limit=1',
);
if (sent.length !== 1) throw new Error('No message «' + MESSAGE + '» in ' + COMPANY);
const thread = sent[0].thread_id;
const agent = get('agents?select=id,name&id=eq.' + get('threads?select=agent_id&id=eq.' + thread)[0].agent_id)[0];

const now = new Date().toISOString();
const res = http.post(base + '/rest/v1/messages', {
  headers: headers,
  body: JSON.stringify({
    thread_id: thread,
    org_id: org,
    author_kind: 'agent',
    author_agent: agent.id,
    author_name: agent.name,
    parts: [{ type: 'text', text: REPLY }],
    state: 'done',
    finished_at: now,
  }),
});
if (res.status !== 201) throw new Error('Could not write the reply: ' + res.status + ' ' + res.body);
const touched = http.request(base + '/rest/v1/threads?id=eq.' + thread, {
  method: 'PATCH',
  headers: headers,
  body: JSON.stringify({ last_message_at: now }),
});
if (touched.status !== 204) throw new Error('Could not touch the conversation: ' + touched.status + ' ' + touched.body);

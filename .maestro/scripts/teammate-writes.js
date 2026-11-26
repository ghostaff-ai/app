// A teammate writes in the main agent's chat of the company named COMPANY:
// makes a member (MEMBER_NAME, a confirmed user of MEMBER_EMAIL) and writes
// TEXT as them in that chat, straight into the local Supabase with its
// service-role key. Two people in one chat without a second phone
// (docs/plans/ongoing/group-chat-per-agent.md). Runs on the host, in Maestro's
// JavaScript.
const base = SUPABASE_URL || 'http://127.0.0.1:54321';
const headers = { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const one = (path, what) => {
  const rows = json(http.get(base + path, { headers: headers }).body);
  if (!rows || rows.length !== 1) throw new Error('Expected one ' + what + ', got ' + JSON.stringify(rows));
  return rows[0];
};
const post = (path, body) => {
  const res = http.post(base + path, { headers: headers, body: JSON.stringify(body) });
  if (res.status !== 200 && res.status !== 201) throw new Error('POST ' + path + ': ' + res.status + ' ' + res.body);
  return res.body ? json(res.body) : null;
};

const org = one('/rest/v1/organizations?select=id&name=eq.' + encodeURIComponent(COMPANY), 'company');
const agent = one('/rest/v1/agents?select=id&is_main=eq.true&org_id=eq.' + org.id, 'main agent');
const user = post('/auth/v1/admin/users', { email: MEMBER_EMAIL, email_confirm: true });
post('/rest/v1/memberships', { org_id: org.id, user_id: user.id, role: 'member', display_name: MEMBER_NAME });
const chat = one('/rest/v1/threads?select=id&agent_id=eq.' + agent.id, "agent's chat");
post('/rest/v1/messages', {
  thread_id: chat.id,
  org_id: org.id,
  author_kind: 'person',
  author_user: user.id,
  author_name: MEMBER_NAME,
  parts: [{ type: 'text', text: TEXT }],
});

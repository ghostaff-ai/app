// The 6-digit sign-in code last mailed to EMAIL, read from the local Supabase's
// mail catcher (Mailpit). Runs on the host, in Maestro's JavaScript.
const base = MAILPIT_URL || 'http://127.0.0.1:54324';
const list = json(http.get(base + '/api/v1/search?limit=1&query=' + encodeURIComponent('to:"' + EMAIL + '"')).body);
if (!list.messages || list.messages.length === 0) throw new Error('No code mailed to ' + EMAIL);
const message = json(http.get(base + '/api/v1/message/' + list.messages[0].ID).body);
const match = message.Text.match(/\b(\d{6})\b/);
if (!match) throw new Error('No 6-digit code in the mail to ' + EMAIL);
output.code = match[1];

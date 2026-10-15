// The appeal engine: forms are cut down to the limits, answers are validated, punishments are shown as the server wants,
// and a submission goes through post -> reply -> accept (lifting what was appealed) -> block after a rejection.
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
function stub(rel, exports) { const r = require.resolve(path.join(root, rel)); require.cache[r] = { id: r, filename: r, loaded: true, exports }; }

const store = { submissions: new Map(), messages: [], blocks: new Map(), forms: new Map(), config: {}, named: [], cleared: [], lastAt: {} };
let nextId = 1;
const dbStub = {
  getConfig: async () => ({ enabled: true, punishment_types: ['ban', 'mute', 'warn'], punishment_details: ['reason', 'duration'], punishment_source: 'both', warns_max_age_days: 30, anonymous_messages: false, allow_replies: true, submission_channel_id: 'C1', log_channel_id: 'L1', auto_thread: true, thread_name: 'Appeal by {username}', ping_role_ids: ['R1'], messages: {}, ...store.config }),
  getForm: async (_g, id) => store.forms.get(Number(id)) ?? null,
  getSubmission: async (_g, id) => store.submissions.get(id) ?? null,
  createSubmission: async (row) => { const r = { ...row, id: `sub-${nextId++}`, status: 'pending' }; store.submissions.set(r.id, r); return r; },
  updateSubmission: async (id, patch) => Object.assign(store.submissions.get(id), patch),
  resolveSubmission: async (id, patch) => { const r = store.submissions.get(id); if (!r || r.status !== 'pending') return null; return Object.assign(r, patch); },
  countPending: async (_g, u, f) => [...store.submissions.values()].filter((s) => s.user_id === u && s.form_id === f && s.status === 'pending').length,
  addMessage: async (row) => { store.messages.push(row); return row; },
  getBlock: async (g, u) => store.blocks.get(`${g}:${u}`) ?? null,
  setBlock: async (g, u, until, reason) => { store.blocks.set(`${g}:${u}`, { until, reason }); },
  deleteResolvedBefore: async () => 0, listEnabledConfigs: async () => [],
  deleteExpiredReservations: async () => 0, listNamed: async () => store.named, clearSlug: async (g) => { store.cleared.push(g); }, lastSubmissionAt: async (g) => store.lastAt[g] ?? null,
};
stub('src/db/appeals.js', dbStub);
const lifted = [];
stub('src/db/modActions.js', { getUserHistory: async () => [
  { type: 'tempban', case_number: 7, active: true, reason: 'spam', expires_at: new Date(Date.now() + 86400000).toISOString(), created_at: new Date().toISOString(), moderator_id: '999' },
  { type: 'warn', case_number: 5, active: true, reason: 'old', created_at: new Date(Date.now() - 90 * 86400000).toISOString() },
  { type: 'kick', case_number: 4, active: true, created_at: new Date().toISOString() },
  { type: 'mute', case_number: 3, active: false, created_at: new Date().toISOString() },
] });
stub('src/utils/sanctionLift.js', { isLiftable: (r) => r.type === 'tempban' && r.active, liftSanction: async (_g, n) => { lifted.push(n); } });
stub('src/db/hardBans.js', { getHardBan: async () => null });
stub('src/db/database.js', { from: () => ({ delete: () => ({ eq: () => Promise.resolve({}) }) }) });
const A = require(path.join(root, 'src/utils/appeals.js'));

(async () => {
  // Forms are cut down.
  const form = A.normalizeForm({
    name: '  Ban appeal  ', status: 'live', requirement_types: ['ban', 'nope'], block_on_reject: 'week', generate_invite: true,
    sections: [{ title: 'About', questions: [
      { type: 'paragraph', label: 'Why were you banned?', required: true },
      { type: 'choice', label: 'Pick', options: ['a', 'b', 'a'] },
      { type: 'choice', label: 'Broken', options: ['only one'] },
      { type: 'weird', label: 'Fallback type' },
      { type: 'short', label: '' },
    ] }, ...Array.from({ length: 9 }, (_, i) => ({ title: `S${i}`, questions: [] }))],
  });
  assert.equal(form.name, 'Ban appeal');
  assert.deepEqual(form.requirement_types, ['ban']);
  assert.equal(form.sections.length, A.LIMITS.sections);
  const qs = form.sections[0].questions;
  assert.deepEqual(qs.map((q) => q.type), ['paragraph', 'choice', 'short'], 'a broken choice and an empty label are dropped, a strange type becomes short');
  assert.deepEqual(qs[1].options, ['a', 'b']);
  assert.equal(new Set(qs.map((q) => q.id)).size, qs.length, 'ids are unique');
  form.id = 1; store.forms.set(1, form);

  // Answers.
  const ok = A.validateAnswers(form, { [qs[0].id]: '  I was wrong  ', [qs[1].id]: 'a', [qs[2].id]: 'x' });
  assert.ok(ok.ok); assert.equal(ok.answers[0].value, 'I was wrong');
  assert.equal(A.validateAnswers(form, {}).errors[qs[0].id], 'required');
  assert.equal(A.validateAnswers(form, { [qs[0].id]: 'x', [qs[1].id]: 'zzz', [qs[2].id]: 'x' }).errors[qs[1].id], 'invalid');

  // Messages.
  assert.equal(A.renderTemplate('Hi {username} from {server}. {reason}', { username: 'Liam', server: 'Petto' }), 'Hi Liam from Petto.');

  // Punishments follow the server: only active, no old warns, no kicks, details cut.
  const guild = fakeGuild();
  const config = await dbStub.getConfig();
  const rows = await A.fetchPunishments(guild, 'U1', config);
  assert.deepEqual(rows.map((r) => r.type), ['ban'], 'the old warn, the kick and the ended mute are left out, the ban is not doubled by Discord');
  const shown = A.shapePunishment(rows[0], { ...config, punishment_details: ['reason'] });
  assert.equal(shown.reason, 'spam'); assert.equal('until' in shown, false); assert.equal('moderator' in shown, false);
  assert.ok(A.meetsRequirement(form, rows.map((r) => A.shapePunishment(r, config))));
  assert.ok(!A.meetsRequirement(form, []));

  // A submission goes to the staff channel with buttons, a thread and the pings.
  const user = { id: 'U1', username: 'liam', avatarUrl: null };
  const client = fakeClient();
  const result = await A.submitAppeal({ client, guild, config, form, user, rawAnswers: { [qs[0].id]: 'I was wrong', [qs[1].id]: 'b', [qs[2].id]: 'x' } });
  assert.ok(result.ok, JSON.stringify(result));
  const sent = guild.sent.find((m) => m.channel === 'C1');
  assert.ok(sent.payload.components.length === 2 && sent.payload.content === undefined && JSON.stringify(sent.payload.components[0].toJSON()).includes('<@&R1>'), 'a Components V2 message has no content; the ping is in the card');
  assert.equal(store.submissions.get(result.submission.id).thread_id, 'T1');
  assert.equal((await A.submitAppeal({ client, guild, config, form, user, rawAnswers: { [qs[0].id]: 'again' } })).error, 'already_pending');
  assert.equal((await A.submitAppeal({ client, guild, config, form: { ...form, status: 'draft' }, user, rawAnswers: {} })).error, 'form_unavailable');
  assert.equal((await A.submitAppeal({ client, guild, config: { ...config, enabled: false }, form, user, rawAnswers: {} })).error, 'disabled');

  // The member writes, the staff answers (anonymous when the server wants).
  assert.ok((await A.userReply({ guild, config, submission: result.submission, content: 'please' })).ok);
  assert.equal((await A.userReply({ guild, config: { ...config, allow_replies: false }, submission: result.submission, content: 'x' })).error, 'replies_off');
  store.config.anonymous_messages = true;
  const reply = await A.staffReply({ client, guild, submission: result.submission, content: 'We are checking', moderatorId: 'M1', moderatorName: 'Mod' });
  assert.ok(reply.ok && store.messages.at(-1).anonymous === true);
  assert.ok(client.dms.at(-1).text.includes('Staff') && !client.dms.at(-1).text.includes('Mod\n'), 'the DM hides the moderator when anonymous');

  // Accepting lifts the ban and gives an invite; resolving twice is refused.
  const accepted = await A.resolveAppeal({ client, guild, submission: result.submission, status: 'accepted', moderatorId: 'M1', reason: 'Welcome back' });
  assert.ok(accepted.ok); assert.deepEqual(lifted, [7]); assert.ok(accepted.invite && accepted.invite.includes('discord.gg'));
  assert.equal((await A.resolveAppeal({ client, guild, submission: result.submission, status: 'rejected', moderatorId: 'M2' })).error, 'already_resolved');
  assert.ok(client.dms.some((d) => d.text.includes('Welcome back')));

  // Rejecting blocks for the time the form says.
  store.submissions.clear();
  const second = await A.submitAppeal({ client, guild, config, form, user, rawAnswers: { [qs[0].id]: 'try', [qs[1].id]: 'a', [qs[2].id]: 'x' } });
  const rejected = await A.resolveAppeal({ client, guild, submission: second.submission, status: 'rejected', moderatorId: 'M1', reason: 'No' });
  assert.ok(rejected.ok);
  const block = store.blocks.get('G1:U1');
  assert.ok(block && Date.parse(block.until) > Date.now() + 6 * 86400000, 'blocked for a week');
  assert.equal((await A.submitAppeal({ client, guild, config, form, user, rawAnswers: {} })).error, 'blocked');
  assert.equal(A.blockUntil('forever'), null); assert.equal(A.blockUntil('none'), undefined);
  assert.equal(A.siteLink('123'), 'https://petto.sbs/appeal/123'); assert.equal(A.siteLink('123', 'amor'), 'https://petto.sbs/appeal/amor');
  // Link names nobody uses are freed; the ones in use are kept.
  const day = 86_400_000; const now = Date.now();
  store.named = [
    { guild_id: 'A', slug: 'off-old', enabled: false, updated_at: new Date(now - 40 * day).toISOString() },
    { guild_id: 'B', slug: 'off-new', enabled: false, updated_at: new Date(now - 5 * day).toISOString() },
    { guild_id: 'C', slug: 'idle', enabled: true, updated_at: new Date(now - 120 * day).toISOString() },
    { guild_id: 'D', slug: 'busy', enabled: true, updated_at: new Date(now - 120 * day).toISOString() },
    { guild_id: 'E', slug: 'gone', enabled: true, updated_at: new Date(now).toISOString() },
  ];
  store.lastAt = { D: new Date(now - 10 * day).toISOString() };
  const live = { isReady: () => true, guilds: { cache: new Map([['A', 1], ['B', 1], ['C', 1], ['D', 1], ['Z', 1]]), fetch: async () => { const e = new Error('Unknown Guild'); e.code = 10004; throw e; } } };
  const freed = await A.releaseIdleNames(live, now);
  assert.deepEqual(freed.map((f) => `${f.slug}:${f.reason}`).sort(), ['gone:left', 'idle:idle', 'off-old:off']);
  assert.deepEqual(store.cleared.sort(), ['A', 'C', 'E']);
  console.log('appeals OK');
})().catch((err) => { console.error(err); process.exit(1); });

function fakeGuild() {
  const sent = [];
  const channel = (id) => ({
    id, type: 0, isTextBased: () => true,
    send: async (payload) => { sent.push({ channel: id, payload }); return { id: `M-${sent.length}`, startThread: async () => ({ id: 'T1' }), edit: async () => {} }; },
    messages: { fetch: async () => ({ edit: async () => {} }) },
    createInvite: async () => ({ url: 'https://discord.gg/abc123' }),
  });
  const channels = new Map(['C1', 'L1', 'T1'].map((id) => [id, channel(id)]));
  channels.find = (fn) => [...channels.values()].find(fn);
  return {
    id: 'G1', name: 'Petto Server', sent,
    channels: { cache: channels, fetch: async (id) => channels.get(id) ?? null },
    roles: { cache: new Map([['R1', {}]]) },
    members: { cache: new Map(), fetch: async () => null, unban: async () => {}, me: { permissionsIn: () => ({ has: () => true }) } },
    bans: { fetch: async () => ({ reason: 'from discord' }) },
  };
}
function fakeClient() { const dms = []; return { dms, users: { fetch: async (id) => ({ id, send: async (p) => { dms.push({ id, text: JSON.stringify(p).replace(/\\n/g, '\n') }); } }) } }; }

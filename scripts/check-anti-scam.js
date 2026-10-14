// The anti scam through the message event and its buttons, with Discord and the database replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const stub = (file, exports) => { const p = require.resolve(file); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let config = {};
const events = [];
const cases = [];
const logs = [];
stub('../src/db/scamConfig', { getConfig: async () => config, addEvent: async (e) => { events.push(e); return e; }, countCaught: () => {} });
stub('../src/db/guilds', { ensureGuild: async () => {} });
stub('../src/db/modActions', { createCase: async (c) => { cases.push(c); return { ...c, case_number: cases.length }; } });
stub('../src/utils/caseLog', { logSanction: async (...a) => logs.push(['sanction', a[2].modCase.type]) });
stub('../src/logging/engine', { sendLog: async () => logs.push(['log']) });

const antiScam = require('../src/utils/antiScam');
const checks = require('../src/utils/antiScamChecks');

const base = { enabled: true, action: 'alert', timeout_minutes: 120, delete_messages: true, delete_minutes: 15, channels_threshold: 3, window_seconds: 30, scan_text: true, scan_new_accounts: true, new_account_hours: 72, dm_user: true, alert_channel_id: 'alerts', ping_role_id: 'staffrole', exempt_role_ids: ['vip'], exempt_channel_ids: ['promo'], caught: 0 };
const calls = [];
const sent = [];
const channelFor = (id) => ({ id, parentId: null, isTextBased: () => true, messages: { delete: async (m) => calls.push(['delete', id, m]) }, bulkDelete: async (ids) => calls.push(['bulkDelete', id, ids.length]), send: async (p) => { sent.push([id, p]); return {}; } });
const channels = new Map(['c1', 'c2', 'c3', 'c4', 'alerts', 'promo'].map((id) => [id, channelFor(id)]));
const dms = [];
const guild = {
  id: 'g1', name: 'Petto Server', ownerId: 'owner',
  channels: { cache: channels, fetch: async (id) => channels.get(id) ?? null },
  roles: { cache: new Map([['staffrole', {}], ['vip', {}]]) },
  members: { ban: async (id, o) => calls.push(['ban', id, o.deleteMessageSeconds]), unban: async (id) => calls.push(['unban', id]), fetch: async () => ({ timeout: async (ms) => calls.push(['timeout', ms]) }) },
};
const client = { user: { id: 'petto', username: 'Petto' } };
let n = 0;
function msg(channelId, content, { files = [], userId = 'u1', roles = [], ageHours = 5000, everyone = false } = {}) {
  n += 1;
  const author = { id: userId, bot: false, username: 'hacked', createdTimestamp: Date.now() - ageHours * 3_600_000, send: async (p) => { dms.push(p); } };
  const member = { moderatable: true, kickable: true, bannable: true, roles: { cache: { has: (r) => roles.includes(r) } }, timeout: async (ms) => calls.push(['timeout', ms]), kick: async () => calls.push(['kick']) };
  return { id: `m${n}`, guild, client, channel: channels.get(channelId), author, member, content, mentions: { everyone }, attachments: new Map(files.map((f, i) => [i, f])), delete: async () => calls.push(['own-delete', channelId]) };
}
const reset = () => { calls.length = 0; sent.length = 0; events.length = 0; cases.length = 0; logs.length = 0; dms.length = 0; checks.forget('g1', 'u1'); };
const scam = { name: 'beast-reward.png', size: 91234 };

(async () => {
  // off: nothing at all
  config = { ...base, enabled: false };
  for (const c of ['c1', 'c2', 'c3']) await antiScam.handleMessage(msg(c, 'claim', { files: [scam] }));
  assert.equal(events.length, 0, 'off does nothing');

  // on, only alert: the copies are taken down and the staff is told, nobody is punished
  reset(); config = { ...base };
  await antiScam.handleMessage(msg('c1', 'hola', { files: [scam] }));
  await antiScam.handleMessage(msg('c2', 'hola', { files: [scam] }));
  assert.equal(events.length, 0, 'two channels are not enough');
  await antiScam.handleMessage(msg('c3', 'hola', { files: [scam] }));
  assert.equal(events.length, 1);
  assert.equal(events[0].signal, 'multi-channel');
  assert.equal(events[0].action, 'alert');
  assert.equal(events[0].deleted, 3, 'the three copies are taken down');
  assert.ok(calls.some((c) => c[0] === 'delete' || c[0] === 'bulkDelete'));
  assert.equal(calls.filter((c) => ['ban', 'timeout', 'kick'].includes(c[0])).length, 0, 'only alert punishes nobody');
  assert.equal(dms.length, 0, 'and sends no DM');
  assert.equal(cases.length, 0);
  assert.equal(sent.length, 1, 'the alert goes to the alert channel');
  assert.equal(sent[0][0], 'alerts');
  assert.equal(sent[0][1].content, '<@&staffrole>', 'and pings the role');
  // the copies that keep coming are only deleted
  calls.length = 0;
  await antiScam.handleMessage(msg('c4', 'hola', { files: [scam] }));
  assert.deepEqual(calls.map((c) => c[0]), ['own-delete']);
  assert.equal(events.length, 1, 'and do not raise a new alert');

  // the usual wording from a normal account is caught alone
  reset(); config = { ...base, action: 'timeout' }; n += 1;
  await antiScam.handleMessage(msg('c1', 'MrBeast is giving away $2,500. Claim your reward now! https://beast-reward.xyz', { userId: 'u2' }));
  assert.equal(events[0].signal, 'wording');
  assert.equal(calls.find((c) => c[0] === 'timeout')[1], 120 * 60_000, 'the mute is the minutes of the server');
  assert.equal(dms.length, 1, 'the account is told it may be hacked');
  assert.deepEqual([cases[0].type, cases[0].source], ['tempmute', 'antiscam']);
  assert.ok(logs.some((l) => l[0] === 'sanction'));
  checks.forget('g1', 'u2');

  // ban: the days of messages the server chose are removed with the ban
  reset(); config = { ...base, action: 'ban', delete_minutes: 20 };
  await antiScam.handleMessage(msg('c1', 'MrBeast is giving away $2,500. Claim your reward now! https://beast-reward.xyz', { userId: 'u3' }));
  assert.deepEqual(calls.find((c) => c[0] === 'ban'), ['ban', 'u3', 1200]);
  assert.equal(cases[0].type, 'ban');
  checks.forget('g1', 'u3');

  // normal talk, exempt roles, exempt channels and the owner are never touched
  reset(); config = { ...base, action: 'ban' };
  await antiScam.handleMessage(msg('c1', 'hola, alguien quiere jugar?', { userId: 'u4' }));
  await antiScam.handleMessage(msg('c1', 'MrBeast is giving away $2,500. Claim your reward now!', { userId: 'u5', roles: ['vip'] }));
  await antiScam.handleMessage(msg('promo', 'MrBeast is giving away $2,500. Claim your reward now!', { userId: 'u6' }));
  await antiScam.handleMessage(msg('c1', 'MrBeast is giving away $2,500. Claim your reward now!', { userId: 'owner' }));
  assert.equal(events.length, 0);

  // a new account with a picture and the wording, pinging everyone
  reset(); config = { ...base };
  await antiScam.handleMessage(msg('c1', '@everyone claim your reward', { userId: 'u7', files: [{ name: 'x.png', size: 5 }], ageHours: 3, everyone: true }));
  assert.equal(events[0]?.signal, 'new-account');
  await antiScam.handleMessage(msg('c1', '@everyone claim your reward', { userId: 'u8', files: [{ name: 'y.png', size: 6 }], ageHours: 5000, everyone: true }));
  assert.equal(events.length, 1, 'an old account saying that is not flagged for being new');

  // the buttons
  const press = async (id, perms) => {
    const out = { replies: [], edits: [] };
    await antiScam.handleButton({
      customId: id, guild, user: { id: 'mod', username: 'mod' }, member: { permissions: { has: (p) => perms } },
      message: { components: [{ toJSON: () => ({ type: 17 }) }, { toJSON: () => ({ type: 1 }) }] },
      reply: async (p) => out.replies.push(p), deferUpdate: async () => {}, editReply: async (p) => out.edits.push(p),
    });
    return out;
  };
  calls.length = 0;
  let out = await press('scam::undo::111111111111111111::timeout', true);
  assert.deepEqual(calls[0], ['timeout', null], 'undo lifts the mute');
  assert.equal(out.edits[0].components.length, 2, 'the alert stays and says what was done, without the buttons');
  calls.length = 0;
  await press('scam::undo::111111111111111111::ban', true);
  assert.deepEqual(calls[0], ['unban', '111111111111111111']);
  calls.length = 0;
  await press('scam::ban::111111111111111111::alert', true);
  assert.equal(calls[0][0], 'ban');
  calls.length = 0;
  out = await press('scam::ban::111111111111111111::alert', false);
  assert.equal(calls.length, 0, 'without the permission nothing happens');
  assert.match(out.replies[0].content, /permission/);

  console.log('anti scam ok');
})().catch((err) => { console.error(err); process.exit(1); });

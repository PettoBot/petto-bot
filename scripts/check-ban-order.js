// The order of a ban with the messages of the member deleted: the notice in DM, the ban, "done", the log, and only then the messages are deleted.
// Discord deletes the messages while it sets the ban and that can take a long time, so nothing that the moderator waits for may depend on it.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const stub = (relative, exports) => {
  const file = require.resolve(path.join(__dirname, '..', relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const steps = [];
stub('src/utils/logger.js', { info() {}, warn: (text) => steps.push(`warn:${text}`), error() {} });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/db/modActions.js', { createCase: async () => ({ case_number: 7 }), getActiveSanction: async () => null, deactivateCase: async () => {} });
stub('src/db/hardBans.js', { addHardBan: async () => {}, getHardBan: async () => null, removeHardBan: async () => {}, canLiftHardBan: async () => true, listHardBanIds: async () => [] });
stub('src/utils/permissions.js', { canModerate: () => ({ ok: true }), botCanAct: () => true, permissionLabels: () => '' });
stub('src/utils/caseLog.js', { logSanction: async () => { steps.push('log'); } });
stub('src/utils/dmOrigin.js', { sendDm: async () => { steps.push('dm'); return { id: 'dm1' }; } });
stub('src/utils/sanctionTemplates.js', { sanctionDM: async () => ({ content: 'notice' }), sanctionReply: async () => { steps.push('done'); }, updateSanctionDm: async () => {} });

const ban = require('../src/commands/moderation/ban');

function interaction(days, { failBan = false, duration = null } = {}) {
  const options = { user: { id: '222222222222222222', username: 'spam' }, reason: 'ads', duration, delete_message_days: days };
  return {
    commandName: 'ban', user: { id: '1' }, client: {}, guildId: 'g',
    guild: {
      id: 'g',
      members: {
        fetch: async () => ({ id: '222222222222222222', user: options.user }),
        ban: async (id, opt) => {
          steps.push(`ban:${opt.deleteMessageSeconds ?? 0}`);
          if (failBan) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
          // Discord takes a long time when it has to delete messages: the real ban of the member would wait for it.
          if (opt.deleteMessageSeconds) await new Promise((resolve) => setTimeout(resolve, 80));
        },
      },
    },
    options: {
      getUser: () => options.user, getString: (name) => options[name] ?? null, getInteger: (name) => options[name] ?? null, getBoolean: () => null,
      getSubcommand: () => 'user',
    },
    pettoLang: 'en',
    deferReply: async () => {}, reply: async () => { steps.push('reply'); }, editReply: async () => { steps.push('edit'); },
  };
}

(async () => {
  for (const [label, run] of [['ban', (i) => ban.execute(i)], ['tempban', (i) => ban.execute(i)]]) {
    steps.length = 0;
    const started = Date.now();
    const i = interaction(3, { duration: label === 'tempban' ? '1d' : null });
    await run(i);
    const answeredAfter = Date.now() - started;
    const upToLog = steps.slice();
    assert.deepEqual(upToLog.slice(0, 4), ['dm', 'ban:0', 'done', 'log'], `${label}: the notice, the ban alone, "done", the log (${upToLog.join(' > ')})`);
    assert.ok(answeredAfter < 60, `${label}: it answered without waiting for the messages (${answeredAfter} ms)`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(steps.slice(4), ['ban:259200'], `${label}: then the same ban again deletes the 3 days of messages`);
  }

  // Without days there is nothing to delete after: only one ban.
  steps.length = 0;
  await ban.execute(interaction(0));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(steps, ['dm', 'ban:0', 'done', 'log'], 'no days of messages: no second ban');

  // If the ban fails nothing else happens: no "done", no log, no deleting.
  steps.length = 0;
  await ban.execute(interaction(3, { failBan: true }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(steps.filter((step) => !step.startsWith('warn:')), ['dm', 'ban:0', 'edit'], 'a failed ban says so and stops there');

  // The deletion failing (Discord refuses the second ban) is said in the log and breaks nothing.
  steps.length = 0;
  const failing = interaction(2);
  let calls = 0;
  const original = failing.guild.members.ban;
  failing.guild.members.ban = async (id, opt) => { calls += 1; if (calls === 2) throw new Error('Unknown Ban'); return original(id, opt); };
  await ban.execute(failing);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(steps.some((step) => step.startsWith('warn:Could not delete the messages')), 'the failure is said in the log');

  console.log('Checked the order of a ban with messages: the notice, the ban, done, the log, and then the messages.');
})().catch((error) => { console.error(error); process.exit(1); });

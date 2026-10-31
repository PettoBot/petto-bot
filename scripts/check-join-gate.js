// Checks that the welcome messages (the welcome and the second welcome) can wait for a new member to accept the rules and to finish Discord's
// onboarding (src/utils/joinGate.js): off by default, `rules`, `rules_onboarding` with its safety limits of 10 and 30 minutes, sent once and
// in order, one failing without stopping the other, a member who leaves, a restart in the middle, the same update twice, and what never waits
// (the DM on join, the ping on join, the join roles, the logs, the level bonus, the invites). Discord, the database and the senders are replaced;
// the rules of the gate are the real ones.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');
const { GuildMemberFlags, GuildMemberFlagsBitField } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// ---- What the database holds (one object per table) ------------------------------------------------------------------------
const settingsOf = new Map(); // guild -> member_events_config row
const pojOf = new Map(); // guild -> poj_config row
const table = new Map(); // `${guild}:${user}` -> { guild, user, joinedAt, dueAt } (join_waiting)
const clock = { offset: 0 }; // minutes added to "now", to let time pass
const now = () => Date.now() + clock.offset * 60_000;
const calls = { add: 0, take: 0, takeDue: 0, startDue: 0 };
const DAY = 86_400_000;

stub('src/db/joinWaiting.js', {
  WAIT_DAYS: 7,
  add: async (guild, user, dueMinutes = null) => {
    calls.add += 1;
    const key = `${guild}:${user}`;
    if (table.has(key)) return false;
    table.set(key, { guild, user, joinedAt: now(), dueAt: dueMinutes === null ? null : now() + dueMinutes * 60_000 });
    return true;
  },
  startDue: async (guild, user, minutes) => {
    calls.startDue += 1;
    const row = table.get(`${guild}:${user}`);
    if (!row || row.dueAt !== null) return false;
    row.dueAt = now() + minutes * 60_000;
    return true;
  },
  take: async (guild, user) => {
    calls.take += 1;
    const key = `${guild}:${user}`;
    const row = table.get(key);
    if (!row) return null;
    table.delete(key);
    return { joined_at: new Date(row.joinedAt), expired: now() - row.joinedAt > 7 * DAY };
  },
  takeDue: async () => {
    calls.takeDue += 1;
    const due = [...table.values()].filter((row) => row.dueAt !== null && row.dueAt <= now() && now() - row.joinedAt <= 7 * DAY);
    for (const row of due) table.delete(`${row.guild}:${row.user}`);
    return due.map((row) => ({ guild_id: row.guild, user_id: row.user }));
  },
  removeExpired: async () => {
    const gone = [...table.values()].filter((row) => now() - row.joinedAt > 7 * DAY);
    for (const row of gone) table.delete(`${row.guild}:${row.user}`);
    return gone.map((row) => row.guild);
  },
  countsByGuild: async () => {
    const counts = new Map();
    for (const row of table.values()) counts.set(row.guild, (counts.get(row.guild) ?? 0) + 1);
    return counts;
  },
});
stub('src/db/memberEvents.js', {
  welcomeWait: (config) => (['off', 'rules', 'rules_onboarding'].includes(config?.welcome_wait) ? config.welcome_wait : 'off'),
  getConfig: async (guild) => settingsOf.get(guild) ?? null,
  getConfigCached: async (guild) => settingsOf.get(guild) ?? null,
  upsertConfig: async () => null,
});
stub('src/db/poj.js', {
  getConfig: async (guild) => pojOf.get(guild) ?? null,
  listChannels: async (guild) => (pojOf.get(guild)?.enabled ? [{ channel_id: 'ping', delete_after_ms: 1 }] : []),
});
stub('src/db/guilds.js', { ensureGuild: async () => {} });
const errors = [];
const warnings = [];
stub('src/utils/logger.js', { info() {}, warn(...args) { warnings.push(args); }, error(...args) { errors.push(args); }, debug() {} });

// What is sent: the welcomes and the DM go through sendMemberEvent, the ping goes through its own handler.
const sent = [];
const failing = new Set(); // channel ids where sending throws
stub('src/utils/memberEventMessage.js', {
  sendMemberEvent: async ({ guild, ctx, messageText, embedTemplateName }) => {
    if (failing.has(ctx.channel.id)) throw new Error('Missing Permissions');
    sent.push({ what: ctx.channel.dm ? 'dm' : `welcome:${ctx.channel.id}`, guild: guild.id, user: ctx.member.id, text: messageText ?? embedTemplateName, invite: ctx.invite });
  },
});
stub('src/utils/inviteContext.js', { inviteInfoFor: async (member, { recorded = false } = {}) => ({ recorded }) });
const pings = [];

const memberEvents = require('../src/db/memberEvents');
const gate = require('../src/utils/joinGate');
const welcome = require('../src/events/guildMemberAddWelcome');
const dmJoin = require('../src/events/guildMemberAddDmJoin');
const poj = require('../src/events/guildMemberAddPoj');
const updateEvent = require('../src/events/guildMemberUpdateJoinMessages');
const availableEvent = require('../src/events/guildMemberAvailableJoinMessages');
const removeEvent = require('../src/events/guildMemberRemoveJoinMessages');
const auditEvent = require('../src/events/guildAuditLogEntryCreateJoinMessages');

// ---- Discord ---------------------------------------------------------------------------------------------------------------
let guildCount = 0;
const onboarding = new Map(); // guild -> what fetchOnboarding answers (an Error makes it fail)
const onboardingFetches = new Map();
const missingChannels = new Set();
const readOnlyChannels = new Set();
function makeGuild({ wait, onboardingOn = false, second = null, dm = false, ping = false, welcomeChannel = 'main' } = {}) {
  guildCount += 1;
  const id = `9000000000000000${String(guildCount).padStart(2, '0')}`;
  const settings = {};
  if (welcomeChannel) { settings.welcome_channel_id = welcomeChannel; settings.welcome_message = 'Welcome {user}'; }
  if (second) { settings.welcome_second_enabled = second.enabled ?? true; settings.welcome_second_channel_id = second.channel ?? 'general'; settings.welcome_second_message = second.message ?? 'Hi all'; }
  if (dm) settings.dm_join_message = 'Hello';
  if (wait !== undefined) settings.welcome_wait = wait;
  settingsOf.set(id, settings);
  if (ping) pojOf.set(id, { enabled: true });
  if (onboardingOn) onboarding.set(id, { enabled: true, prompts: { size: 2 } });
  const guild = {
    id,
    members: {
      me: { permissions: { has: () => true }, roles: { highest: { position: 10 } } },
      cache: new Map(),
      fetch: async (userId) => guild.members.cache.get(userId) ?? Promise.reject(new Error('Unknown Member')),
    },
    channels: {
      fetch: async (channelId) => {
        if (missingChannels.has(`${id}:${channelId}`)) throw new Error('Unknown Channel');
        return {
          id: channelId,
          permissionsFor: () => ({ has: () => !readOnlyChannels.has(`${id}:${channelId}`) }),
          send: async (payload) => { pings.push({ guild: id, payload }); return { delete: async () => {} }; },
        };
      },
    },
    roles: { cache: new Map() },
    fetchOnboarding: async () => {
      onboardingFetches.set(id, (onboardingFetches.get(id) ?? 0) + 1);
      const answer = onboarding.get(id) ?? { enabled: false, prompts: { size: 0 } };
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return guild;
}
let userCount = 0;
function makeMember(guild, { pending = false, flags = 0, bot = false } = {}) {
  userCount += 1;
  const id = `8000000000000000${String(userCount).padStart(2, '0')}`;
  const member = {
    id, guild, pending, partial: false,
    flags: new GuildMemberFlagsBitField(flags),
    user: { id, bot, username: `user${userCount}` },
    createDM: async () => ({ dm: true }),
    roles: { added: [], add: async function add(roles) { this.added.push(roles); } },
  };
  guild.members.cache.set(id, member);
  return member;
}
/** What Discord does when a member changes: the old copy, the member changed in place, and the update. */
function changed(member, patch) {
  const old = { ...member, flags: new GuildMemberFlagsBitField(member.flags.bitfield), partial: false };
  if ('pending' in patch) member.pending = patch.pending;
  if ('flags' in patch) member.flags = new GuildMemberFlagsBitField(patch.flags);
  return old;
}
const joinHandlers = (member) => Promise.all([welcome.execute(member), dmJoin.execute(member), poj.execute(member)]);
const update = (old, member) => updateEvent.execute(old, member);
const received = (guild, user) => sent.filter((item) => item.guild === guild.id && item.user === user).map((item) => item.what);
const pingsOf = (guild) => pings.filter((item) => item.guild === guild.id).length;
const waitingIn = (guild) => [...table.values()].filter((row) => row.guild === guild.id).length;
const rowOf = (guild, member) => table.get(`${guild.id}:${member.id}`);
const clientOf = (...guilds) => ({ guilds: { cache: new Map(guilds.map((guild) => [guild.id, guild])) } });
const settle = () => new Promise((resolve) => setImmediate(resolve));
const BOTH = ['welcome:main', 'welcome:general'];

const COMPLETED = GuildMemberFlags.CompletedOnboarding;
const STARTED = GuildMemberFlags.StartedOnboarding;

(async () => {
  assert.equal(memberEvents.welcomeWait({}), 'off');
  assert.equal(memberEvents.welcomeWait({ welcome_wait: 'nonsense' }), 'off', 'an unknown value is the default');

  // ---- 1. Off (the default): everything as it always was ---------------------------------------------------------------------
  {
    const guild = makeGuild({ second: {}, dm: true, ping: true, onboardingOn: true });
    const pendingMember = makeMember(guild, { pending: true });
    await joinHandlers(pendingMember);
    assert.deepEqual(received(guild, pendingMember.id).filter((what) => what !== 'dm'), BOTH, 'with the default, even a pending member is welcomed at once, the first welcome first');
    assert.equal(waitingIn(guild), 0, 'nobody is held');
    assert.equal(onboardingFetches.get(guild.id) ?? 0, 0, 'and Discord is not asked about the onboarding');
    assert.equal(sent.find((item) => item.user === pendingMember.id).invite.recorded, false, 'an immediate welcome reads the invite the usual way');
    const plain = makeMember(guild);
    await joinHandlers(plain);
    assert.deepEqual(received(guild, plain.id).filter((what) => what !== 'dm'), BOTH);
    assert.equal(calls.add, 0);
    // A server that says `off` is the same.
    const explicit = makeGuild({ wait: 'off' });
    const member = makeMember(explicit, { pending: true });
    await joinHandlers(member);
    assert.deepEqual(received(explicit, member.id), ['welcome:main']);
  }

  // ---- 2. `rules`: a pending member waits, then is welcomed once, in order ---------------------------------------------------
  {
    const guild = makeGuild({ wait: 'rules', second: {}, dm: true, ping: true, onboardingOn: true });
    const member = makeMember(guild, { pending: true });
    await joinHandlers(member);
    assert.deepEqual(received(guild, member.id), ['dm'], 'the welcomes wait, the DM does not');
    assert.equal(pingsOf(guild), 1, 'and the ping does not either');
    assert.equal(waitingIn(guild), 1, 'the member is on the waiting list once');
    assert.equal(rowOf(guild, member).dueAt, null, 'with no safety limit while the rules are not accepted');

    await update(member, member); // a nickname or a role
    assert.deepEqual(received(guild, member.id), ['dm']);

    const old = changed(member, { pending: false });
    await update(old, member);
    assert.deepEqual(received(guild, member.id), ['dm', ...BOTH], 'accepting the rules sends the welcome, then the second one');
    assert.equal(waitingIn(guild), 0);
    assert.equal(sent.find((item) => item.user === member.id && item.what === 'welcome:main').invite.recorded, true, 'a welcome that waited reads the invite recorded at the join');
    assert.equal(pingsOf(guild), 1, 'the ping is not sent again');

    await update(old, member);
    await Promise.all([update(old, member), update(old, member), availableEvent.execute(member)]);
    await settle();
    assert.deepEqual(received(guild, member.id), ['dm', ...BOTH], 'a repeated update sends nothing more');

    // A member who is not pending is welcomed at once, and the onboarding is not looked at.
    const free = makeMember(guild);
    await joinHandlers(free);
    assert.deepEqual(received(guild, free.id).filter((what) => what !== 'dm'), BOTH);
    assert.equal(onboardingFetches.get(guild.id) ?? 0, 0, '`rules` never asks about the onboarding');
  }

  // ---- 3. `rules_onboarding`, no rules to accept: waits for the onboarding, 30 minutes at most -------------------------------
  {
    const guild = makeGuild({ wait: 'rules_onboarding', second: {}, onboardingOn: true });
    const member = makeMember(guild);
    await joinHandlers(member);
    assert.deepEqual(received(guild, member.id), [], 'a member who has not finished the onboarding waits');
    assert.equal(waitingIn(guild), 1);
    assert.equal(Math.round((rowOf(guild, member).dueAt - now()) / 60_000), 30, 'with 30 minutes after the join as the limit');
    await update(changed(member, { flags: STARTED }), member);
    assert.deepEqual(received(guild, member.id), [], 'starting the onboarding is not finishing it');
    await update(changed(member, { flags: STARTED | COMPLETED }), member);
    assert.deepEqual(received(guild, member.id), BOTH, 'finishing it sends the welcomes');
    assert.equal(waitingIn(guild), 0);
    assert.equal(onboardingFetches.get(guild.id), 1);
    await joinHandlers(makeMember(guild));
    assert.equal(onboardingFetches.get(guild.id), 1, 'Discord is asked once for the server, not for each member');

    // The limit: the member never finishes (or skips) it.
    const lazy = makeMember(guild);
    await joinHandlers(lazy);
    clock.offset += 29;
    assert.equal(await gate.sendDue(clientOf(guild)), 0);
    assert.deepEqual(received(guild, lazy.id), [], 'before 30 minutes nothing is sent');
    clock.offset += 2;
    assert.equal(await gate.sendDue(clientOf(guild)) >= 1, true);
    assert.deepEqual(received(guild, lazy.id), BOTH, 'after 30 minutes the welcomes go out');
    assert.equal(received(guild, lazy.id).length, 2);
    await update(changed(lazy, { flags: COMPLETED }), lazy);
    assert.deepEqual(received(guild, lazy.id), BOTH, 'and finishing the onboarding later does not send them again');
    assert.equal(await gate.sendDue(clientOf(guild)), 0, 'the timer finds nothing more');
  }

  // ---- 4. `rules_onboarding` with rules: 10 minutes after they are accepted ---------------------------------------------------
  {
    const guild = makeGuild({ wait: 'rules_onboarding', onboardingOn: true });
    const member = makeMember(guild, { pending: true });
    await joinHandlers(member);
    assert.equal(rowOf(guild, member).dueAt, null, 'no limit while the rules are not accepted');
    clock.offset += 600;
    assert.equal(await gate.sendDue(clientOf(guild)), 0, 'a member who never accepts the rules is never welcomed');
    assert.deepEqual(received(guild, member.id), []);

    await update(changed(member, { pending: false }), member);
    assert.deepEqual(received(guild, member.id), [], 'the rules are accepted but the onboarding is not done');
    assert.equal(Math.round((rowOf(guild, member).dueAt - now()) / 60_000), 10, 'the limit of 10 minutes starts');
    await update(changed(member, { flags: STARTED }), member);
    assert.equal(Math.round((rowOf(guild, member).dueAt - now()) / 60_000), 10, 'and is not pushed back by another update');
    clock.offset += 9;
    await gate.sendDue(clientOf(guild));
    assert.deepEqual(received(guild, member.id), []);
    clock.offset += 2;
    await gate.sendDue(clientOf(guild));
    assert.deepEqual(received(guild, member.id), ['welcome:main'], 'after 10 minutes the welcome goes out');

    // Finishing before the limit sends it at once, once.
    const quick = makeMember(guild, { pending: true });
    await joinHandlers(quick);
    await update(changed(quick, { pending: false }), quick);
    await update(changed(quick, { flags: COMPLETED }), quick);
    clock.offset += 20;
    await gate.sendDue(clientOf(guild));
    assert.deepEqual(received(guild, quick.id), ['welcome:main'], 'finished in time: sent once, and the timer adds nothing');

    // Rules and the onboarding done at the same moment.
    const both = makeMember(guild, { pending: true });
    await joinHandlers(both);
    await update(changed(both, { pending: false, flags: COMPLETED }), both);
    assert.deepEqual(received(guild, both.id), ['welcome:main']);

    // A server whose onboarding is off (or has no questions, or cannot be read) is not waited for.
    const plain = makeGuild({ wait: 'rules_onboarding' });
    const one = makeMember(plain, { pending: true });
    await joinHandlers(one);
    await update(changed(one, { pending: false }), one);
    assert.deepEqual(received(plain, one.id), ['welcome:main'], 'no onboarding: sent as the rules are accepted');
    const broken = makeGuild({ wait: 'rules_onboarding' });
    onboarding.set(broken.id, new Error('Missing Access'));
    const two = makeMember(broken);
    await joinHandlers(two);
    assert.deepEqual(received(broken, two.id), ['welcome:main'], 'an onboarding Discord does not answer about is not waited for');
    const empty = makeGuild({ wait: 'rules_onboarding' });
    onboarding.set(empty.id, { enabled: true, prompts: { size: 0 } });
    const three = makeMember(empty);
    await joinHandlers(three);
    assert.deepEqual(received(empty, three.id), ['welcome:main'], 'an onboarding with no questions is not waited for');
    onboarding.set(empty.id, { enabled: true, prompts: { size: 1 } });
    auditEvent.execute({ action: 166 }, { id: empty.id }); // the audit log says it changed
    const four = makeMember(empty);
    await joinHandlers(four);
    assert.deepEqual(received(empty, four.id), [], 'after the change the onboarding is waited for');
  }

  // ---- 5. Members the steps do not apply to ----------------------------------------------------------------------------------
  {
    const guild = makeGuild({ wait: 'rules_onboarding', onboardingOn: true });
    const rejoined = makeMember(guild, { flags: GuildMemberFlags.DidRejoin });
    const bypass = makeMember(guild, { pending: true, flags: GuildMemberFlags.BypassesVerification });
    const done = makeMember(guild, { flags: COMPLETED });
    const bot = makeMember(guild, { bot: true, pending: true });
    for (const member of [rejoined, bypass, done, bot]) {
      await joinHandlers(member);
      assert.deepEqual(received(guild, member.id), ['welcome:main'], 'welcomed at once (rejoined, exempt from verification, already completed, a bot)');
    }
    assert.equal(waitingIn(guild), 0);
    const again = makeMember(guild, { pending: true, flags: GuildMemberFlags.DidRejoin });
    await joinHandlers(again);
    assert.deepEqual(received(guild, again.id), [], 'a rejoiner who has to accept the rules again waits for them');
  }

  // ---- 6. Two welcomes: order, switch, and one failing without stopping the other ------------------------------------------
  {
    const guild = makeGuild({ second: { enabled: false } });
    const member = makeMember(guild);
    await joinHandlers(member);
    assert.deepEqual(received(guild, member.id), ['welcome:main'], 'a second welcome that is off sends nothing');

    const only = makeGuild({ welcomeChannel: null, second: {} });
    const lone = makeMember(only);
    await joinHandlers(lone);
    assert.deepEqual(received(only, lone.id), ['welcome:general'], 'the second welcome works without the first');

    const failingGuild = makeGuild({ second: {} });
    failing.add('main');
    const next = makeMember(failingGuild);
    await joinHandlers(next);
    failing.delete('main');
    assert.deepEqual(received(failingGuild, next.id), ['welcome:general'], 'the first failing does not stop the second');
    assert.equal(errors.length > 0, true);
    errors.length = 0;

    const missing = makeGuild({ second: {} });
    missingChannels.add(`${missing.id}:main`);
    const m1 = makeMember(missing);
    const m2 = makeMember(missing);
    await joinHandlers(m1);
    await joinHandlers(m2);
    assert.deepEqual(received(missing, m1.id), ['welcome:general'], 'a missing channel does not stop the second welcome');
    assert.equal(warnings.filter((args) => String(args[0]).includes(missing.id)).length, 1, 'and is said once in the log, not for every member');

    const readOnly = makeGuild({ second: {} });
    readOnlyChannels.add(`${readOnly.id}:general`);
    const r = makeMember(readOnly);
    await joinHandlers(r);
    assert.deepEqual(received(readOnly, r.id), ['welcome:main'], 'a channel where Petto cannot write is skipped, the other one still gets its welcome');

    // Both follow the wait setting, and go together.
    const waiting = makeGuild({ wait: 'rules', second: {} });
    const w = makeMember(waiting, { pending: true });
    await joinHandlers(w);
    assert.deepEqual(received(waiting, w.id), []);
    await update(changed(w, { pending: false }), w);
    assert.deepEqual(received(waiting, w.id), BOTH, 'both welcomes wait, and go in order');
    // A server with a second welcome only is held for it too.
    const secondOnly = makeGuild({ wait: 'rules', welcomeChannel: null, second: {} });
    const s = makeMember(secondOnly, { pending: true });
    await joinHandlers(s);
    assert.equal(waitingIn(secondOnly), 1);
    // And one with no welcome at all holds nobody.
    const none = makeGuild({ wait: 'rules', welcomeChannel: null });
    await joinHandlers(makeMember(none, { pending: true }));
    assert.equal(waitingIn(none), 0, 'a server with no welcome does not fill the waiting list');
  }

  // ---- 7. The member leaves before finishing -----------------------------------------------------------------------------------
  {
    const guild = makeGuild({ wait: 'rules', second: {} });
    const member = makeMember(guild, { pending: true });
    await joinHandlers(member);
    assert.equal(waitingIn(guild), 1);
    await removeEvent.execute(member);
    assert.equal(waitingIn(guild), 0, 'the wait is dropped');
    await update(changed(member, { pending: false }), member);
    assert.deepEqual(received(guild, member.id), [], 'and nothing is sent to someone who left');

    const gone = makeMember(guild);
    await joinHandlers(gone);
    const g2 = makeGuild({ wait: 'rules_onboarding', onboardingOn: true });
    const late = makeMember(g2);
    await joinHandlers(late);
    g2.members.cache.delete(late.id); // left before the limit
    clock.offset += 40;
    await gate.sendDue(clientOf(g2));
    assert.deepEqual(received(g2, late.id), [], 'a member who left is not welcomed by the timer either');
    assert.equal(waitingIn(g2), 0);
  }

  // ---- 8. A restart between the join and the end of the steps ---------------------------------------------------------------
  {
    const guild = makeGuild({ wait: 'rules' });
    const member = makeMember(guild, { pending: true });
    await joinHandlers(member);
    gate.resetForTests(); // the bot starts again: nothing is in memory, the table has the member
    await update(changed(member, { pending: false }), member);
    assert.deepEqual(received(guild, member.id), ['welcome:main'], 'the waiting row decides: the member who finishes after a restart is welcomed');
    assert.equal(waitingIn(guild), 0);

    const second = makeMember(guild, { pending: true });
    await joinHandlers(second);
    gate.resetForTests();
    second.pending = false;
    await availableEvent.execute(second);
    assert.deepEqual(received(guild, second.id), ['welcome:main'], 'a member who comes back as "available" is welcomed too');

    // The limit also survives a restart.
    const g2 = makeGuild({ wait: 'rules_onboarding', onboardingOn: true });
    const slow = makeMember(g2);
    await joinHandlers(slow);
    gate.resetForTests();
    clock.offset += 31;
    await gate.sendDue(clientOf(g2));
    assert.deepEqual(received(g2, slow.id), ['welcome:main'], 'the safety limit is in the table, so a restart does not lose it');

    // Someone who was never held is not welcomed twice by the first update after a restart.
    const plain = makeMember(guild);
    await joinHandlers(plain);
    const before = sent.length;
    gate.resetForTests();
    await update(changed(plain, { flags: COMPLETED }), plain);
    assert.equal(sent.length, before, 'a member who was welcomed at the join is not welcomed twice');
  }

  // ---- 9. A server where nobody waits costs no query -----------------------------------------------------------------------------
  {
    table.clear(); // the members of the other checks do not wait any more
    gate.resetForTests();
    const guild = makeGuild({ wait: 'rules' });
    const other = makeGuild({ wait: 'rules' });
    const waiter = makeMember(other, { pending: true });
    await joinHandlers(waiter);
    await settle();
    gate.hasWaiting(other.id); // reads the numbers
    await settle();
    const member = makeMember(guild);
    const before = { ...calls };
    await update(changed(member, { flags: COMPLETED }), member);
    await update(changed(member, { pending: true }), member);
    await availableEvent.execute(member);
    await removeEvent.execute(member);
    assert.equal(calls.take, before.take, 'no query for a server where nobody waits');
    assert.equal(gate.hasWaiting(guild.id), false);
    assert.equal(gate.hasWaiting(other.id), true);
    await update(changed(waiter, { pending: false }), waiter);
    assert.equal(gate.hasWaiting(other.id), false, 'and once nobody waits any more it costs nothing again');
    const takeDueBefore = calls.takeDue;
    await settle();
    assert.equal(await gate.sendDue(clientOf(guild)), 0);
    assert.equal(calls.takeDue, takeDueBefore, 'the timer asks the database nothing when nobody waits');
  }

  // ---- 10. The server turns the waiting off while a member waits ----------------------------------------------------------------
  {
    const guild = makeGuild({ wait: 'rules' });
    const member = makeMember(guild, { pending: true });
    await joinHandlers(member);
    settingsOf.get(guild.id).welcome_wait = 'off';
    const next = makeMember(guild, { pending: true });
    await joinHandlers(next);
    assert.deepEqual(received(guild, next.id), ['welcome:main'], 'the next member is welcomed at once');
    await update(changed(member, { pending: false }), member);
    assert.deepEqual(received(guild, member.id), [], 'nothing extra is sent to who was already waiting');
    assert.equal(waitingIn(guild), 0, 'they are just not held any more');

    const g2 = makeGuild({ wait: 'rules_onboarding', onboardingOn: true });
    const slow = makeMember(g2);
    await joinHandlers(slow);
    settingsOf.get(g2.id).welcome_wait = 'off';
    clock.offset += 40;
    await gate.sendDue(clientOf(g2));
    assert.deepEqual(received(g2, slow.id), [], 'the timer sends nothing extra either');

    // From `rules_onboarding` to `rules`: the onboarding is no longer waited for.
    const g3 = makeGuild({ wait: 'rules_onboarding', onboardingOn: true });
    const m = makeMember(g3);
    await joinHandlers(m);
    settingsOf.get(g3.id).welcome_wait = 'rules';
    await update(changed(m, { flags: STARTED }), m);
    assert.deepEqual(received(g3, m.id), ['welcome:main']);
  }

  // ---- 11. A wait that lasted more than 7 days is dropped, not sent ---------------------------------------------------------------
  {
    const guild = makeGuild({ wait: 'rules' });
    const member = makeMember(guild, { pending: true });
    await joinHandlers(member);
    rowOf(guild, member).joinedAt = now() - 8 * DAY;
    await update(changed(member, { pending: false }), member);
    assert.deepEqual(received(guild, member.id), [], 'after 7 days the welcome is not sent any more');
    assert.equal(waitingIn(guild), 0);
    const old = makeMember(guild, { pending: true });
    await joinHandlers(old);
    rowOf(guild, old).joinedAt = now() - 9 * DAY;
    gate.resetForTests();
    const probe = makeMember(guild);
    await update(changed(probe, { flags: COMPLETED }), probe);
    await settle(); await settle();
    assert.equal(waitingIn(guild), 0, 'the old rows are removed when the table is first read');
  }

  // ---- 12. What never waits ---------------------------------------------------------------------------------------------------------
  {
    const guild = makeGuild({ wait: 'rules_onboarding', onboardingOn: true, dm: true, ping: true, second: {} });
    const member = makeMember(guild, { pending: true });

    const logged = [];
    stub('src/logging/memberLog.js', { handleMemberJoin: async (joined) => { logged.push(joined.id); } });
    const joinLog = require('../src/events/guildMemberAdd');
    stub('src/db/joinRoles.js', { listRoles: async () => [{ role_id: 'r1', target: 'all' }] });
    guild.roles.cache.set('r1', { id: 'r1', position: 1, managed: false });
    const joinRole = require('../src/events/guildMemberAddJoinRole');
    stub('src/db/levelConfig.js', { getConfig: async () => ({ enabled: true, join_xp: 0, join_level: 3 }) });
    const xp = [];
    stub('src/db/levelUsers.js', { getUser: async () => null, setXpAndLevel: async (g, u, value, level) => { xp.push([u, value, level]); } });
    stub('src/utils/levelCurve.js', { totalXpForLevel: () => 300, levelForXp: () => 3 });
    const levelJoin = require('../src/events/guildMemberAddLevelJoin');
    const tracked = [];
    stub('src/utils/inviteResolve.js', { resolveJoinInvite: async () => ({ code: 'abc', inviter: { id: '5' } }), wasVanityJoin: async () => false });
    stub('src/db/inviteTracking.js', { recordJoin: async (g, u) => { tracked.push(u); return { fake: false }; }, getInviter: async () => null });
    stub('src/db/activityDetail.js', { queueFlow() {} });
    stub('src/db/statsRules.js', { allowed: () => true });
    stub('src/utils/inviteRewards.js', { applyRewards: async () => {} });
    const inviteTracking = require('../src/events/guildMemberAddInviteTracking');

    await Promise.all([joinLog.execute(member, {}), joinRole.execute(member), levelJoin.execute(member), inviteTracking.execute(member), joinHandlers(member)]);
    assert.deepEqual(received(guild, member.id), ['dm'], 'only the DM went out, the welcomes wait');
    assert.equal(pingsOf(guild), 1, 'the ping on join goes at once');
    assert.deepEqual(logged, [member.id], 'the join log is written at the join');
    assert.equal(member.roles.added.length, 1, 'the join roles are given at the join');
    assert.deepEqual(xp, [[member.id, 300, 3]], 'the level bonus is given at the join');
    assert.deepEqual(tracked, [member.id], 'the invite is tracked at the join');
    assert.equal(waitingIn(guild), 1);
  }

  // ---- 13. The database fails: the member is welcomed at once instead of never ------------------------------------------------------
  {
    const guild = makeGuild({ wait: 'rules' });
    const waitingDb = require('../src/db/joinWaiting');
    const add = waitingDb.add;
    waitingDb.add = async () => { throw new Error('database down'); };
    const member = makeMember(guild, { pending: true });
    errors.length = 0;
    await joinHandlers(member);
    waitingDb.add = add;
    assert.deepEqual(received(guild, member.id), ['welcome:main'], 'if the wait cannot be written, the member is welcomed at once');
    errors.length = 0;
  }

  assert.deepEqual(errors, [], 'no unexpected error was logged');
  console.log('Checked the welcome that waits: off by default, rules, onboarding with its safety limits, two welcomes in order, and what never waits.');
})().catch((error) => { console.error(error); process.exit(1); });

// Checks the `!<module>config` cards: that every one loads without clashing with another command or alias, that the commands it
// shows exist in the command it points to, and how the stored values are written.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';

const rows = {
  booster_role_config: { guild_id: '1', base_role_id: '222222222222222222', role_limit: 2, share_max: 0, filtered_words: ['x'], color_cooldown_ms: 3600000, icon_cooldown_ms: 0, rename_cooldown_ms: 0, updated_at: 'now' },
  member_events_config: { guild_id: '1', welcome_channel_id: '333333333333333333', welcome_message: 'Hi {user}', leave_channel_id: null, boost_channel_id: null, dm_join_message: null },
  log_entries: [{ channel_id: '444444444444444444', event: 'sanctions' }, { channel_id: '444444444444444444', event: 'members' }],
  automod_config: { guild_id: '1', anti_raid_enabled: true, raid_join_threshold: 6, raid_window_seconds: 10, immune_role_ids: ['222222222222222222'], banned_words: ['secret'] },
  antinuke_config: { guild_id: '1', enabled: false, action_threshold: 5, window_seconds: 10, whitelist_ids: [] },
};
const resolved = require.resolve('../src/db/database');
require.cache[resolved] = {
  id: resolved, filename: resolved, loaded: true,
  exports: {
    from: (table) => {
      const data = rows[table];
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] : data ?? null, error: null }), then: (resolve) => resolve({ data: Array.isArray(data) ? data : data ? [data] : [], error: null }) };
      return query;
    },
  },
};

const { MODULES, buildCardText, formatValue, usagePaths, pickUsage, grouped } = require('../src/utils/moduleConfig');
const logger = require('../src/utils/logger');
const warnings = [];
logger.warn = (...args) => warnings.push(args.join(' '));
const { loadCommands } = require('../src/handlers/commandHandler');
const client = {};
loadCommands(client);
logger.warn = () => {};

(async () => {
  for (const [name, module] of Object.entries(MODULES)) {
    const command = client.commands.get(name);
    assert.ok(command, `${name} is loaded`);
    assert.ok(client.commands.get(module.command), `${name} points to /${module.command}, which exists`);
    for (const alias of module.aliases) assert.equal(client.commandAliases.get(alias), name, `alias ${alias} of ${name} is accepted`);
    const text = await buildCardText(module, { guildId: '1', prefix: '?', commands: client.commands });
    assert.match(text, new RegExp(`^### ${module.title} config`));
    assert.ok(text.length < 4000, `${name} fits in one message (${text.length})`);
    const picked = pickUsage(usagePaths(client.commands.get(module.command).data.toJSON()), module.show);
    assert.ok(picked.config.length + picked.rest.length > 0, `${name} shows its commands`);
    assert.match(text, new RegExp(`\\?${module.command}\\b`), `${name} shows its commands with the server prefix`);
  }
  assert.deepEqual(warnings.filter((w) => /config/.test(w)), [], 'no config command or alias clashes with another');

  const text = (name) => buildCardText(MODULES[name], { guildId: '1', prefix: '?', commands: client.commands });
  const booster = await text('brconfig');
  assert.match(booster, /Base role: <@&222222222222222222>/);
  assert.match(booster, /Color cooldown: 1 hour/);
  assert.match(booster, /Share max: `0`/);
  assert.doesNotMatch(booster, /updated_at|Guild/i);
  const welcome = await text('welcomeconfig');
  assert.match(welcome, /Channel: <#333333333333333333>/);
  assert.doesNotMatch(welcome, /Leave|Boost/i, 'only the welcome fields');
  const logs = await text('logsconfig');
  assert.match(logs, /<#444444444444444444>: `sanctions`, `members`/);
  const automod = await text('automodconfig');
  assert.match(automod, /Anti raid enabled: \*\*On\*\*/);
  assert.match(automod, /Immune role: <@&222222222222222222>|Immune: <@&222222222222222222>/);
  assert.doesNotMatch(automod, /secret/, 'the banned words are not listed');
  assert.match(await text('levelconfig'), /Nothing is set up yet/);

  const brUsage = await text('brconfig');
  assert.match(brUsage, /\?boosterrole admin base/);
  assert.match(brUsage, /\?boosterrole create/, 'every command of the module is shown');
  assert.ok(brUsage.indexOf('boosterrole admin base') < brUsage.indexOf('boosterrole create'), 'the ones that configure come first');
  assert.match(await text('ticketconfig'), /\?ticket setup/);
  // A module with many commands is shortened, not cut: ticket has dozens and all of them are still there
  const ticket = await text('ticketconfig');
  assert.ok(ticket.length <= 3800);
  for (const word of ['setup', 'transcript', 'unclaim', 'blacklist', 'form', 'ping-role']) assert.match(ticket, new RegExp(word), `ticket shows ${word}`);
  assert.doesNotMatch(ticket, /More in/, 'nothing had to be cut');
  assert.deepEqual(grouped(['ticket panel create <channel>', 'ticket panel delete <id>', 'ticket info', 'ticket form list']), ['ticket panel create|delete', 'ticket info', 'ticket form list'], 'long lists are grouped');
  // Every other command gets a generated card, except the roleplay ones, the team's and the cards themselves
  for (const name of ['ban', 'kick', 'purge', 'avatar', 'role', 'giveaway']) assert.ok(client.commands.get(`${name}config`), `${name}config is generated or made`);
  const ban = client.commands.get('banconfig');
  assert.ok(ban.generatedCard && ban.hiddenFromHelp, 'a generated card is not listed in !help');
  const banText = await buildCardText(ban.configModule ?? { generated: true, title: 'Ban', command: 'ban', sources: [] }, { guildId: '1', prefix: '?', commands: client.commands });
  assert.match(banText, /^### Ban\n-# /);
  assert.match(banText, /\?ban /);
  for (const name of ['hugconfig', 'questsconfig', 'setupconfig', 'banconfigconfig', 'partnerconfigconfig']) assert.equal(client.commands.has(name), false, `${name} is not generated`);
  assert.equal([...client.commands.keys()].filter((key) => key.length > 32).length, 0, 'no name is longer than Discord allows');
  assert.equal(formatValue('enabled', false), '**Off**');
  assert.equal(formatValue('role_id', '222222222222222222'), '<@&222222222222222222>');
  assert.equal(formatValue('x_seconds', 10), '10s');
  assert.equal(formatValue('channel_id', null), '*not set*');
  console.log('Checked the module config cards: they load, show real commands and write the stored values.');
})().catch((err) => { console.error(err); process.exit(1); });

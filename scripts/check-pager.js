// Checks the lists with buttons: pages, the buttons that go with them, sorting and filtering, who may use them and the
// commands that use them (!roles, !emojis, !channels, !boosters, !inrole).
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { buildPage, handlePager, isPagerId } = require('../src/utils/pager');
require('../src/commands/info/roles');
require('../src/commands/info/emojis');
require('../src/commands/info/channels');
require('../src/commands/info/boosters');
const inrole = require('../src/commands/info/inrole');

const collection = (entries) => { const map = new Map(entries.map((e) => [e.id, e])); map.filter = (fn) => collection([...map.values()].filter(fn)); return map; };
const roles = Array.from({ length: 40 }, (_, n) => ({ id: String(100 + n), name: `Role ${n}`, position: n + 1, color: n % 2 ? 0xff0000 : 0, createdTimestamp: 1000 + n, members: { size: n % 5 === 0 ? 0 : n } }));
const members = Array.from({ length: 25 }, (_, n) => ({ id: String(500 + n), displayName: `m${n}`, user: { username: `user${n}`, bot: n < 3 }, joinedTimestamp: 2000 + n, premiumSinceTimestamp: n < 4 ? 5000 + n : null }));
const guild = {
  id: '1', name: 'Test', premiumTier: 2, premiumSubscriptionCount: 7, iconURL: () => null,
  roles: { cache: collection([{ id: '1', name: '@everyone', position: 0, color: 0, createdTimestamp: 0, members: { size: 25 } }, ...roles]) },
  emojis: { cache: collection([{ id: '9', name: 'wave', animated: false, toString: () => '<:wave:9>' }, { id: '10', name: 'dance', animated: true, toString: () => '<a:dance:10>' }]) },
  channels: { cache: collection([{ id: '20', type: ChannelType.GuildText, rawPosition: 1, parent: { name: 'Chat' } }, { id: '21', type: ChannelType.GuildVoice, rawPosition: 2, parent: null }, { id: '22', type: ChannelType.GuildCategory, rawPosition: 0, parent: null }]) },
  members: { cache: collection(members) },
};
const text = (payload) => JSON.stringify(payload.components.map((c) => c.toJSON()));
const buttons = (payload) => payload.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((row) => row.components);

(async () => {
  assert.ok(isPagerId('pg::roles::1::2::position::') && isPagerId('pgo::roles::1::') && !isPagerId('plv_vote::1::0'));

  // Roles: 40 roles are three pages, highest first, with the buttons and the sort menu.
  const first = await buildPage('roles', { guild, userId: '77' });
  assert.match(text(first), /Roles \(40\)/);
  assert.match(text(first), /Showing 1–15 of 40/);
  assert.ok(text(first).indexOf('<@&139>') < text(first).indexOf('<@&138>'), 'the highest role comes first');
  const row = buttons(first);
  assert.equal(row.filter((b) => b.type === 3).length, 1, 'the sort menu');
  const nav = row.filter((b) => b.type === 2);
  assert.equal(nav.length, 5); assert.equal(nav[0].disabled, true); assert.equal(nav[1].disabled, true); assert.equal(nav[3].disabled, false);
  assert.equal(nav[3].custom_id, 'pg::roles::77::1::position::::next', 'the next button carries the page and who asked');
  assert.ok(nav.every((b) => b.custom_id.length <= 100));
  // Discord refuses a message in which two components share an id, and on some pages two buttons go to the same page.
  for (let page = 0; page < 3; page += 1) {
    const ids = buttons(await buildPage('roles', { guild, userId: '77', page })).map((b) => b.custom_id);
    assert.equal(new Set(ids).size, ids.length, `every id on page ${page + 1} is different`);
  }
  const last = await buildPage('roles', { guild, userId: '77', page: 99 });
  assert.match(text(last), /Showing 31–40 of 40/, 'a page past the end is the last page');
  const members_ = await buildPage('roles', { guild, userId: '77', option: 'members' });
  assert.ok(text(members_).indexOf('<@&139>') < text(members_).indexOf('<@&138>'), 'most members first');
  const colored = await buildPage('roles', { guild, userId: '77', option: 'colored' });
  assert.match(text(colored), /Showing 1–15 of 20/);
  const empty = await buildPage('roles', { guild, userId: '77', option: 'empty' });
  assert.match(text(empty), /Showing 1–8 of 8|8 entries/);

  // Other lists.
  assert.match(text(await buildPage('emojis', { guild, userId: '1' })), /<:wave:9>/);
  const animated = text(await buildPage('emojis', { guild, userId: '1', option: 'animated' }));
  assert.ok(animated.includes('<a:dance:10>') && !animated.includes('<:wave:9>'));
  // A line that starts with "# " is a big heading in Discord, so no channel line may start with it.
  const everyChannel = JSON.parse(text(await buildPage('channels', { guild, userId: '1' }))).flatMap((card) => card.components).filter((node) => typeof node.content === 'string').flatMap((node) => node.content.split('\n'));
  assert.ok(everyChannel.every((line) => !/^#{1,3}\s/.test(line) || line.startsWith('## Channels') || line.startsWith('### ')), 'no channel line is a heading');
  assert.ok(everyChannel.some((line) => line.startsWith('💬 <#20>')), 'a text channel starts with its icon');
  const voice = text(await buildPage('channels', { guild, userId: '1', option: 'voice' }));
  assert.ok(voice.includes('<#21>') && !voice.includes('<#20>'));
  const boosters = text(await buildPage('boosters', { guild, userId: '1' }));
  assert.match(boosters, /Boosters \(4\)/); assert.ok(boosters.indexOf('<@500>') < boosters.indexOf('<@503>'), 'the oldest boost first');
  guild.roles.cache.get('105').members = { size: 25, values: () => members.values() };
  const people = text(await buildPage('inrole', { guild, userId: '1', arg: '105', option: 'bots' }));
  assert.ok(people.includes('<@500>') && !people.includes('<@510>'), 'bots only');
  assert.match(text(await buildPage('inrole', { guild, userId: '1', arg: '999' })), /no longer exists/);
  assert.match(text(await buildPage('nothing', { guild, userId: '1' })), /no longer available/);

  // The command asks for the first page.
  const replies = [];
  await inrole.execute({ guild, user: { id: '1' }, options: { getRole: () => guild.roles.cache.get('105') }, reply: async (p) => replies.push(p) });
  assert.match(text(replies[0]), /Role 5 \(25\)/);
  await inrole.execute({ guild, user: { id: '1' }, options: { getRole: () => guild.roles.cache.get('1') }, reply: async (p) => replies.push(p) });
  assert.match(text(replies[1]), /Everyone has @everyone/);

  // Only the person who asked can use the buttons.
  const calls = [];
  const press = (customId, userId, values) => ({ customId, user: { id: userId }, guild, values, reply: async (x) => calls.push(['reply', x]), update: async (x) => calls.push(['update', x]) });
  await handlePager(press('pg::roles::77::1::position::::next', '88'));
  assert.equal(calls[0][0], 'reply'); assert.match(calls[0][1].content, /Only <@77>/);
  await handlePager(press('pg::roles::77::1::position::::next', '77'));
  assert.equal(calls[1][0], 'update'); assert.match(text(calls[1][1]), /Showing 16–30 of 40/);
  await handlePager(press('pgo::roles::77::', '77', ['members']));
  assert.equal(calls[2][0], 'update'); assert.match(text(calls[2][1]), /Showing 1–15 of 40/, 'changing the sort goes back to the first page');

  console.log('pager ok');
})().catch((error) => { console.error(error); process.exit(1); });

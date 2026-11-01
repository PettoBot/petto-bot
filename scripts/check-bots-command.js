// Checks `!bots` (src/commands/info/bots.js): a public command that lists the bots of the server and nothing else. Any member can run it (no permission),
// the bots come oldest first with Petto marked, the ID, the verified flag and when they joined, a long list is paged (only the author turns the pages),
// nothing pings, a big server is never read member by member, and the rules of a server (`!disablecommand bots`) apply to it.
// The slash command slots moved to the team command `!slots`: scripts/check-slots-command.js.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
process.env.PETTO_DEVELOPER_IDS = '900000000000000001';
const assert = require('node:assert/strict');
const { Collection, UserFlagsBitField } = require('discord.js');
const command = require('../src/commands/info/bots');
const { buildPage, handlePager } = require('../src/utils/pager');
const { ruleNames } = require('../src/utils/commandRules');

const text = (payload) => JSON.stringify((payload.components ?? []).map((component) => (component.toJSON ? component.toJSON() : component)));
const bot = (id, name, joinedTimestamp, { verified = false, tag } = {}) => ({
  id, displayName: name, joinedTimestamp,
  user: { id, bot: true, username: name, tag: tag ?? `${name}#0`, globalName: null, flags: new UserFlagsBitField(verified ? UserFlagsBitField.Flags.VerifiedBot : 0) },
});
const human = (id, name, joinedTimestamp) => ({ id, displayName: name, joinedTimestamp, user: { id, bot: false, username: name, tag: `${name}#0`, flags: new UserFlagsBitField(0) } });

/** A fake server: `members` is what the cache holds, `memberCount` what Discord says; `fetch` counts the times it is asked. */
function makeGuild(id, members, { memberCount = members.length, fail = false } = {}) {
  const cache = new Collection(members.map((member) => [member.id, member]));
  const guild = { id, memberCount, client: { user: { id: '1' } }, iconURL: () => null, fetched: 0, members: { cache, fetch: async () => { guild.fetched += 1; if (fail) throw new Error('missing intent'); return cache; } } };
  return guild;
}
const run = async (guild, userId = '5') => {
  const answers = [];
  await command.execute({ guild, user: { id: userId }, reply: async (payload) => { answers.push(payload); } });
  return answers;
};

(async () => {
  // What kind of command it is: for everybody, shown in !help, nothing asked of the member.
  const json = command.data.toJSON();
  assert.equal(json.name, 'bots');
  assert.equal(json.default_member_permissions ?? null, null, 'no permission is asked');
  for (const flag of ['prefixOnly', 'hiddenFromHelp', 'hiddenEverywhere', 'slashOnly', 'privateGuildId']) assert.ok(!command[flag], `${flag} is not set: it is a normal visible command`);
  assert.ok(!command.registerSlash, 'it is not a loose slash command (it is /server bots)');
  assert.ok(!(json.options ?? []).length, 'it takes nothing');
  assert.deepEqual(command.aliases, ['botlist']);

  // The list: oldest first, Petto marked, the ID, the verified flag, when it joined; nobody else.
  const everyone = [bot('1', 'Petto', 3_000_000, { verified: true }), bot('2', 'Older', 1_000_000, { tag: 'Older#1234' }), bot('4', 'Unknown', null), bot('3', 'Mid', 2_000_000, { verified: true }), human('50', 'ana', 500)];
  const guild = makeGuild('g1', everyone);
  const answers = await run(guild);
  assert.equal(answers.length, 1, 'one public answer');
  assert.equal(answers[0].ephemeral, undefined); assert.ok(!(answers[0].flags & 64), 'not private');
  assert.deepEqual(answers[0].allowedMentions, { parse: [] }, 'nothing is pinged');
  const out = text(answers[0]);
  assert.match(out, /Bots in this server \(4\)/);
  assert.ok(out.indexOf('Older') < out.indexOf('Mid') && out.indexOf('Mid') < out.indexOf('Petto') && out.indexOf('Petto') < out.indexOf('Unknown'), 'the oldest first, the one with no known date last');
  assert.match(out, /Older\*\* \(Older#1234\)/, 'name and tag');
  assert.match(out, /`2`/, 'the ID in a code span');
  assert.match(out, /Petto\*\* \(Petto#0\) · `1` · [^·]*Petto · [^·]*Verified/, 'Petto is marked, and the verified flag shows');
  assert.equal((out.match(/Verified/g) ?? []).length, 2, 'only the verified bots say so');
  assert.match(out, /joined <t:1000:R>/, 'a relative Discord timestamp');
  assert.ok(!out.includes('ana#0') && !out.includes('`50`'), 'people are not listed');
  assert.ok(!/slot|\/ 100|subcommand|prefix|registered|Close to a limit/i.test(out), 'nothing about slash command slots, limits or prefix-only commands');
  assert.ok(!/only the bots Petto already knows/.test(out), 'a server whose members are all known says nothing about being incomplete');
  assert.equal(guild.fetched, 0, 'a cache that holds everyone is not fetched again');
  // Any member runs it, the author included: no permission or role is read.
  assert.equal((await run(guild, '900000000000000001')).length, 1);

  // A name cannot ping or break the list.
  const rude = makeGuild('g2', [bot('7', '@everyone *x*', 1000)]);
  const rudeOut = text((await run(rude))[0]);
  assert.ok(!rudeOut.includes('@everyone') && rudeOut.includes('@​everyone'), 'an @ in a name cannot be a mention');
  assert.ok(rudeOut.includes('\\\\*x\\\\*'), 'markdown in a name is escaped');

  // A long list is paged: 10 bots a page, buttons, and only the person who asked turns the pages.
  const many = Array.from({ length: 25 }, (_, i) => bot(String(100 + i), `Bot${String(i).padStart(2, '0')}`, 1_000_000 + i * 1000));
  const crowded = makeGuild('g3', [...many, human('51', 'bea', 1)]);
  const first = (await run(crowded, '5'))[0];
  const firstText = text(first);
  assert.match(firstText, /Bots in this server \(25\)/);
  assert.ok(firstText.includes('Bot00') && firstText.includes('Bot09') && !firstText.includes('Bot10'), '10 a page');
  assert.match(firstText, /Showing 1.10 of 25/);
  assert.match(firstText, /pg::bots::5::1::/, 'the buttons carry who asked');
  assert.ok(first.components[0].toJSON().components.some((component) => component.type === 1), 'there are buttons');
  const last = text(await buildPage('bots', { guild: crowded, userId: '5', page: 2 }));
  assert.ok(last.includes('Bot24') && !last.includes('Bot09'), 'the last page');
  assert.ok(!/payload too large/i.test(last) && JSON.stringify(first).length < 20_000, 'a page is small');
  const replies = []; let updated = 0;
  const click = (userId) => ({ customId: 'pg::bots::5::1::::::next', user: { id: userId }, guild: crowded, locale: 'en-US', guildLocale: 'en-US', reply: async (payload) => replies.push(payload), update: async () => { updated += 1; } });
  await handlePager(click('6'));
  assert.equal(updated, 0, 'somebody else cannot turn the page');
  assert.match(JSON.stringify(replies[0]), /Only <@5> can use these buttons/);
  await handlePager(click('5'));
  assert.equal(updated, 1, 'the author turns it');
  // A very long text still fits one card: the longest names, 10 to a page.
  const longNames = makeGuild('g3b', Array.from({ length: 10 }, (_, i) => bot(String(300 + i), 'N'.repeat(32), 1000 + i, { tag: `${'T'.repeat(32)}#0`, verified: true })));
  assert.ok(text((await run(longNames))[0]).length < 4000, 'a page of the longest names fits the 4000 characters of a card');

  // A big server is never read member by member: only the cache, and it says so.
  const big = makeGuild('g4', [bot('1', 'Petto', 1000), bot('8', 'Known', 500)], { memberCount: 250_000 });
  const bigOut = text((await run(big))[0]);
  assert.equal(big.fetched, 0, 'the members of a big server are not fetched');
  assert.match(bigOut, /Bots in this server \(2\+\)/);
  assert.match(bigOut, /only the bots Petto already knows are listed/, 'it says honestly that the list may be incomplete');
  // A server of a medium size is read once in a while, not at every look or page.
  const medium = makeGuild('g5', [bot('9', 'Seen', 1000)], { memberCount: 1500 });
  await run(medium); await run(medium); await buildPage('bots', { guild: medium, userId: '5', page: 0 });
  assert.equal(medium.fetched, 1, 'the members are asked for once, not at each page');
  assert.match(text((await run(medium))[0]), /only the bots Petto already knows/, 'still says so when the cache stays short');
  // Discord cannot give the members: it still answers.
  const broken = makeGuild('g6', [bot('9', 'Seen', 1000)], { memberCount: 40, fail: true });
  const brokenOut = text((await run(broken))[0]);
  assert.match(brokenOut, /Seen/); assert.match(brokenOut, /only the bots Petto already knows/);
  // A server with no bots.
  assert.match(text((await run(makeGuild('g7', [human('50', 'ana', 1)])))[0]), /This server has no bots/);

  // The rules of a server apply: they are keyed by the command name, for the prefix and for `/server bots`.
  assert.deepEqual(ruleNames(command), ['bots']);
  const server = require('../src/commands/info/server');
  assert.ok(ruleNames(server, { subcommand: 'bots' }).includes('bots'), '`!disablecommand bots` turns off `/server bots` too');
  assert.ok(server.data.toJSON().options.some((option) => option.name === 'bots' && option.type === 1), '`/server bots` exists');

  // Spanish and Portuguese.
  const { t } = require('../src/i18n');
  for (const lang of ['es', 'pt-BR']) {
    assert.notEqual(t(lang, 'info.bots.title', { count: 2 }), t('en', 'info.bots.title', { count: 2 }));
    assert.match(text(await buildPage('bots', { guild, userId: '5', lang })), lang === 'es' ? /Bots de este servidor \(4\)/ : /Bots deste servidor \(4\)/);
  }
  console.log('Checked !bots: public, oldest first with Petto marked, paged, never pings, safe for big servers, rules apply.');
})().catch((error) => { console.error(error); process.exit(1); });

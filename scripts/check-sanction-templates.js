// Checks the custom messages of sanctions: the variables of a case, the DM, the reply where the command was used and the
// log entry, each with the server's template and without it, and when the template is missing or broken.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const templates = {};
const slots = {};
let brokenName = null;
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => { if (name === brokenName) throw new Error('db down'); return templates[name] ? { name, data: templates[name] } : null; } });
stub('src/db/sanctionTemplates.js', { templateFor: async (guildId, type, slot) => slots[`${type}:${slot}`] ?? slots[`default:${slot}`] ?? null });
stub('src/utils/cardService.js', { renderCardForMessage: async () => null, normalizeCardRef: () => null, CARD_FILE_NAME: 'card.png' });
const { sanctionContext, sanctionDM, sanctionReply, sanctionLogEmbed } = require('../src/utils/sanctionTemplates');
const { resolve } = require('../src/utils/embedVariables');

const { Collection } = require('discord.js');
const guild = {
  id: '9', name: 'Test Server', memberCount: 50, ownerId: '5', premiumTier: 0, premiumSubscriptionCount: 0, createdAt: new Date('2020-01-01'),
  iconURL: () => null, bannerURL: () => null,
  members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() },
};
const client = { user: { id: 'bot', username: 'Petto', displayAvatarURL: () => 'https://cdn.test/bot.png' } };
const target = { id: '111', username: 'rule_breaker', displayAvatarURL: () => 'https://cdn.test/t.png' };
const moderator = { id: '222', username: 'mod', displayAvatarURL: () => 'https://cdn.test/m.png' };

(async () => {
  // The context and the variables.
  const ctx = sanctionContext({ type: 'tempmute', guild, user: target, moderator, reason: 'spam', durationText: '2 hours', caseNumber: 7 });
  assert.equal(ctx.sanction.action, 'temporarily muted'); assert.equal(ctx.sanction.caseNumber, 7);
  assert.ok(ctx.sanction.expiresUnix > Date.now() / 1000 + 7000 && ctx.sanction.expiresUnix < Date.now() / 1000 + 7300, 'the end comes from the duration');
  const text = await resolve('{case.id}|{case.type}|{case.action}|{case.reason}|{case.duration}|{case.moderator}|{case.moderator_name}|{case.user}|{case.user_name}|{case.user_id}|{case.user_avatar}|{case.source}', ctx);
  assert.equal(text, '7|tempmute|temporarily muted|spam|2 hours|<@222>|mod|<@111>|rule_breaker|111|https://cdn.test/t.png|A moderator');
  assert.ok((await resolve('{case.expires}', ctx)).startsWith('<t:'));
  const plain = sanctionContext({ type: 'ban', guild, user: target, moderator: client.user, reason: '', source: 'automod' });
  assert.equal(await resolve('{case.reason}|{case.duration}|{case.expires}|{case.source}', plain), 'No reason provided.|Permanent|Never|Automod');
  assert.equal(await resolve('{case.id}', {}), '', 'outside a sanction the variables are empty');

  // The DM.
  let dm = await sanctionDM({ type: 'ban', guild, client, reason: 'rules', user: target });
  assert.equal(typeof dm, 'string', 'with no template the usual text is sent');
  assert.ok(dm.includes('banned from'));
  templates.dmcard = { content: '', embeds: [{ title: 'You were {case.action}', description: 'Reason: {case.reason}\nBy {case.moderator_name} in {server_name}', color: 0xff0000 }], buttons: [] };
  slots['default:dm'] = 'dmcard';
  dm = await sanctionDM({ type: 'warn', guild, client, reason: 'be nice', user: target, moderator, caseNumber: 3 });
  assert.equal(typeof dm, 'object');
  assert.equal(dm.embeds[0].toJSON().title, 'You were warned'); assert.ok(dm.embeds[0].toJSON().description.includes('Reason: be nice\nBy mod in Test Server'));
  slots['ban:dm'] = 'missing';
  assert.equal(typeof (await sanctionDM({ type: 'ban', guild, client, reason: 'x', user: target })), 'string', 'a template that does not exist falls back to the usual text');
  brokenName = 'dmcard'; slots['kick:dm'] = 'dmcard';
  assert.equal(typeof (await sanctionDM({ type: 'kick', guild, client, reason: 'x', user: target })), 'string', 'a template that fails falls back too');
  brokenName = null;
  const viaMember = await sanctionDM({ type: 'warn', guild, client, reason: 'x', member: { user: target, id: '111' } });
  assert.ok(['string', 'object'].includes(typeof viaMember), 'a member that is not complete never stops the DM, the usual text is sent');

  // The reply where the command was used.
  const modCase = { case_number: 12, type: 'ban', expires_at: null };
  const replies = [];
  const makeInteraction = (extra = {}) => ({ guild, channel: { send: async (payload) => { replies.push(['channel', payload]); } }, editReply: async (payload) => { replies.push(['edit', payload]); }, ...extra });
  let interaction = makeInteraction();
  await sanctionReply(interaction, { type: 'ban', modCase, target, moderator, reason: 'r' });
  assert.equal(replies.at(-1)[0], 'edit'); assert.ok(replies.at(-1)[1].components, 'with no template the case card is shown');
  templates.replycard = { content: 'Case {case.id} closed', embeds: [{ title: '{case.user_name} was {case.action}', description: '{case.reason}' }], buttons: [] };
  slots['ban:reply'] = 'replycard';
  interaction = makeInteraction({ deleteReply: async () => { replies.push(['delete']); }, followUp: async (payload) => { replies.push(['followUp', payload]); } });
  await sanctionReply(interaction, { type: 'ban', modCase, target, moderator, reason: 'being rude' });
  assert.deepEqual(replies.slice(-2).map((entry) => entry[0]), ['delete', 'followUp'], 'the deferred card is removed and the custom message follows');
  assert.equal(replies.at(-1)[1].content, 'Case 12 closed'); assert.equal(replies.at(-1)[1].embeds[0].toJSON().title, 'rule_breaker was banned');
  interaction = makeInteraction();
  await sanctionReply(interaction, { type: 'ban', modCase, target, moderator, reason: 'r' });
  assert.equal(replies.at(-1)[0], 'edit'); assert.ok(replies.at(-1)[1].embeds, 'a prefix command has no deferred card to remove, so the message just replaces it');
  interaction = makeInteraction({ deleteReply: async () => {}, followUp: async () => { throw new Error('gone'); } });
  await sanctionReply(interaction, { type: 'ban', modCase, target, moderator, reason: 'r' });
  assert.equal(replies.at(-1)[0], 'channel', 'when the follow-up fails the message is posted in the channel');

  // The log entry.
  assert.equal(await sanctionLogEmbed({ modCase, guild, target, moderator, reason: 'r' }), null, 'with no log template the usual entry is kept');
  templates.logcard = { content: '', embeds: [{ title: 'Case #{case.id}', description: '{case.user} by {case.moderator}: {case.reason}', color: 0x00ff00 }], buttons: [] };
  slots['ban:log'] = 'logcard';
  const entry = await sanctionLogEmbed({ modCase, guild, target, moderator, reason: 'ban evasion' });
  assert.equal(entry.title, 'Case #12'); assert.equal(entry.description, '<@111> by <@222>: ban evasion'); assert.equal(entry.color, 0x00ff00);
  // The command: set, clear and list, with a template that has to exist.
  const store = new Map();
  stub('src/db/guilds.js', { ensureGuild: async () => ({}) });
  stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'ok' }, TYPE_EMOJI: {} });
  stub('src/utils/caseCard.js', { textCard: (text) => ({ text }), COLORS: {}, buildCaseCard: () => ({}) });
  stub('src/db/sanctionTemplates.js', {
    TYPES: ['default', 'ban', 'warn'],
    templateFor: async () => null,
    listTemplates: async () => store,
    setTemplates: async (g, type, slotsPatch) => { const cur = store.get(type) ?? {}; store.set(type, { ...cur, ...slotsPatch }); },
  });
  const command = require('../src/commands/moderation/sanctionmessage');
  const run = async (sub, options) => {
    const out = [];
    await command.execute({ guild, options: { getSubcommand: () => sub, getString: (name) => options[name] ?? null }, deferReply: async () => {}, editReply: async (payload) => { out.push(payload.components[0].text); } });
    return out[0];
  };
  assert.ok((await run('set', { type: 'ban', slot: 'dm', template: 'nope' })).includes('No saved embed'), 'a template that does not exist is refused');
  assert.equal(store.size, 0);
  assert.ok((await run('set', { type: 'ban', slot: 'dm', template: 'dmcard' })).includes('now uses'));
  assert.equal(store.get('ban').dm, 'dmcard');
  assert.ok((await run('list', {})).includes('dmcard'));
  await run('clear', { type: 'ban', slot: 'dm' });
  assert.equal(store.get('ban').dm, null);
  console.log('Checked the sanction variables, DM, reply and log with and without a template.');
})().catch((error) => { console.error(error); process.exit(1); });

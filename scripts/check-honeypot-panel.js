// Checks what the honeypot posts in the bait channel: Petto's warning panel, the text or saved embed of the server, or nothing,
// and the command that chooses it.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, MessageFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); }, rpc() { throw new Error('no database'); } });
stub('src/config.js', { ownerId: 'owner', developerIds: [] });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO', ALERT: '!', STAR: '*' } });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
const templates = new Map();
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => templates.get(`${guildId}:${name}`) ?? null });

let row = { guild_id: 'g1', channel_id: 'bait', punishment: 'softban', panel_message_id: null, caught_count: 4, panel_mode: 'default', panel_text: '', panel_template: null };
stub('src/db/honeypot.js', {
  PUNISHMENTS: ['ban', 'softban', 'kick'],
  getHoneypot: async (guildId, channelId) => (channelId === 'bait' ? { ...row } : null),
  listHoneypots: async () => [{ ...row }],
  upsertHoneypot: async () => ({ ...row }),
  setPanelSettings: async (guildId, channelId, changes) => { row = { ...row, ...changes }; return { ...row }; },
  setMemberSettings: async (guildId, channelId, changes) => { row = { ...row, ...changes }; return { ...row }; },
  setPanelMessage: async (guildId, channelId, id) => { row = { ...row, panel_message_id: id }; return { ...row }; },
  claimHoneypotUser: async () => true, incrementTrigger: async () => 1, clearHoneypotUser: async () => {}, removeHoneypot: async () => true,
});
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/db/modActions.js', { createCase: async () => ({}) });
stub('src/utils/caseLog.js', { logSanction: async () => {} });
stub('src/utils/sanctionTemplates.js', { sanctionDM: async () => ({}) });
stub('src/logging/engine.js', { sendLog: async () => {} });

const honeypot = require('../src/utils/honeypot');
const command = require('../src/commands/automation/honeypot');

const guild = { id: 'g1', name: 'Mine', ownerId: 'owner', memberCount: 100, premiumTier: 0, premiumSubscriptionCount: 0, createdTimestamp: 1_600_000_000_000, iconURL: () => 'https://cdn.example/g.png', bannerURL: () => null, splashURL: () => null, members: { cache: new Collection() }, channels: { cache: new Collection() }, roles: { cache: new Collection() }, emojis: { cache: new Collection() }, stickers: { cache: new Collection() } };
const sentLog = []; const deleted = []; const edited = [];
let messages = new Map();
const channel = {
  id: 'bait', guild, toString: () => '<#bait>',
  messages: { fetch: async (id) => messages.get(id) ?? null },
  send: async (payload) => { const message = { id: `p${sentLog.length + 1}`, author: { id: 'bot' }, edit: async (next) => { edited.push(next); if (message.v2 && !(next.flags & MessageFlags.IsComponentsV2)) throw new Error('cannot change'); return message; }, delete: async () => { deleted.push(message.id); messages.delete(message.id); }, react: async () => {} }; message.v2 = Boolean(payload.flags & MessageFlags.IsComponentsV2); sentLog.push(payload); messages.set(message.id, message); return message; },
};
const client = { user: { id: 'bot' } };

(async () => {
  // The three modes.
  let payload = await honeypot.renderPanel(channel, { ...row, panel_mode: 'default' });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2); assert.equal(payload.files.length, 1, 'Petto\'s panel has its picture');
  assert.equal(await honeypot.renderPanel(channel, { ...row, panel_mode: 'none' }), null, 'none posts nothing');
  payload = await honeypot.renderPanel(channel, { ...row, panel_mode: 'custom', panel_text: 'Do not write in {honeypot.channel}: {honeypot.action}. {honeypot.count} caught.' });
  assert.equal(payload.content, 'Do not write in <#bait>: a softban. 4 caught.'); assert.deepEqual(payload.allowedMentions, { parse: [] });
  templates.set('g1:warn', { data: { embeds: [{ title: 'Stop', description: '{honeypot.count} caught' }], reactions: ['⚠️'] } });
  payload = await honeypot.renderPanel(channel, { ...row, panel_mode: 'custom', panel_text: 'ignored', panel_template: 'warn' });
  assert.equal(payload.embeds.length, 1); assert.deepEqual(payload.reactions, ['⚠️']);
  payload = await honeypot.renderPanel(channel, { ...row, panel_mode: 'custom', panel_template: 'missing', panel_text: 'Fallback text' }); assert.equal(payload.content, 'Fallback text', 'a missing embed gives the text');
  payload = await honeypot.renderPanel(channel, { ...row, panel_mode: 'custom', panel_template: 'missing', panel_text: '' }); assert.equal(payload.flags, MessageFlags.IsComponentsV2, 'a custom message with nothing to say gives Petto\'s panel');

  // Posting and changing.
  row = { ...row, panel_mode: 'default', panel_message_id: null };
  let result = await honeypot.createOrUpdatePanel(client, channel, row); assert.equal(sentLog.length, 1); assert.equal(result.panel_message_id, 'p1');
  row = { ...row, panel_mode: 'custom', panel_text: 'Plain text', panel_message_id: 'p1' };
  result = await honeypot.createOrUpdatePanel(client, channel, row);
  assert.deepEqual(deleted, ['p1'], 'the panel (a V2 message) can not become plain text, so it is replaced'); assert.equal(sentLog.length, 2); assert.equal(sentLog[1].content, 'Plain text'); assert.equal(result.panel_message_id, 'p2');
  row = { ...row, panel_text: 'Edited text', panel_message_id: 'p2' };
  result = await honeypot.createOrUpdatePanel(client, channel, row); assert.equal(sentLog.length, 2, 'the same kind of message is edited in place'); assert.equal(edited.at(-1).content, 'Edited text');
  row = { ...row, panel_mode: 'none', panel_message_id: 'p2' };
  result = await honeypot.createOrUpdatePanel(client, channel, row); assert.ok(deleted.includes('p2'), 'none takes the message away'); assert.equal(result.panel_message_id, null); assert.equal(sentLog.length, 2);
  result = await honeypot.createOrUpdatePanel(client, channel, { ...row, panel_message_id: null }); assert.equal(sentLog.length, 2, 'and posts nothing');

  // The command.
  const talk = async (values) => {
    const out = [];
    const pick = (name) => (name in values ? values[name] : null);
    const interaction = { guild, client, options: { getSubcommand: () => 'panel', getChannel: (name) => (name in values ? values[name] : null), getString: pick }, deferReply: async () => {}, editReply: async (reply) => { out.push(reply.components[0].text); } };
    await command.execute(interaction);
    return out.join('\n');
  };
  row = { ...row, panel_mode: 'default', panel_text: '', panel_template: null, panel_message_id: null };
  assert.match(await talk({ channel, mode: 'custom' }), /give a `text` or a saved `template`/);
  assert.match(await talk({ channel, mode: 'custom', text: 'No talking {honeypot.channel}' }), /your text is posted in/); assert.deepEqual([row.panel_mode, row.panel_text], ['custom', 'No talking {honeypot.channel}']);
  assert.match(await talk({ channel, mode: 'custom', template: 'nope' }), /no saved embed called `nope`/);
  assert.match(await talk({ channel, mode: 'custom', template: 'warn' }), /saved embed `warn` is posted in/); assert.equal(row.panel_template, 'warn');
  assert.match(await talk({ channel, mode: 'custom', template: 'none' }), /your text is posted in/); assert.equal(row.panel_template, null);
  assert.match(await talk({ channel, mode: 'none' }), /Nothing is posted in/);
  assert.match(await talk({ channel, mode: 'default' }), /Petto's warning panel is posted in/);
  assert.match(await talk({ channel, mode: 'loud' }), /`default`, `custom` or `none`/);
  assert.match(await talk({ channel: { ...channel, id: 'other' }, mode: 'none' }), /is not a honeypot channel/);
  assert.equal(command.prefixOnly, true);

  // The panel, its button and the command answer in the server's language.
  const { buildHoneypotPanel, buildHoneypotStatsPanel } = require('../src/utils/honeypotPanel');
  const panelText = (lang) => JSON.stringify(buildHoneypotPanel({ punishment: 'ban', caught_count: 2, lang }).toJSON());
  assert.match(panelText('es'), /NO ENVÍES MENSAJES EN ESTE CANAL[\s\S]*\*\*un baneo\*\*[\s\S]*Expulsiones: 2/);
  assert.match(panelText('pt-BR'), /NÃO ENVIE MENSAGENS NESTE CANAL[\s\S]*\*\*um banimento\*\*[\s\S]*Expulsões: 2/);
  assert.match(JSON.stringify(buildHoneypotStatsPanel({ punishment: 'kick', caughtCount: 1, channelId: 'bait', lang: 'es' }).toJSON()), /\*\*Canal:\*\* <#bait>/);
  payload = await honeypot.renderPanel(channel, { ...row, panel_mode: 'custom', panel_template: null, panel_text: '{honeypot.action}' }, 'pt-BR');
  assert.equal(payload.content, 'um softban', 'the {honeypot.action} variable follows the language');
  const talkIn = async (lang, values) => talk({ ...values, pettoLangForCheck: lang });
  const original = command.execute;
  command.execute = (interaction) => original({ ...interaction, pettoLang: interaction.options.getString('pettoLangForCheck') });
  assert.match(await talkIn('es', { channel, mode: 'loud' }), /El mensaje puede ser `default`, `custom` o `none`\./);
  assert.match(await talkIn('pt-BR', { channel, mode: 'none' }), /Nada é publicado em <#bait>/);
  command.execute = original;

  // What the caught member gets: the DM, and for a softban a single-use invite back made outside the bait channels.
  const { ChannelType, PermissionFlagsBits } = require('discord.js');
  const can = (flags) => ({ has: (flag) => flags.includes(flag) });
  const invites = [];
  const textChannel = (id, position, botFlags, everyoneSees = true) => ({
    id, type: ChannelType.GuildText, rawPosition: position,
    permissionsFor: (who) => (who === 'everyone' ? can(everyoneSees ? [PermissionFlagsBits.ViewChannel] : []) : can(botFlags)),
    createInvite: async (options) => { const invite = { channel: id, options, url: `https://discord.gg/i${invites.length + 1}`, deleted: false, delete: async () => { invite.deleted = true; } }; invites.push(invite); return invite; },
  });
  const INVITE = [PermissionFlagsBits.CreateInstantInvite];
  const dmGuild = (list) => ({ id: 'g1', name: 'Mine', members: { me: { id: 'bot' } }, roles: { everyone: 'everyone' }, rulesChannel: null, systemChannel: null, channels: { cache: new Map(list.map((c) => [c.id, c])) } });
  const author = (closed = false) => { const got = []; return { id: 'u1', got, send: async (payload) => { if (closed) throw new Error('Cannot send messages to this user'); got.push(payload); return {}; } }; };
  const send = (guildRow, member, g) => honeypot.messageCaughtMember({ guild: g, client, author: member, member: null, config: guildRow, punishment: guildRow.punishment, reason: 'r', lang: 'en' });

  let member = author();
  const g = dmGuild([textChannel('bait', 0, INVITE), textChannel('staff', 1, INVITE, false), textChannel('general', 2, INVITE)]);
  assert.equal(await send({ punishment: 'softban' }, member, g), 'sentInvite', 'softban: the DM and an invite back by default');
  assert.equal(member.got.length, 2); assert.match(member.got[1].content, /join \*\*Mine\*\* again[\s\S]*https:\/\/discord\.gg\/i1/);
  assert.equal(invites[0].channel, 'general', 'never the bait channel, nor a channel members can not see');
  assert.deepEqual([invites[0].options.maxUses, invites[0].options.maxAge, invites[0].options.unique], [1, 7 * 24 * 3600, true]);
  member = author();
  assert.equal(await send({ punishment: 'softban', reinvite: false }, member, g), 'sent'); assert.equal(member.got.length, 1, 'no invite when it is off');
  member = author();
  assert.equal(await send({ punishment: 'ban' }, member, g), 'sent'); assert.equal(invites.length, 1, 'a ban never gets an invite back');
  member = author();
  assert.equal(await send({ punishment: 'softban', dm_member: false }, member, g), 'off'); assert.equal(member.got.length, 0, 'the DM can be turned off');
  member = author(true);
  assert.equal(await send({ punishment: 'softban' }, member, g), 'closed', 'closed DMs are reported'); assert.equal(invites.at(-1).deleted, true, 'and the unused invite is deleted');
  member = author();
  assert.equal(await send({ punishment: 'softban' }, member, dmGuild([textChannel('general', 0, [])])), 'noInvite', 'without Create Invite the DM still goes');
  assert.equal(member.got.length, 1);
  console.log('Checked the honeypot message: Petto\'s panel, the text or embed of the server, nothing, the command, and the DM with its invite back.');
})().catch((error) => { console.error(error); process.exit(1); });

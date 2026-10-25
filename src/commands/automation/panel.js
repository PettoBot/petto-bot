// Panels: the message that shows button responders, as buttons or as one dropdown menu. `!panel send` posts it, and
// sending it again to the same channel updates the message that is already there.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const respondersDb = require('../../db/responders');
const { getTemplate } = require('../../db/embedTemplates');
const { getGuildPremium, getGuildLimits, PREMIUM_LIMITS } = require('../../db/premium');
const { normalizeName, MAX_ITEMS } = require('../../utils/responderEngine');
const { panelPayload } = require('../../utils/panelMessage');
const { applyReactReplies } = require('../../utils/messageFlags');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf } = require('../../i18n');

const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);
const note = (text) => textCard(text);
const textChannels = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

function shared(builder) {
  return builder
    .addStringOption((o) => o.setName('content').setDescription('The text above the buttons').setMaxLength(2000))
    .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed to show instead of the text'))
    .addStringOption((o) => o.setName('placeholder').setDescription('The grey text of a menu before choosing').setMaxLength(100))
    .addBooleanOption((o) => o.setName('exclusive').setDescription('In a menu: choosing one takes back the roles the others give'));
}

const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Messages with buttons or a menu of button responders.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) => shared(s.setName('create').setDescription('Create a panel made of buttons or a select menu.')
    .addStringOption((o) => o.setName('name').setDescription('The name of the panel').setRequired(true))
    .addStringOption((o) => o.setName('kind').setDescription('buttons or select').setRequired(true).addChoices({ name: 'buttons', value: 'buttons' }, { name: 'select', value: 'select' }))))
  .addSubcommand((s) => shared(s.setName('edit').setDescription('Change a panel. Only what you give changes.')
    .addStringOption((o) => o.setName('name').setDescription('The name of the panel').setRequired(true))))
  .addSubcommand((s) => s.setName('add').setDescription('Show a responder in a panel.')
    .addStringOption((o) => o.setName('name').setDescription('The panel').setRequired(true))
    .addStringOption((o) => o.setName('responder').setDescription('The responder').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('Stop showing a responder in a panel.')
    .addStringOption((o) => o.setName('name').setDescription('The panel').setRequired(true))
    .addStringOption((o) => o.setName('responder').setDescription('The responder').setRequired(true)))
  .addSubcommand((s) => s.setName('send').setDescription('Post the panel, or update it if it is already in that channel.')
    .addStringOption((o) => o.setName('name').setDescription('The panel').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('Where (this channel by default)').addChannelTypes(...textChannels)))
  .addSubcommand((s) => s.setName('delete').setDescription('Delete a panel. The message that was posted stops working.')
    .addStringOption((o) => o.setName('name').setDescription('The panel').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('List every panel of this server with its channel.'));

async function execute(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const done = (component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
  const sub = interaction.options.getSubcommand();
  if (sub === 'list') return list(interaction, done, lang);
  const name = normalizeName(interaction.options.getString('name', true));
  if (!name) return done(note(t(lang, 'automation.panel.badName')));
  if (sub === 'create' || sub === 'edit') return save(interaction, name, sub === 'edit', done, lang);
  if (sub === 'delete') {
    const panel = await respondersDb.getPanel(interaction.guild.id, name);
    const removed = await respondersDb.deletePanel(interaction.guild.id, name);
    if (removed && panel?.channel_id && panel.message_id) {
      const channel = await interaction.guild.channels.fetch(panel.channel_id).catch(() => null);
      const message = await channel?.messages?.fetch(panel.message_id).catch(() => null);
      if (message) await message.edit({ components: [] }).catch(() => null);
    }
    return done(removed ? ok(t(lang, 'automation.panel.deleted', { name })) : note(t(lang, 'automation.panel.missing', { name })));
  }
  const panel = await respondersDb.getPanel(interaction.guild.id, name);
  if (!panel) return done(note(t(lang, 'automation.panel.missingCreate', { name })));
  if (sub === 'send') return send(interaction, panel, done, lang);
  return changeItems(interaction, panel, sub === 'add', done, lang);
}

async function save(interaction, name, editing, done, lang) {
  const guildId = interaction.guild.id;
  const existing = await respondersDb.getPanel(guildId, name);
  if (editing && !existing) return done(note(t(lang, 'automation.panel.missing', { name })));
  if (!editing && existing) return done(note(t(lang, 'automation.panel.exists', { name })));
  if (!existing) {
    const premium = await getGuildPremium(guildId).catch(() => ({ active: false }));
    const limit = getGuildLimits(premium).componentPanels;
    if ((await respondersDb.countPanels(guildId)) >= limit) return done(note(t(lang, premium?.active ? 'automation.panel.full' : 'automation.panel.fullFree', { limit, premium: PREMIUM_LIMITS.componentPanels })));
  }
  const values = { ...(existing ?? respondersDb.PANEL_DEFAULTS) };
  delete values.id; delete values.guild_id; delete values.created_at; delete values.name;
  const kind = (interaction.options.getString('kind') ?? '').toLowerCase();
  if (!editing) { if (!['buttons', 'select'].includes(kind)) return done(note(t(lang, 'automation.panel.badKind'))); values.kind = kind; }
  const content = interaction.options.getString('content');
  const template = (interaction.options.getString('template') ?? '').trim();
  const placeholder = interaction.options.getString('placeholder');
  const exclusive = interaction.options.getBoolean('exclusive');
  if (content !== null) values.content = content.slice(0, 2000);
  if (template) {
    if (template.toLowerCase() === 'none') values.embed_template = null;
    else if (!(await getTemplate(guildId, template).catch(() => null))?.data) return done(note(t(lang, 'automation.panel.templateMissing', { name: template })));
    else values.embed_template = template;
  }
  if (placeholder !== null) values.placeholder = placeholder.slice(0, 100);
  if (exclusive !== null) values.exclusive = exclusive;
  await respondersDb.savePanel(guildId, name, values);
  return done(ok(t(lang, editing ? 'automation.panel.saved' : 'automation.panel.ready', { name })));
}

async function changeItems(interaction, panel, adding, done, lang) {
  const responderName = normalizeName(interaction.options.getString('responder', true));
  const responder = responderName ? await respondersDb.getByName(interaction.guild.id, responderName) : null;
  if (adding) {
    if (!responder) return done(note(t(lang, 'automation.panel.noResponder')));
    if (panel.responders.includes(responder.name)) return done(note(t(lang, 'automation.panel.alreadyIn', { responder: responder.name, panel: panel.name })));
    if (panel.responders.length >= MAX_ITEMS) return done(note(t(lang, 'automation.panel.maxItems', { max: MAX_ITEMS })));
    await respondersDb.savePanel(interaction.guild.id, panel.name, { ...strip(panel), responders: [...panel.responders, responder.name] });
    return done(ok(t(lang, 'automation.panel.added', { responder: responder.name, panel: panel.name })));
  }
  if (!responderName || !panel.responders.includes(responderName)) return done(note(t(lang, 'automation.panel.notShown', { panel: panel.name })));
  await respondersDb.savePanel(interaction.guild.id, panel.name, { ...strip(panel), responders: panel.responders.filter((item) => item !== responderName) });
  return done(ok(t(lang, 'automation.panel.removed', { responder: responderName, panel: panel.name })));
}

function strip(panel) {
  const values = { ...panel };
  delete values.id; delete values.guild_id; delete values.created_at; delete values.name;
  return values;
}

async function send(interaction, panel, done, lang) {
  const guild = interaction.guild;
  const target = interaction.options.getChannel('channel') ?? (panel.channel_id && (await guild.channels.fetch(panel.channel_id).catch(() => null))) ?? interaction.channel;
  if (!target?.isTextBased?.()) return done(note(t(lang, 'automation.panel.cannotPost')));
  const permissions = target.permissionsFor?.(guild.members.me);
  if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return done(note(t(lang, 'automation.panel.needAccess', { channel: `${target}` })));
  const responders = await respondersDb.listResponders(guild.id);
  if (!panel.responders.some((name) => responders.some((responder) => responder.name === name))) return done(note(t(lang, 'automation.panel.empty')));
  const payload = await panelPayload(panel, responders, { guild, channel: target, member: interaction.member, user: interaction.user }, lang);
  let message = null;
  if (panel.message_id && panel.channel_id === target.id) {
    message = await target.messages.fetch(panel.message_id).catch(() => null);
    if (message) message = await message.edit(payload).catch(() => null);
  }
  const updated = Boolean(message);
  if (!message) {
    message = await target.send(payload).catch(() => null);
    if (message && payload.reactions?.length) await applyReactReplies(message, payload.reactions);
  }
  if (!message) return done(note(t(lang, 'automation.panel.postFailed')));
  await respondersDb.savePanel(guild.id, panel.name, { ...strip(panel), channel_id: target.id, message_id: message.id });
  return done(ok(t(lang, updated ? 'automation.panel.updated' : 'automation.panel.posted', { name: panel.name, channel: `${target}` })));
}

async function list(interaction, done, lang) {
  const rows = await respondersDb.listPanels(interaction.guild.id);
  if (!rows.length) return done(note(t(lang, 'automation.panel.listEmpty')));
  return done(note([t(lang, 'automation.panel.listTitle'), ...rows.slice(0, 40).map((row) => `\`${row.name}\` · ${row.kind} · ${tn(lang, 'automation.panel.responders', row.responders.length, { count: row.responders.length })}${row.channel_id ? ` · <#${row.channel_id}>` : ''}`)].join('\n')));
}

module.exports = { prefixOnly: true, aliases: ['panels'], data, execute };

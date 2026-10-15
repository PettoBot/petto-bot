const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const reactionDb = require('../../db/reactionTriggers');
const { ensureGuild } = require('../../db/guilds');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { resolveChannels } = require('../../utils/channelResolve');
const { resolveRoles } = require('../../utils/roleResolve');
const { t, tn, languageOf } = require('../../i18n');

const MODE_CHOICES = [
  { name: 'contains', value: 'contains' }, { name: 'starts with', value: 'startsWith' },
  { name: 'ends with', value: 'endsWith' }, { name: 'exact', value: 'exact' },
];

module.exports = {
  aliases: ['react'],
  data: new SlashCommandBuilder()
    .setName('reaction')
    .setDescription('Automatically react to matching messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('react').setDescription('React to a message from its Discord link.').addStringOption((o) => o.setName('message_link').setDescription('Message link').setRequired(true)).addStringOption((o) => o.setName('emoji').setDescription('Emoji').setRequired(true)))
    .addSubcommand((s) => s.setName('add').setDescription('Create a reaction trigger.').addStringOption((o) => o.setName('emoji').setDescription('Emoji to add').setRequired(true)).addStringOption((o) => o.setName('trigger').setDescription('Word or phrase to match').setRequired(true)).addStringOption((o) => o.setName('mode').setDescription('Match mode').addChoices(...MODE_CHOICES).setRequired(false)).addBooleanOption((o) => o.setName('case_sensitive').setDescription('Respect uppercase/lowercase').setRequired(false)).addStringOption((o) => o.setName('channels').setDescription('Channel mentions or IDs, empty means all').setRequired(false)).addStringOption((o) => o.setName('roles').setDescription('Role mentions or IDs, empty means everyone').setRequired(false)).addIntegerOption((o) => o.setName('cooldown_seconds').setDescription('Per-member cooldown, 0 disables').setMinValue(0).setMaxValue(86400).setRequired(false)))
    .addSubcommand((s) => s.setName('edit').setDescription('Edit a reaction trigger.').addStringOption((o) => o.setName('id').setDescription('Trigger ID from !reaction list').setRequired(true)).addStringOption((o) => o.setName('mode').setDescription('Match mode').addChoices(...MODE_CHOICES).setRequired(false)).addBooleanOption((o) => o.setName('case_sensitive').setDescription('Respect uppercase/lowercase').setRequired(false)).addStringOption((o) => o.setName('channels').setDescription('Channel mentions or IDs').setRequired(false)).addStringOption((o) => o.setName('roles').setDescription('Role mentions or IDs').setRequired(false)).addIntegerOption((o) => o.setName('cooldown_seconds').setDescription('Per-member cooldown').setMinValue(0).setMaxValue(86400).setRequired(false)).addBooleanOption((o) => o.setName('enabled').setDescription('Enable this trigger').setRequired(false)))
    .addSubcommand((s) => s.setName('owner').setDescription('View who created a trigger.').addStringOption((o) => o.setName('trigger').setDescription('Trigger phrase').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove one reaction trigger.').addStringOption((o) => o.setName('emoji').setDescription('Emoji').setRequired(true)).addStringOption((o) => o.setName('trigger').setDescription('Trigger phrase').setRequired(true)))
    .addSubcommand((s) => s.setName('removeall').setDescription('Remove every emoji for a trigger.').addStringOption((o) => o.setName('trigger').setDescription('Trigger phrase').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List reaction triggers.'))
    .addSubcommand((s) => s.setName('reset').setDescription('Remove every reaction trigger.'))
    .addSubcommand((s) => s.setName('messages').setDescription('React to every message in a channel, announcements too; no emojis disables it.').addChannelOption((o) => o.setName('channel').setDescription('Text or announcement channel').setRequired(true)).addStringOption((o) => o.setName('emoji_1').setDescription('First emoji').setRequired(false)).addStringOption((o) => o.setName('emoji_2').setDescription('Second emoji').setRequired(false)).addStringOption((o) => o.setName('emoji_3').setDescription('Third emoji').setRequired(false)).addStringOption((o) => o.setName('emoji_4').setDescription('Fourth emoji').setRequired(false)).addStringOption((o) => o.setName('emoji_5').setDescription('Fifth emoji').setRequired(false)))
    .addSubcommand((s) => s.setName('messages_list').setDescription('List channels receiving automatic reactions.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'react') return reactToMessage(interaction);
    if (sub === 'add') return addTrigger(interaction);
    if (sub === 'edit') return editTrigger(interaction);
    if (sub === 'owner') return owner(interaction);
    if (sub === 'remove') return removeTrigger(interaction);
    if (sub === 'removeall') return removeAll(interaction);
    if (sub === 'list') return list(interaction);
    if (sub === 'reset') return reset(interaction);
    if (sub === 'messages') return configureMessages(interaction);
    return listMessages(interaction);
  },
};

function reply(interaction, content, color = 0x4b4f59) {
  return interaction.reply({ components: [textCard(content, color)], flags: MessageFlags.IsComponentsV2 });
}

async function addTrigger(interaction) {
  const lang = await languageOf(interaction);
  await ensureGuild(interaction.guild.id);
  try {
    const channelInput = interaction.options.getString('channels');
    const roleInput = interaction.options.getString('roles');
    const channelIds = channelInput ? resolveChannels(interaction.guild, channelInput).resolved.map((channel) => channel.id) : [];
    const roleIds = roleInput ? resolveRoles(interaction.guild, roleInput).resolved.map((role) => role.id) : [];
    const row = await reactionDb.addTrigger({ guildId: interaction.guild.id, emoji: interaction.options.getString('emoji', true), trigger: interaction.options.getString('trigger', true), ownerId: interaction.user.id, matchMode: interaction.options.getString('mode') ?? 'contains', channelIds, roleIds, caseSensitive: interaction.options.getBoolean('case_sensitive') ?? false, cooldownSeconds: interaction.options.getInteger('cooldown_seconds') ?? 0 });
    return reply(interaction, t(lang, 'automation.reaction.added', { emoji: EMOJI.APPROVE, id: row.id, reaction: row.emoji, trigger: row.trigger }), 0xa5ea7a);
  } catch (err) {
    return reply(interaction, err.message ?? t(lang, 'automation.reaction.createFailed'), 0xfe6465);
  }
}

async function editTrigger(interaction) {
  const lang = await languageOf(interaction);
  const id = interaction.options.getString('id', true);
  const patch = {};
  const mode = interaction.options.getString('mode');
  const channels = interaction.options.getString('channels');
  const roles = interaction.options.getString('roles');
  const caseSensitive = interaction.options.getBoolean('case_sensitive');
  const cooldown = interaction.options.getInteger('cooldown_seconds');
  const enabled = interaction.options.getBoolean('enabled');
  if (mode) patch.match_mode = mode;
  if (channels != null) patch.channel_ids = resolveChannels(interaction.guild, channels).resolved.map((channel) => channel.id);
  if (roles != null) patch.role_ids = resolveRoles(interaction.guild, roles).resolved.map((role) => role.id);
  if (caseSensitive != null) patch.case_sensitive = caseSensitive;
  if (cooldown != null) patch.cooldown_seconds = cooldown;
  if (enabled != null) patch.enabled = enabled;
  if (!Object.keys(patch).length) return reply(interaction, t(lang, 'automation.reaction.needSetting'), 0xfe6465);
  const row = await reactionDb.updateTrigger(interaction.guild.id, id, patch);
  return reply(interaction, row ? t(lang, 'automation.reaction.updated', { emoji: EMOJI.APPROVE, id }) : t(lang, 'automation.reaction.missing'), row ? 0xa5ea7a : 0xfe6465);
}

async function owner(interaction) {
  const lang = await languageOf(interaction);
  const row = await reactionDb.getOwner(interaction.guild.id, interaction.options.getString('trigger', true));
  return reply(interaction, row ? t(lang, 'automation.reaction.owner', { user: `<@${row.owner_id}>` }) : t(lang, 'automation.reaction.noMatch'));
}

async function removeTrigger(interaction) {
  const lang = await languageOf(interaction);
  const removed = await reactionDb.removeTrigger(interaction.guild.id, interaction.options.getString('emoji', true), interaction.options.getString('trigger', true));
  return reply(interaction, removed ? t(lang, 'automation.reaction.removed', { emoji: EMOJI.APPROVE }) : t(lang, 'automation.reaction.removeMissing'), removed ? 0xa5ea7a : 0xfe6465);
}

async function removeAll(interaction) {
  const lang = await languageOf(interaction);
  const count = await reactionDb.removeAllForTrigger(interaction.guild.id, interaction.options.getString('trigger', true));
  return reply(interaction, count ? tn(lang, 'automation.reaction.removedMany', count, { count, emoji: EMOJI.APPROVE }) : t(lang, 'automation.reaction.noMatchAny'), count ? 0xa5ea7a : 0x4b4f59);
}

async function list(interaction) {
  const lang = await languageOf(interaction);
  const rows = await reactionDb.listTriggers(interaction.guild.id);
  const body = rows.length ? rows.map((row) => `${row.emoji}  **${row.trigger}** · #${row.id} · ${row.match_mode ?? 'contains'}${row.enabled === false ? ` · ${t(lang, 'automation.reaction.disabled')}` : ''}`).join('\n') : t(lang, 'automation.reaction.listEmpty');
  return reply(interaction, `${t(lang, 'automation.reaction.listTitle', { count: rows.length })}\n${body}`);
}

async function reset(interaction) {
  const lang = await languageOf(interaction);
  const count = await reactionDb.resetTriggers(interaction.guild.id);
  return reply(interaction, count ? tn(lang, 'automation.reaction.removedMany', count, { count, emoji: EMOJI.APPROVE }) : t(lang, 'automation.reaction.resetEmpty'), count ? 0xa5ea7a : 0x4b4f59);
}

async function configureMessages(interaction) {
  const lang = await languageOf(interaction);
  const emojis = ['emoji_1', 'emoji_2', 'emoji_3', 'emoji_4', 'emoji_5'].map((name) => interaction.options.getString(name)).filter(Boolean);
  const channel = interaction.options.getChannel('channel', true);
  if (!channel.isTextBased()) return reply(interaction, t(lang, 'automation.reaction.textChannel'), 0xfe6465);
  if (emojis.length > reactionDb.MAX_EMOJIS_PER_CHANNEL) return reply(interaction, t(lang, 'automation.reaction.tooManyEmojis', { max: reactionDb.MAX_EMOJIS_PER_CHANNEL }), 0xfe6465);
  await reactionDb.setMessageConfig({ guildId: interaction.guild.id, channelId: channel.id, emojis });
  return reply(interaction, emojis.length ? t(lang, 'automation.reaction.messagesOn', { emoji: EMOJI.APPROVE, channel: `<#${channel.id}>`, emojis: emojis.join(' ') }) : t(lang, 'automation.reaction.messagesOff', { emoji: EMOJI.APPROVE, channel: `<#${channel.id}>` }), 0xa5ea7a);
}

async function listMessages(interaction) {
  const lang = await languageOf(interaction);
  const rows = await reactionDb.listMessageConfigs(interaction.guild.id);
  const body = rows.length ? rows.map((row) => `<#${row.channel_id}> · ${(row.emojis ?? []).join(' ')}`).join('\n') : t(lang, 'automation.reaction.messagesEmpty');
  return reply(interaction, `${t(lang, 'automation.reaction.messagesTitle', { count: rows.length })}\n${body}`);
}

async function reactToMessage(interaction) {
  const lang = await languageOf(interaction);
  const link = interaction.options.getString('message_link', true).trim();
  const emoji = interaction.options.getString('emoji', true).trim();
  const match = link.match(/\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!match || match[1] !== interaction.guild.id) return reply(interaction, t(lang, 'automation.reaction.badLink'), 0xfe6465);
  const channel = await interaction.guild.channels.fetch(match[2]).catch(() => null);
  if (!channel?.isTextBased()) return reply(interaction, t(lang, 'automation.reaction.noChannel'), 0xfe6465);
  const message = await channel.messages.fetch(match[3]).catch(() => null);
  if (!message) return reply(interaction, t(lang, 'automation.reaction.noMessage'), 0xfe6465);
  try {
    await message.react(emoji);
    return reply(interaction, t(lang, 'automation.reaction.reacted', { emoji: EMOJI.APPROVE, reaction: emoji }), 0xa5ea7a);
  } catch {
    return reply(interaction, t(lang, 'automation.reaction.badEmoji'), 0xfe6465);
  }
}

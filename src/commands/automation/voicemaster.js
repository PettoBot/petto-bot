const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, InviteTargetType } = require('discord.js');
const voiceDb = require('../../db/voiceMaster');
const { textCard } = require('../../utils/caseCard');

const USER_ACTIONS = ['lock', 'unlock', 'ghost', 'reveal', 'claim', 'delete', 'rename', 'transfer', 'limit', 'permit', 'reject', 'disconnect', 'activity'];

module.exports = {
  aliases: ['vc'],
  data: new SlashCommandBuilder()
    .setName('voicemaster')
    .setDescription('Create and manage temporary voice channels.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('setup').setDescription('Configure the creator channel and management panel.').addChannelOption((o) => o.setName('creator').setDescription('Join-to-create voice channel.').addChannelTypes(ChannelType.GuildVoice).setRequired(true)).addChannelOption((o) => o.setName('panel').setDescription('Text channel for the control panel.').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)).addChannelOption((o) => o.setName('category').setDescription('Category for temporary channels.').addChannelTypes(ChannelType.GuildCategory).setRequired(false)).addIntegerOption((o) => o.setName('limit').setDescription('Default user limit, 0 means unlimited.').setMinValue(0).setMaxValue(99).setRequired(false)).addStringOption((o) => o.setName('name').setDescription('Name template: {user}, {user.name}, {user.display_name}.').setRequired(false)))
    .addSubcommand((s) => s.setName('disable').setDescription('Disable VoiceMaster and remove its panel.'))
    .addSubcommand((s) => s.setName('info').setDescription('View VoiceMaster configuration.'))
    .addSubcommand((s) => s.setName('panel').setDescription('Send the management panel again.'))
    .addSubcommand((s) => s.setName('lock').setDescription('Lock your temporary channel.'))
    .addSubcommand((s) => s.setName('unlock').setDescription('Unlock your temporary channel.'))
    .addSubcommand((s) => s.setName('ghost').setDescription('Hide your temporary channel.'))
    .addSubcommand((s) => s.setName('reveal').setDescription('Show your temporary channel.'))
    .addSubcommand((s) => s.setName('claim').setDescription('Claim a channel whose owner left.'))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete your temporary channel.'))
    .addSubcommand((s) => s.setName('rename').setDescription('Rename your temporary channel.').addStringOption((o) => o.setName('name').setDescription('New channel name.').setRequired(true)))
    .addSubcommand((s) => s.setName('transfer').setDescription('Transfer ownership.').addUserOption((o) => o.setName('user').setDescription('New owner.').setRequired(true)))
    .addSubcommand((s) => s.setName('limit').setDescription('Set the user limit.').addIntegerOption((o) => o.setName('limit').setDescription('0 to 99.').setMinValue(0).setMaxValue(99).setRequired(true)))
    .addSubcommand((s) => s.setName('permit').setDescription('Allow a member to join.').addUserOption((o) => o.setName('user').setDescription('Member.').setRequired(true)))
    .addSubcommand((s) => s.setName('reject').setDescription('Block a member from joining.').addUserOption((o) => o.setName('user').setDescription('Member.').setRequired(true)))
    .addSubcommand((s) => s.setName('disconnect').setDescription('Disconnect a member from your channel.').addUserOption((o) => o.setName('user').setDescription('Member.').setRequired(true)))
    .addSubcommand((s) => s.setName('activity').setDescription('Create a Watch Together activity invite.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setup(interaction);
    if (sub === 'disable') return disable(interaction);
    if (sub === 'info') return info(interaction);
    if (sub === 'panel') return resendPanel(interaction);
    if (USER_ACTIONS.includes(sub)) return executeAction(interaction, sub);
    return interaction.reply({ content: 'Unknown VoiceMaster action.', flags: MessageFlags.Ephemeral });
  },
};

async function setup(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server to configure VoiceMaster.', flags: MessageFlags.Ephemeral });
  const creator = interaction.options.getChannel('creator', true);
  const panel = interaction.options.getChannel('panel', true);
  const old = await voiceDb.getConfig(interaction.guild.id);
  if (old?.panel_channel_id && old?.panel_message_id) await deletePanel(interaction.guild, old.panel_channel_id, old.panel_message_id);
  const panelMessage = await sendPanel(panel);
  const config = await voiceDb.upsertConfig(interaction.guild.id, { creator_channel_id: creator.id, panel_channel_id: panel.id, panel_message_id: panelMessage.id, category_id: interaction.options.getChannel('category')?.id ?? creator.parentId ?? null, default_limit: interaction.options.getInteger('limit') ?? 0, default_name: interaction.options.getString('name') || '{user.name}' });
  return interaction.reply({ components: [textCard(`VoiceMaster configured. Creator: <#${config.creator_channel_id}> · Panel: <#${config.panel_channel_id}>`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function disable(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server to disable VoiceMaster.', flags: MessageFlags.Ephemeral });
  const row = await voiceDb.getConfig(interaction.guild.id);
  if (row?.panel_channel_id && row?.panel_message_id) await deletePanel(interaction.guild, row.panel_channel_id, row.panel_message_id);
  await voiceDb.removeConfig(interaction.guild.id);
  return interaction.reply({ components: [textCard('VoiceMaster disabled.', 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function info(interaction) {
  const row = await voiceDb.getConfig(interaction.guild.id);
  if (!row) return interaction.reply({ components: [textCard('VoiceMaster is not configured.', 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
  const count = await voiceDb.countTemps(interaction.guild.id);
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8399ff).setTitle('VoiceMaster').addFields({ name: 'Creator', value: `<#${row.creator_channel_id}>`, inline: true }, { name: 'Panel', value: `<#${row.panel_channel_id}>`, inline: true }, { name: 'Active channels', value: String(count), inline: true }, { name: 'Name template', value: `\`${row.default_name}\`` })] });
}

async function resendPanel(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server to resend the panel.', flags: MessageFlags.Ephemeral });
  const row = await voiceDb.getConfig(interaction.guild.id);
  if (!row?.panel_channel_id) return interaction.reply({ content: 'Configure VoiceMaster first.', flags: MessageFlags.Ephemeral });
  if (row.panel_message_id) await deletePanel(interaction.guild, row.panel_channel_id, row.panel_message_id);
  const message = await sendPanel(await interaction.guild.channels.fetch(row.panel_channel_id));
  await voiceDb.upsertConfig(interaction.guild.id, { panel_message_id: message.id });
  return interaction.reply({ components: [textCard('VoiceMaster panel resent.', 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function executeAction(interaction, action, overrides = {}) {
  const temp = await voiceDb.getTemp(interaction.member.voice?.channelId);
  if (!temp) return interaction.reply({ content: 'You must be inside a VoiceMaster temporary channel.', flags: MessageFlags.Ephemeral });
  if (['lock', 'unlock', 'ghost', 'reveal', 'rename', 'transfer', 'limit', 'permit', 'reject', 'disconnect', 'delete'].includes(action) && temp.owner_id !== interaction.user.id) return interaction.reply({ content: 'Only the channel owner can do that.', flags: MessageFlags.Ephemeral });
  const channel = interaction.guild.channels.cache.get(temp.channel_id);
  if (!channel) return interaction.reply({ content: 'That temporary channel no longer exists.', flags: MessageFlags.Ephemeral });
  if (action === 'claim') {
    const owner = await interaction.guild.members.fetch(temp.owner_id).catch(() => null);
    if (owner?.voice?.channelId === temp.channel_id) return interaction.reply({ content: 'The current owner is still in the channel.', flags: MessageFlags.Ephemeral });
    await voiceDb.updateTemp(temp.channel_id, { owner_id: interaction.user.id });
    return interaction.reply({ content: 'You now own this temporary channel.', flags: MessageFlags.Ephemeral });
  }
  if (action === 'delete') { await channel.delete().catch(() => {}); await voiceDb.removeTemp(temp.channel_id); return interaction.reply({ content: 'Temporary channel deleted.', flags: MessageFlags.Ephemeral }); }
  if (action === 'rename') { const name = String(overrides.name ?? interaction.options.getString('name', true)).trim().slice(0, 100); await channel.setName(name); return interaction.reply({ content: `Channel renamed to **${name}**.`, flags: MessageFlags.Ephemeral }); }
  if (action === 'transfer') { const targetId = overrides.userId ?? interaction.options.getUser('user', true).id; await voiceDb.updateTemp(temp.channel_id, { owner_id: targetId }); return interaction.reply({ content: `Ownership transferred to <@${targetId}>.`, flags: MessageFlags.Ephemeral }); }
  if (action === 'limit') { const limit = overrides.limit ?? interaction.options.getInteger('limit', true); await channel.setUserLimit(limit); await voiceDb.updateTemp(temp.channel_id, { user_limit: limit }); return interaction.reply({ content: `User limit set to **${limit || 'unlimited'}**.`, flags: MessageFlags.Ephemeral }); }
  if (action === 'permit' || action === 'reject') { const targetId = overrides.userId ?? interaction.options.getUser('user', true).id; return permissionAction(interaction, temp, channel, action, targetId); }
  if (action === 'disconnect') {
    const targetId = overrides.userId ?? interaction.options.getUser('user', true).id;
    if (targetId === temp.owner_id) return interaction.reply({ content: 'You cannot disconnect yourself as the owner.', flags: MessageFlags.Ephemeral });
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!member?.voice?.channelId || member.voice.channelId !== channel.id) return interaction.reply({ content: 'That member is not in your temporary channel.', flags: MessageFlags.Ephemeral });
    await member.voice.disconnect().catch(() => {});
    return interaction.reply({ content: `<@${targetId}> was disconnected.`, flags: MessageFlags.Ephemeral });
  }
  if (action === 'activity') {
    const invite = await channel.createInvite({ maxAge: 86400, targetType: InviteTargetType.EmbeddedApplication, targetApplication: '880218394199220334' }).catch(() => null);
    return interaction.reply({ content: invite ? `Watch Together: ${invite.url}` : 'Could not create an activity invite.', flags: MessageFlags.Ephemeral });
  }
  if (action === 'lock' || action === 'unlock') { await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: action === 'lock' ? false : null }); await voiceDb.updateTemp(temp.channel_id, { is_locked: action === 'lock' }); return interaction.reply({ content: `Channel ${action === 'lock' ? 'locked' : 'unlocked'}.`, flags: MessageFlags.Ephemeral }); }
  if (action === 'ghost' || action === 'reveal') { await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: action === 'ghost' ? false : null }); await voiceDb.updateTemp(temp.channel_id, { is_ghosted: action === 'ghost' }); return interaction.reply({ content: `Channel ${action === 'ghost' ? 'hidden' : 'visible'}.`, flags: MessageFlags.Ephemeral }); }
}

async function permissionAction(interaction, temp, channel, action, userId) {
  const trusted = new Set(temp.trusted_user_ids ?? []);
  const banned = new Set(temp.banned_user_ids ?? []);
  if (action === 'permit') { trusted.add(userId); banned.delete(userId); await channel.permissionOverwrites.edit(userId, { Connect: true, ViewChannel: true }); }
  else { trusted.delete(userId); banned.add(userId); await channel.permissionOverwrites.edit(userId, { Connect: false }); const member = await interaction.guild.members.fetch(userId).catch(() => null); if (member?.voice?.channelId === channel.id) await member.voice.disconnect().catch(() => {}); }
  await voiceDb.updateTemp(channel.id, { trusted_user_ids: [...trusted], banned_user_ids: [...banned] });
  return interaction.reply({ content: `<@${userId}> ${action === 'permit' ? 'can now join' : 'is blocked from'} this channel.`, flags: MessageFlags.Ephemeral });
}

async function sendPanel(channel) {
  const button = (customId, emoji, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(customId).setStyle(style).setEmoji(emoji);
  const container = new ContainerBuilder().setAccentColor(0xf9c8d9);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(['## 🎙️ Voice Channel Panel', '-# Use the buttons below to manage your temporary voice channel.'].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '>>> 🔒 · **Lock** the voice channel', '🔓 · **Unlock** the voice channel', '👻 · **Ghost** (hide) the voice channel', '👁️ · **Reveal** the voice channel', '👑 · **Claim** an unowned channel',
      '✅ · **Permit** a member to join', '🚫 · **Reject** a member from the channel', '✏️ · **Rename** the voice channel', '🔄 · **Transfer** channel ownership', '🗑️ · **Delete** your channel',
      '🔨 · **Disconnect** a member', '💻 · **Start** an activity', 'ℹ️ · **View** channel info', '➕ · **Increase** the user limit', '➖ · **Decrease** the user limit',
    ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(button('vm:lock', '🔒'), button('vm:unlock', '🔓'), button('vm:ghost', '👻'), button('vm:reveal', '👁️'), button('vm:claim', '👑')));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(button('vm:permit', '✅'), button('vm:reject', '🚫'), button('vm:rename', '✏️'), button('vm:transfer', '🔄'), button('vm:delete', '🗑️', ButtonStyle.Danger)));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(button('vm:disconnect', '🔨'), button('vm:activity', '💻'), button('vm:info', 'ℹ️'), button('vm:limit_up', '➕'), button('vm:limit_down', '➖')));
  return channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

async function deletePanel(guild, channelId, messageId) { const channel = await guild.channels.fetch(channelId).catch(() => null); const message = await channel?.messages.fetch(messageId).catch(() => null); await message?.delete().catch(() => {}); }

module.exports.sendPanel = sendPanel;
module.exports.executeAction = executeAction;

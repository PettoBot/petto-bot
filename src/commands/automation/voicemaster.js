const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, EmbedBuilder, InviteTargetType } = require('discord.js');
const voiceDb = require('../../db/voiceMaster');
const { textCard } = require('../../utils/caseCard');
const { t, currentLanguage, languageOf } = require('../../i18n');
const { answer } = require('../../utils/interactionAck');

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
    return interaction.reply({ content: t(await languageOf(interaction), 'voicemaster.unknownAction'), flags: MessageFlags.Ephemeral });
  },
};

/** "You need Manage Server to ..." in `lang`; `what` is `setup`, `disable` or `panel`. */
const needManage = (lang, what) => t(lang, `voicemaster.needManage.${what}`, { permission: t(lang, 'core.perm.ManageGuild') });

async function setup(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: needManage(lang, 'setup'), flags: MessageFlags.Ephemeral });
  const creator = interaction.options.getChannel('creator', true);
  const panel = interaction.options.getChannel('panel', true);
  const old = await voiceDb.getConfig(interaction.guild.id);
  if (old?.panel_channel_id && old?.panel_message_id) await deletePanel(interaction.guild, old.panel_channel_id, old.panel_message_id);
  const panelMessage = await sendPanel(panel, lang);
  const config = await voiceDb.upsertConfig(interaction.guild.id, { creator_channel_id: creator.id, panel_channel_id: panel.id, panel_message_id: panelMessage.id, category_id: interaction.options.getChannel('category')?.id ?? creator.parentId ?? null, default_limit: interaction.options.getInteger('limit') ?? 0, default_name: interaction.options.getString('name') || '{user.name}' });
  return interaction.reply({ components: [textCard(t(lang, 'voicemaster.configured', { creator: `<#${config.creator_channel_id}>`, panel: `<#${config.panel_channel_id}>` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function disable(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: needManage(lang, 'disable'), flags: MessageFlags.Ephemeral });
  const row = await voiceDb.getConfig(interaction.guild.id);
  if (row?.panel_channel_id && row?.panel_message_id) await deletePanel(interaction.guild, row.panel_channel_id, row.panel_message_id);
  await voiceDb.removeConfig(interaction.guild.id);
  return interaction.reply({ components: [textCard(t(lang, 'voicemaster.disabled'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function info(interaction) {
  const lang = await languageOf(interaction);
  const row = await voiceDb.getConfig(interaction.guild.id);
  if (!row) return interaction.reply({ components: [textCard(t(lang, 'voicemaster.notConfigured'), 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
  const count = await voiceDb.countTemps(interaction.guild.id);
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x4b4f59).setTitle('VoiceMaster').addFields({ name: t(lang, 'voicemaster.info.creator'), value: `<#${row.creator_channel_id}>`, inline: true }, { name: t(lang, 'voicemaster.info.panel'), value: `<#${row.panel_channel_id}>`, inline: true }, { name: t(lang, 'voicemaster.info.active'), value: String(count), inline: true }, { name: t(lang, 'voicemaster.info.template'), value: `\`${row.default_name}\`` })] });
}

async function resendPanel(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: needManage(lang, 'panel'), flags: MessageFlags.Ephemeral });
  const row = await voiceDb.getConfig(interaction.guild.id);
  if (!row?.panel_channel_id) return interaction.reply({ content: t(lang, 'voicemaster.configureFirst'), flags: MessageFlags.Ephemeral });

  const panelChannel = await interaction.guild.channels.fetch(row.panel_channel_id).catch(() => null);
  if (!panelChannel?.isTextBased?.()) {
    const error = new Error(t(lang, 'voicemaster.panelMissing'));
    error.userFacing = true;
    throw error;
  }

  // Post first. If Discord rejects the new message, the existing panel remains usable.
  const message = await sendPanel(panelChannel, lang);
  await voiceDb.upsertConfig(interaction.guild.id, { panel_message_id: message.id });
  if (row.panel_message_id && row.panel_message_id !== message.id) {
    await deletePanel(interaction.guild, row.panel_channel_id, row.panel_message_id);
  }
  // Keep this confirmation as a normal message so the prefix path does not depend on
  // Components V2 for a simple status response.
  return interaction.reply(t(lang, 'voicemaster.panelResent'));
}

function getVoiceChannelId(interaction) {
  return interaction.guild?.voiceStates?.cache.get(interaction.user.id)?.channelId
    ?? interaction.member?.voice?.channelId
    ?? null;
}

async function executeAction(interaction, action, overrides = {}) {
  const lang = await languageOf(interaction);
  const say = (key, vars) => answer(interaction, { content: t(lang, key, vars), flags: MessageFlags.Ephemeral });
  const liveChannelId = getVoiceChannelId(interaction);
  const channelId = overrides.channelId ?? liveChannelId;

  if (!liveChannelId || !channelId || liveChannelId !== channelId) return say('voicemaster.notInside');

  const temp = await voiceDb.getTemp(channelId);
  if (!temp) return say('voicemaster.notInside');
  if (['lock', 'unlock', 'ghost', 'reveal', 'rename', 'transfer', 'limit', 'permit', 'reject', 'disconnect', 'delete'].includes(action) && temp.owner_id !== interaction.user.id) return say('voicemaster.ownerOnly');

  const channel = interaction.guild.channels.cache.get(temp.channel_id)
    ?? await interaction.guild.channels.fetch(temp.channel_id).catch(() => null);
  if (!channel) return say('voicemaster.channelGone');

  if (action === 'claim') {
    const owner = await interaction.guild.members.fetch(temp.owner_id).catch(() => null);
    if (owner?.voice?.channelId === temp.channel_id) return say('voicemaster.ownerStillHere');
    await voiceDb.updateTemp(temp.channel_id, { owner_id: interaction.user.id });
    return say('voicemaster.claimed');
  }
  if (action === 'delete') { await channel.delete().catch(() => {}); await voiceDb.removeTemp(temp.channel_id); return say('voicemaster.deleted'); }
  if (action === 'rename') { const name = String(overrides.name ?? interaction.options.getString('name', true)).trim().slice(0, 100); await channel.setName(name); return say('voicemaster.renamed', { name }); }
  if (action === 'transfer') { const targetId = overrides.userId ?? interaction.options.getUser('user', true).id; await voiceDb.updateTemp(temp.channel_id, { owner_id: targetId }); return say('voicemaster.transferred', { user: `<@${targetId}>` }); }
  if (action === 'limit') { const limit = overrides.limit ?? interaction.options.getInteger('limit', true); await channel.setUserLimit(limit); await voiceDb.updateTemp(temp.channel_id, { user_limit: limit }); return say('voicemaster.limitSet', { limit: limit || t(lang, 'voicemaster.unlimited') }); }
  if (action === 'permit' || action === 'reject') { const targetId = overrides.userId ?? interaction.options.getUser('user', true).id; return permissionAction(interaction, temp, channel, action, targetId, lang); }
  if (action === 'disconnect') {
    const targetId = overrides.userId ?? interaction.options.getUser('user', true).id;
    if (targetId === temp.owner_id) return say('voicemaster.disconnectSelf');
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!member?.voice?.channelId || member.voice.channelId !== channel.id) return say('voicemaster.notInYours');
    await member.voice.disconnect().catch(() => {});
    return say('voicemaster.disconnected', { user: `<@${targetId}>` });
  }
  if (action === 'activity') {
    const invite = await channel.createInvite({ maxAge: 86400, targetType: InviteTargetType.EmbeddedApplication, targetApplication: '880218394199220334' }).catch(() => null);
    return invite ? say('voicemaster.activity', { url: invite.url }) : say('voicemaster.activityFailed');
  }
  if (action === 'lock' || action === 'unlock') { await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: action === 'lock' ? false : null }); await voiceDb.updateTemp(temp.channel_id, { is_locked: action === 'lock' }); return say(action === 'lock' ? 'voicemaster.locked' : 'voicemaster.unlocked'); }
  if (action === 'ghost' || action === 'reveal') { await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: action === 'ghost' ? false : null }); await voiceDb.updateTemp(temp.channel_id, { is_ghosted: action === 'ghost' }); return say(action === 'ghost' ? 'voicemaster.hidden' : 'voicemaster.visible'); }
}

async function permissionAction(interaction, temp, channel, action, userId, lang) {
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) return answer(interaction, { content: t(lang, 'voicemaster.memberGone'), flags: MessageFlags.Ephemeral });

  const trusted = new Set(temp.trusted_user_ids ?? []);
  const banned = new Set(temp.banned_user_ids ?? []);

  if (action === 'permit') {
    trusted.add(userId);
    banned.delete(userId);
    await channel.permissionOverwrites.edit(member, { Connect: true, ViewChannel: true });
  } else {
    trusted.delete(userId);
    banned.add(userId);
    await channel.permissionOverwrites.edit(member, { Connect: false });
    if (member.voice?.channelId === channel.id) await member.voice.disconnect().catch(() => {});
  }

  await voiceDb.updateTemp(channel.id, { trusted_user_ids: [...trusted], banned_user_ids: [...banned] });
  return answer(interaction, { content: t(lang, action === 'permit' ? 'voicemaster.permitted' : 'voicemaster.rejected', { user: `<@${userId}>` }), flags: MessageFlags.Ephemeral });
}

// The lines of the panel: the emoji of each button and what it does.
const PANEL_LINES = [
  ['lock', 'lock'], ['unlocked', 'unlock'], ['noVisibility', 'ghost'], ['visibility', 'reveal'], ['claim', 'claim'],
  ['permit', 'permit'], ['deny', 'reject'], ['edit', 'rename'], ['reload', 'transfer'], ['delete', 'delete'],
  ['leave', 'disconnect'], ['start', 'activity'], ['info', 'info'], ['increase', 'increase'], ['decrease', 'decrease'],
];

/** The panel message (Components V2, custom emojis, the vc:* buttons) in `lang`: posted by setup and `!voicemaster panel`, redrawn when the language changes. */
function buildPanelPayload(lang = currentLanguage()) {
  const emoji = {
    leave: { id: '1533576199354454197', name: 'pe_leave' },
    decrease: { id: '1533576366174503085', name: 'pe_Decrease' },
    increase: { id: '1533576368502341683', name: 'pe_Increase' },
    lock: { id: '1533573937059987517', name: 'pe_Lock' },
    noVisibility: { id: '1533574205986177126', name: 'pe_Novisibility' },
    start: { id: '1533575715562192987', name: 'pe_Start' },
    visibility: { id: '1533574204287484145', name: 'pe_Visibility' },
    claim: { id: '1533574819084369931', name: 'pe_claim' },
    delete: { id: '1533575163273023599', name: 'pe_delete' },
    deny: { id: '1533574864198172772', name: 'pe_deny' },
    edit: { id: '1533574936168501479', name: 'pe_edit' },
    permit: { id: '1533574862436569228', name: 'pe_permit' },
    info: { id: '1533575563225337866', name: 'pe_info' },
    unlocked: { id: '1533573689461706914', name: 'pe_unlocked' },
    reload: { id: '1533575051947802764', name: 'pe_reload' },
  };
  const tag = (key) => `<:${emoji[key].name}:${emoji[key].id}>`;

  // Keep this payload in sync with Bli's fixed panel: Components V2, custom
  // emojis, no accent color, and the vc:* namespace used by its handler.
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [{
      type: 17,
      components: [
        { type: 10, content: [
          t(lang, 'voicemaster.panel.title'),
          t(lang, 'voicemaster.panel.subtitle'),
        ].join('\n') },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `>>> ${PANEL_LINES.map(([icon, line]) => t(lang, `voicemaster.panel.${line}`, { emoji: tag(icon) })).join('\n')}` },
        { type: 14, divider: false, spacing: 1 },
        { type: 1, components: [
          { type: 2, custom_id: 'vc:lock', style: 2, emoji: emoji.lock },
          { type: 2, custom_id: 'vc:unlock', style: 2, emoji: emoji.unlocked },
          { type: 2, custom_id: 'vc:ghost', style: 2, emoji: emoji.noVisibility },
          { type: 2, custom_id: 'vc:reveal', style: 2, emoji: emoji.visibility },
          { type: 2, custom_id: 'vc:claim', style: 2, emoji: emoji.claim },
        ] },
        { type: 1, components: [
          { type: 2, custom_id: 'vc:permit', style: 2, emoji: emoji.permit },
          { type: 2, custom_id: 'vc:reject', style: 2, emoji: emoji.deny },
          { type: 2, custom_id: 'vc:rename', style: 2, emoji: emoji.edit },
          { type: 2, custom_id: 'vc:transfer', style: 2, emoji: emoji.reload },
          { type: 2, custom_id: 'vc:delete', style: 4, emoji: emoji.delete },
        ] },
        { type: 1, components: [
          { type: 2, custom_id: 'vc:disconnect', style: 2, emoji: emoji.leave },
          { type: 2, custom_id: 'vc:activity', style: 2, emoji: emoji.start },
          { type: 2, custom_id: 'vc:info', style: 2, emoji: emoji.info },
          { type: 2, custom_id: 'vc:limit_up', style: 2, emoji: emoji.increase },
          { type: 2, custom_id: 'vc:limit_down', style: 2, emoji: emoji.decrease },
        ] },
      ],
    }],
  };
}

async function sendPanel(channel, lang = currentLanguage()) {
  return channel.send(buildPanelPayload(lang));
}

async function deletePanel(guild, channelId, messageId) { const channel = await guild.channels.fetch(channelId).catch(() => null); const message = await channel?.messages.fetch(messageId).catch(() => null); await message?.delete().catch(() => {}); }

module.exports.sendPanel = sendPanel;
module.exports.buildPanelPayload = buildPanelPayload;
module.exports.executeAction = executeAction;

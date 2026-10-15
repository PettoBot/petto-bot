const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { collectMessages, deleteMessages } = require('../../utils/clearMessages');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const config = require('../../config');
const { t, tn, languageOf } = require('../../i18n');

// The kinds of channel `create` can make. Forum and media channels need the server to be a Community server.
const CREATE_TYPES = [
  { value: 'text', label: 'Text', type: ChannelType.GuildText },
  { value: 'announcement', label: 'Announcement', type: ChannelType.GuildAnnouncement },
  { value: 'voice', label: 'Voice', type: ChannelType.GuildVoice },
  { value: 'stage', label: 'Stage', type: ChannelType.GuildStageVoice },
  { value: 'forum', label: 'Forum', type: ChannelType.GuildForum },
  { value: 'media', label: 'Media', type: ChannelType.GuildMedia },
  { value: 'category', label: 'Category', type: ChannelType.GuildCategory },
];
const NEEDS_TOPIC_SUPPORT = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia]);

/** Who may create channels with the command for now: the owner and the developers of Petto. */
function canCreateChannels(userId) {
  return userId === config.ownerId || config.developerIds.includes(userId);
}

module.exports = {
  aliases: ['ch'],
  prefixPermissionOverrides: {
    clear: PermissionFlagsBits.ManageMessages,
    'move-all': PermissionFlagsBits.MoveMembers,
    moveall: PermissionFlagsBits.MoveMembers,
    move_all: PermissionFlagsBits.MoveMembers,
  },
  prefixSubcommandAliases: {
    lockdown: 'lock',
    lock_all: 'lock-all',
    lockall: 'lock-all',
    unlock_all: 'unlock-all',
    unlockall: 'unlock-all',
    moveall: 'move-all',
    move_all: 'move-all',
  },
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Channel management: create, lock, unlock, slowmode, bulk-delete.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('lock')
        .setDescription('Block a role from sending messages in a channel.')
        .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to lock (defaults to this one)').setRequired(false))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to block (defaults to @everyone)').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unlock')
        .setDescription("Restore a role's ability to send messages in a channel.")
        .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to unlock (defaults to this one)').setRequired(false))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to restore (defaults to @everyone)').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('slowmode')
        .setDescription('Set slowmode on a channel.')
        .addIntegerOption((opt) => opt.setName('seconds').setDescription('Seconds between messages (0 to disable, max 21600)').setRequired(true).setMinValue(0).setMaxValue(21_600))
        .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to update (defaults to this one)').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Bulk delete recent messages from this channel.')
        .addIntegerOption((opt) => opt.setName('amount').setDescription('How many messages to delete (1-1000)').setRequired(true).setMinValue(1).setMaxValue(1000))
        .addUserOption((opt) => opt.setName('user').setDescription('Only delete messages from this user').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a channel, including a media channel (for now only for the team of Petto).')
        .addStringOption((opt) => opt.setName('name').setDescription('Name of the channel').setRequired(true).setMaxLength(100))
        .addStringOption((opt) => opt.setName('type').setDescription('Kind of channel (default: text)').setRequired(false).addChoices(...CREATE_TYPES.map((entry) => ({ name: entry.label, value: entry.value }))))
        .addChannelOption((opt) => opt.setName('category').setDescription('Category to put it in').setRequired(false).addChannelTypes(ChannelType.GuildCategory))
        .addStringOption((opt) => opt.setName('topic').setDescription('Topic or guidelines of the channel').setRequired(false).setMaxLength(1024))
        .addBooleanOption((opt) => opt.setName('nsfw').setDescription('Mark it as age-restricted').setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName('lock-all').setDescription('Lock every text channel the bot can manage.'))
    .addSubcommand((sub) => sub.setName('unlock-all').setDescription('Unlock every text channel the bot can manage.'))
    .addSubcommand((sub) => sub.setName('hide').setDescription('Hide a channel from @everyone (deny View Channel).').addChannelOption((opt) => opt.setName('channel').setDescription('Channel to hide (defaults to this one)').setRequired(false)))
    .addSubcommand((sub) => sub.setName('unhide').setDescription('Restore visibility for a hidden channel.').addChannelOption((opt) => opt.setName('channel').setDescription('Channel to unhide (defaults to this one)').setRequired(false)))
    .addSubcommand((sub) => sub.setName('move-all').setDescription('Move everyone from your voice channel to another.').addChannelOption((opt) => opt.setName('destination').setDescription('Destination voice channel').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return create(interaction);
    if (sub === 'lock') return lock(interaction);
    if (sub === 'unlock') return unlock(interaction);
    if (sub === 'slowmode') return slowmode(interaction);
    if (sub === 'clear') return clear(interaction);
    if (sub === 'lock-all') return lockAll(interaction, true);
    if (sub === 'unlock-all') return lockAll(interaction, false);
    if (sub === 'hide') return hide(interaction, true);
    if (sub === 'unhide') return hide(interaction, false);
    return moveAll(interaction);
  },
};

async function create(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const reply = (text, color) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });
  if (!canCreateChannels(interaction.user.id)) return reply(t(lang, 'moderation.channel.create.teamOnly', { emoji: EMOJI.DENY }), 0xfe6465);
  if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return reply(t(lang, 'moderation.channel.create.needsManageChannels', { emoji: EMOJI.DENY }), 0xfe6465);

  const kind = CREATE_TYPES.find((entry) => entry.value === (interaction.options.getString('type') ?? 'text')) ?? CREATE_TYPES[0];
  const rawName = interaction.options.getString('name', true).trim();
  // Text-like channels are written in lowercase with dashes, as Discord does it; voice channels and categories keep their name.
  const name = (kind.value === 'voice' || kind.value === 'stage' || kind.value === 'category' ? rawName : rawName.toLowerCase().replace(/\s+/g, '-')).slice(0, 100);
  if (!name) return reply(t(lang, 'moderation.channel.create.noName', { emoji: EMOJI.DENY }), 0xfe6465);
  const category = kind.type === ChannelType.GuildCategory ? null : interaction.options.getChannel('category');
  const topic = interaction.options.getString('topic');
  const nsfw = interaction.options.getBoolean('nsfw');

  try {
    const channel = await interaction.guild.channels.create({
      name,
      type: kind.type,
      ...(category ? { parent: category.id } : {}),
      ...(topic && NEEDS_TOPIC_SUPPORT.has(kind.type) ? { topic } : {}),
      ...(nsfw !== null && kind.type !== ChannelType.GuildCategory ? { nsfw } : {}),
      reason: t(lang, 'moderation.channel.create.audit', { user: interaction.user.tag }),
    });
    return reply(t(lang, `moderation.channel.create.done.${kind.value}`, { emoji: EMOJI.APPROVE, channel: `<#${channel.id}>` }), 0xa5ea7a);
  } catch (err) {
    logger.warn(`channel create failed in ${interaction.guild.id}: ${err.message}`);
    const forumLike = kind.type === ChannelType.GuildForum || kind.type === ChannelType.GuildMedia;
    // Discord refuses a media channel in a server that does not have monetization (Server Subscriptions) on, besides Community.
    const text = kind.type === ChannelType.GuildMedia && (/monetiz/i.test(err.message) || err.code === 50035)
      ? t(lang, 'moderation.channel.create.mediaNeeds')
      : forumLike && /community/i.test(err.message)
        ? t(lang, 'moderation.channel.create.forumNeeds')
        : err.code === 50013 ? t(lang, 'moderation.channel.create.noPermission')
      : err.code === 30013 ? t(lang, 'moderation.channel.create.limit')
      : t(lang, 'moderation.channel.create.discordError', { error: err.message });
    return reply(`${EMOJI.DENY}  ${text}`, 0xfe6465);
  }
}

async function lock(interaction) {
  const lang = await languageOf(interaction);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const role = interaction.options.getRole('role') ?? interaction.guild.roles.everyone;

  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(channel.type)) {
    await interaction.reply({ content: t(lang, 'moderation.channel.lock.wrongType'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: t(lang, 'moderation.channel.needsManageChannels'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await channel.permissionOverwrites.edit(role, { SendMessages: false, SendMessagesInThreads: false }, { reason: t(lang, 'moderation.channel.audit.locked', { user: interaction.user.tag }) });
  } catch (err) {
    logger.error('Failed to lock channel:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.channel.permissionsFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await interaction.editReply({ components: [textCard(t(lang, 'moderation.channel.lock.done', { emoji: EMOJI.APPROVE, channel: `${channel}`, role: `${role}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function unlock(interaction) {
  const lang = await languageOf(interaction);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const role = interaction.options.getRole('role') ?? interaction.guild.roles.everyone;

  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(channel.type)) {
    await interaction.reply({ content: t(lang, 'moderation.channel.unlock.wrongType'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: t(lang, 'moderation.channel.needsManageChannels'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await channel.permissionOverwrites.edit(role, { SendMessages: null, SendMessagesInThreads: null }, { reason: t(lang, 'moderation.channel.audit.unlocked', { user: interaction.user.tag }) });
  } catch (err) {
    logger.error('Failed to unlock channel:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.channel.permissionsFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await interaction.editReply({ components: [textCard(t(lang, 'moderation.channel.unlock.done', { emoji: EMOJI.APPROVE, channel: `${channel}`, role: `${role}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function slowmode(interaction) {
  const lang = await languageOf(interaction);
  const seconds = interaction.options.getInteger('seconds', true);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;

  if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: t(lang, 'moderation.channel.needsManageChannels'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await channel.setRateLimitPerUser(seconds, t(lang, 'moderation.channel.audit.slowmode', { user: interaction.user.tag }));
  } catch (err) {
    logger.error('Failed to set slowmode:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.channel.slowmode.failed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = seconds === 0
    ? t(lang, 'moderation.channel.slowmode.disabled', { emoji: EMOJI.APPROVE, channel: `${channel}` })
    : t(lang, 'moderation.channel.slowmode.set', { emoji: EMOJI.APPROVE, channel: `${channel}`, seconds });
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function clear(interaction) {
  const lang = await languageOf(interaction);
  const amount = interaction.options.getInteger('amount', true);
  const user = interaction.options.getUser('user');

  if (!interaction.channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: t(lang, 'moderation.channel.clear.needsManageMessages'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const messages = await collectMessages(interaction.channel, { amount, userId: user?.id ?? null });
    const deletedCount = await deleteMessages(interaction.channel, messages);
    const text = user
      ? tn(lang, 'moderation.channel.clear.doneFrom', deletedCount, { emoji: EMOJI.APPROVE, count: deletedCount, user: `${user}` })
      : tn(lang, 'moderation.channel.clear.done', deletedCount, { emoji: EMOJI.APPROVE, count: deletedCount });
    await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to bulk delete:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.channel.clear.failed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

const LOCKABLE_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];

async function lockAll(interaction, locking) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const everyone = interaction.guild.roles.everyone;
  const channels = interaction.guild.channels.cache.filter(
    (c) => LOCKABLE_TYPES.includes(c.type) && c.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels),
  );

  let count = 0;
  for (const channel of channels.values()) {
    try {
      await channel.permissionOverwrites.edit(
        everyone,
        { SendMessages: locking ? false : null, SendMessagesInThreads: locking ? false : null },
        { reason: t(lang, locking ? 'moderation.channel.audit.lockedAll' : 'moderation.channel.audit.unlockedAll', { user: interaction.user.tag }) },
      );
      count += 1;
    } catch (err) {
      logger.warn(`channel ${locking ? 'lock-all' : 'unlock-all'}: failed on ${channel.id}:`, err.message);
    }
  }

  const done = tn(lang, locking ? 'moderation.channel.lockAll.done' : 'moderation.channel.unlockAll.done', count, { emoji: EMOJI.APPROVE, count });
  await interaction.editReply({ components: [textCard(done, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function hide(interaction, hiding) {
  const lang = await languageOf(interaction);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;

  if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: t(lang, 'moderation.channel.needsManageChannels'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await channel.permissionOverwrites.edit(
      interaction.guild.roles.everyone,
      { ViewChannel: hiding ? false : null },
      { reason: t(lang, hiding ? 'moderation.channel.audit.hidden' : 'moderation.channel.audit.unhidden', { user: interaction.user.tag }) },
    );
  } catch (err) {
    logger.error(`Failed to ${hiding ? 'hide' : 'unhide'} channel:`, err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.channel.permissionsFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = t(lang, hiding ? 'moderation.channel.hide.done' : 'moderation.channel.unhide.done', { emoji: EMOJI.APPROVE, channel: `${channel}` });
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function moveAll(interaction) {
  const lang = await languageOf(interaction);
  const destination = interaction.options.getChannel('destination', true);
  const source = interaction.member.voice.channel;

  if (!source) {
    await interaction.reply({ content: t(lang, 'moderation.channel.moveAll.notInVoice'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!destination.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.MoveMembers)) {
    await interaction.reply({ content: t(lang, 'moderation.channel.moveAll.needsMoveMembers'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  let count = 0;
  for (const member of source.members.values()) {
    try {
      await member.voice.setChannel(destination, t(lang, 'moderation.channel.audit.moved', { user: interaction.user.tag }));
      count += 1;
    } catch (err) {
      logger.warn(`channel moveall: failed to move ${member.id}:`, err.message);
    }
  }

  await interaction.editReply({ components: [textCard(tn(lang, 'moderation.channel.moveAll.done', count, { emoji: EMOJI.APPROVE, count, channel: `${destination}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const db = require('../../db/messageLinks');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const GREEN = 0xa5ea7a;
const GREY = 0x4b4f59;
const CHANNEL_TYPES = [
  ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia,
  ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread,
];
const channelOption = (description) => (option) => option.setName('channel').setDescription(description).addChannelTypes(...CHANNEL_TYPES).setRequired(true);
const reply = (interaction, text, color, extra = {}) => interaction.reply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] }, ...extra });

module.exports = {
  aliases: ['msglinks', 'linkembed', 'mlinks'],
  registerSlash: true,
  prefixDefaultSubcommand: 'status',
  data: new SlashCommandBuilder()
    .setName('messagelinks')
    .setDescription('Show a message in an embed when someone posts its link (off by default).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('on').setDescription('Turn message link embeds on.'))
    .addSubcommand((s) => s.setName('off').setDescription('Turn message link embeds off.'))
    .addSubcommand((s) => s.setName('status').setDescription('See if it is on and which channels are ignored.'))
    .addSubcommand((s) => s.setName('ignore').setDescription('Do not open links posted in a channel, or pointing to it.').addChannelOption(channelOption('The channel to ignore')))
    .addSubcommand((s) => s.setName('unignore').setDescription('Open links in a channel again.').addChannelOption(channelOption('The channel to stop ignoring'))),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const settings = await db.readAll(guildId);
      const channels = settings.ignored_channels.map((id) => `<#${id}>`).join(', ');
      const text = [
        t(lang, settings.enabled ? 'messagelinks.status.titleOn' : 'messagelinks.status.titleOff'),
        t(lang, 'messagelinks.status.what'),
        t(lang, 'messagelinks.status.privacy'),
        channels ? t(lang, 'messagelinks.status.ignored', { channels }) : t(lang, 'messagelinks.status.ignoredNone'),
        t(lang, 'messagelinks.status.limits'),
        t(lang, 'messagelinks.status.howTo', { prefix: interaction.typedPrefix ?? '/' }),
      ].join('\n');
      return reply(interaction, text, settings.enabled ? GREEN : GREY);
    }

    if (sub === 'on' || sub === 'off') {
      await db.setEnabled(guildId, sub === 'on');
      if (sub === 'off') return reply(interaction, t(lang, 'messagelinks.off', { emoji: EMOJI.APPROVE }), GREY);
      let text = t(lang, 'messagelinks.on', { emoji: EMOJI.APPROVE });
      // Without Embed Links in the channel where it was turned on, nothing is shown there: said now, not found out later.
      const channel = interaction.channel;
      const me = interaction.guild.members?.me;
      if (channel && me && !channel.permissionsFor?.(me)?.has(PermissionFlagsBits.EmbedLinks)) text += `\n${t(lang, 'messagelinks.needEmbedLinks', { emoji: EMOJI.WARNING, channel: `<#${channel.id}>` })}`;
      return reply(interaction, text, GREEN);
    }

    const channel = interaction.options.getChannel('channel', true);
    const mention = `<#${channel.id}>`;
    if (sub === 'ignore') {
      const result = await db.ignoreChannel(guildId, channel.id);
      if (result.ok) return reply(interaction, t(lang, 'messagelinks.ignore.added', { emoji: EMOJI.APPROVE, channel: mention }), GREEN);
      return reply(interaction, t(lang, result.reason === 'full' ? 'messagelinks.ignore.full' : 'messagelinks.ignore.already', { emoji: EMOJI.WARNING, channel: mention, max: db.MAX_IGNORED }), GREY);
    }
    const result = await db.unignoreChannel(guildId, channel.id);
    if (result.ok) return reply(interaction, t(lang, 'messagelinks.unignore.removed', { emoji: EMOJI.APPROVE, channel: mention }), GREEN);
    return reply(interaction, t(lang, 'messagelinks.unignore.missing', { emoji: EMOJI.WARNING, channel: mention }), GREY);
  },
};

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../db/mediaOnly');
const { plainCard } = require('../../utils/plainCard');
const { EMOJI } = require('../../utils/emojis');
const { describe, botCanModerate } = require('../../utils/mediaOnlyText');
const { t, languageOf } = require('../../i18n');

const V2 = MessageFlags.IsComponentsV2;
const say = (interaction, text, ephemeral = false) => interaction.reply({ ...plainCard(text), flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildStageVoice];

module.exports = {
  aliases: ['gallery', 'imageonly'],
  data: new SlashCommandBuilder()
    .setName('imgonly')
    .setDescription('Channels where only pictures and videos can be posted.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('add').setDescription('Make a channel pictures-and-videos only.')
      .addChannelOption((o) => o.setName('channel').setDescription('The channel').addChannelTypes(...TEXT_CHANNELS).setRequired(true))
      .addBooleanOption((o) => o.setName('videos').setDescription('Allow videos too (default: yes)'))
      .addBooleanOption((o) => o.setName('audio').setDescription('Allow audio files (default: no)'))
      .addBooleanOption((o) => o.setName('files').setDescription('Allow any other file (default: no)'))
      .addBooleanOption((o) => o.setName('caption').setDescription('Allow text with the picture (default: yes)')))
    .addSubcommand((s) => s.setName('remove').setDescription('Let a channel receive anything again.').addChannelOption((o) => o.setName('channel').setDescription('The channel').addChannelTypes(...TEXT_CHANNELS).setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('The media channels of this server.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    const manager = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    if (sub !== 'list' && !manager) return say(interaction, `${EMOJI.DENY}  ${t(lang, 'mediaonly.needManage')}`, true);

    if (sub === 'list') {
      const rules = await db.getRules(interaction.guild.id);
      const lines = [...rules.entries()].filter(([, rule]) => rule.attachments_enabled || rule.links_enabled).map(([id, rule]) => `<#${id}>: ${describe(lang, rule)}`);
      return say(interaction, lines.length ? `${t(lang, 'mediaonly.list.title')}\n${lines.join('\n')}` : t(lang, 'mediaonly.list.empty'));
    }

    const channel = interaction.options.getChannel('channel', true);
    const rules = await db.getRules(interaction.guild.id);
    const current = rules.get(channel.id);
    if (sub === 'remove') {
      if (!current?.attachments_enabled) return say(interaction, `${EMOJI.DENY}  ${t(lang, 'mediaonly.img.notSet', { channel: `<#${channel.id}>` })}`, true);
      if (current.links_enabled) await db.upsertRule(interaction.guild.id, channel.id, { attachments_enabled: false });
      else await db.removeRule(interaction.guild.id, channel.id);
      return say(interaction, `${EMOJI.APPROVE}  ${t(lang, 'mediaonly.img.removed', { channel: `<#${channel.id}>` })}`);
    }

    if (!botCanModerate(interaction, channel)) return say(interaction, `${EMOJI.DENY}  ${t(lang, 'mediaonly.botNeeds', { channel: `<#${channel.id}>` })}`, true);
    const patch = {
      attachments_enabled: true,
      allow_images: true,
      allow_videos: interaction.options.getBoolean('videos') ?? current?.allow_videos ?? true,
      allow_audio: interaction.options.getBoolean('audio') ?? current?.allow_audio ?? false,
      allow_files: interaction.options.getBoolean('files') ?? current?.allow_files ?? false,
      allow_caption: interaction.options.getBoolean('caption') ?? current?.allow_caption ?? true,
    };
    await db.upsertRule(interaction.guild.id, channel.id, patch);
    return say(interaction, `${EMOJI.APPROVE}  ${t(lang, 'mediaonly.img.added', { channel: `<#${channel.id}>`, rule: describe(lang, { ...db.DEFAULTS, ...current, ...patch, links_enabled: false }) })}`);
  },
};

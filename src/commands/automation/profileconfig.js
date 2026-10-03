// The settings of reviews for admins: turn them off, or choose a channel where every new review is shown.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const reviewsDb = require('../../db/reviews');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);

module.exports = {
  prefixOnly: true,
  aliases: ['pfconfig'],
  data: new SlashCommandBuilder()
    .setName('profileconfig')
    .setDescription('Set up reviews and profiles.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('view').setDescription('See the current settings.'))
    .addSubcommand((s) => s.setName('reviews').setDescription('Turn reviews on or off.').addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('channel').setDescription('A channel where every new review is shown. Empty: none.').addChannelOption((o) => o.setName('channel').setDescription('The channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const done = (component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
    const sub = interaction.options.getSubcommand();
    if (sub === 'view') {
      const config = await reviewsDb.getConfig(interaction.guild.id);
      return done(textCard(['### Reviews and profiles', `Reviews: **${config.reviews_enabled ? 'on' : 'off'}**`, `Channel for new reviews: ${config.review_channel_id ? `<#${config.review_channel_id}>` : 'none'}`].join('\n')));
    }
    if (sub === 'reviews') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await reviewsDb.upsertConfig(interaction.guild.id, { reviews_enabled: enabled });
      return done(ok(enabled ? 'Reviews are on.' : 'Reviews are off. The profile does not show the rating.'));
    }
    const channel = interaction.options.getChannel('channel');
    await reviewsDb.upsertConfig(interaction.guild.id, { review_channel_id: channel?.id ?? null });
    return done(ok(channel ? `New reviews are shown in ${channel}.` : 'New reviews are not shown anywhere.'));
  },
};

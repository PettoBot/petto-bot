// The settings of reviews for admins: turn them off, or choose a channel where every new review is shown.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const reviewsDb = require('../../db/reviews');
const { parseSpan, formatSpan } = require('../../utils/partnerEngine');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const note = (text) => textCard(text);
const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);

/** The rules of reviews, as lines of text. */
function rulesText(config, lang) {
  const off = t(lang, 'profiles.config.none');
  return t(lang, 'profiles.rules.view', {
    account: config.min_account_days ?? 0,
    member: config.min_member_days ?? 0,
    cooldown: config.cooldown_minutes > 0 ? formatSpan(config.cooldown_minutes, lang) : off,
    min: config.min_comment ?? 0,
    max: config.max_comment ?? 300,
  });
}

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
    .addSubcommand((s) => s.setName('rules').setDescription('Who can review and how. Leave a value out to keep it; 0 is off.')
      .addIntegerOption((o) => o.setName('account_days').setDescription('Minimum age of the reviewer account in days (0 for none)').setMinValue(0).setMaxValue(3650).setRequired(false))
      .addIntegerOption((o) => o.setName('member_days').setDescription('Minimum days in the server (0 for none)').setMinValue(0).setMaxValue(3650).setRequired(false))
      .addStringOption((o) => o.setName('cooldown').setDescription('Time between two reviews of the same member, like 1h 30m, or "none"').setRequired(false))
      .addIntegerOption((o) => o.setName('min_comment').setDescription('Minimum characters of a comment (0 for none)').setMinValue(0).setMaxValue(300).setRequired(false))
      .addIntegerOption((o) => o.setName('max_comment').setDescription('Maximum characters of a comment (20 to 300)').setMinValue(20).setMaxValue(300).setRequired(false)))
    .addSubcommand((s) => s.setName('channel').setDescription('A channel where every new review is shown. Empty: none.').addChannelOption((o) => o.setName('channel').setDescription('The channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const lang = await languageOf(interaction);
    await ensureGuild(interaction.guild.id);
    const done = (component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
    const sub = interaction.options.getSubcommand();
    if (sub === 'view') {
      const config = await reviewsDb.getConfig(interaction.guild.id);
      return done(textCard([
        t(lang, 'profiles.config.title'),
        t(lang, 'profiles.config.reviews', { state: t(lang, config.reviews_enabled ? 'profiles.config.on' : 'profiles.config.off') }),
        t(lang, 'profiles.config.channel', { channel: config.review_channel_id ? `<#${config.review_channel_id}>` : t(lang, 'profiles.config.none') }),
        rulesText(config, lang),
      ].join('\n')));
    }
    if (sub === 'rules') {
      const config = await reviewsDb.getConfig(interaction.guild.id);
      const changes = {};
      const read = (name, key) => { const value = interaction.options.getInteger(name); if (value !== null && value !== undefined) changes[key] = value; };
      read('account_days', 'min_account_days'); read('member_days', 'min_member_days'); read('min_comment', 'min_comment'); read('max_comment', 'max_comment');
      const cooldown = interaction.options.getString('cooldown');
      if (cooldown !== null && cooldown !== undefined) {
        const minutes = parseSpan(cooldown);
        if (minutes === null) return done(note(t(lang, 'profiles.rules.cooldown')));
        changes.cooldown_minutes = minutes;
      }
      if (!Object.keys(changes).length) return done(note(rulesText(config, lang)));
      const next = { ...config, ...changes };
      if (next.min_comment > next.max_comment) return done(note(t(lang, 'profiles.rules.commentRange')));
      const saved = await reviewsDb.upsertConfig(interaction.guild.id, changes);
      return done(ok(`${t(lang, 'profiles.rules.saved')}\n${rulesText(saved, lang)}`));
    }
    if (sub === 'reviews') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await reviewsDb.upsertConfig(interaction.guild.id, { reviews_enabled: enabled });
      return done(ok(t(lang, enabled ? 'profiles.config.reviewsOn' : 'profiles.config.reviewsOff')));
    }
    const channel = interaction.options.getChannel('channel');
    await reviewsDb.upsertConfig(interaction.guild.id, { review_channel_id: channel?.id ?? null });
    return done(ok(channel ? t(lang, 'profiles.config.channelSet', { channel: `${channel}` }) : t(lang, 'profiles.config.channelNone')));
  },
};

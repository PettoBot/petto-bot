// Reviews: rate a member from 1 to 5 stars and see the ratings of a member. A member can review another once, and sending
// it again changes it. The settings are in `!profileconfig`.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const reviewsDb = require('../../db/reviews');
const { summarize, starsText, parseStars, problem, MAX_COMMENT } = require('../../utils/reviewEngine');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, formatNumber, languageOf } = require('../../i18n');

const reply = (interaction, component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
const unix = (value) => Math.floor(new Date(value).getTime() / 1000);

async function give(interaction, config, lang) {
  const target = interaction.options.getUser('user', true);
  const stars = parseStars(interaction.options.getString('stars', true));
  const comment = (interaction.options.getString('comment') ?? '').trim().replace(/\s+/g, ' ');
  const refused = problem({ reviewer: interaction.user, target, stars, comment, lang });
  if (refused) return reply(interaction, textCard(refused));
  const existing = await reviewsDb.getReview(interaction.guild.id, target.id, interaction.user.id);
  await reviewsDb.saveReview({ guildId: interaction.guild.id, targetId: target.id, reviewerId: interaction.user.id, stars, comment });
  const summary = summarize(await reviewsDb.listFor(interaction.guild.id, target.id));

  if (config.review_channel_id) {
    const channel = await interaction.guild.channels.fetch(config.review_channel_id).catch(() => null);
    const post = t(lang, existing ? 'reviews.post.changed' : 'reviews.post.new', { stars: starsText(stars), reviewer: `<@${interaction.user.id}>`, target: `<@${target.id}>` });
    await channel?.send?.({ components: [textCard(`${post}${comment ? `\n> ${comment}` : ''}`)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => null);
  }
  const vars = { emoji: EMOJI.APPROVE, count: summary.count, user: target.username, stars: starsText(summary.average), average: formatNumber(lang, summary.average) };
  return reply(interaction, textCard(tn(lang, existing ? 'reviews.give.changed' : 'reviews.give.saved', summary.count, vars), 0xa5ea7a));
}

async function remove(interaction, lang) {
  const target = interaction.options.getUser('user', true);
  const removed = await reviewsDb.removeReview(interaction.guild.id, target.id, interaction.user.id);
  return reply(interaction, textCard(removed ? t(lang, 'reviews.remove.done', { emoji: EMOJI.APPROVE, user: target.username }) : t(lang, 'reviews.remove.none', { user: target.username })));
}

async function show(interaction, lang) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const reviews = await reviewsDb.listFor(interaction.guild.id, target.id);
  const summary = summarize(reviews);
  if (!summary.count) return reply(interaction, textCard(t(lang, 'reviews.show.none', { user: target.username })));
  const lines = reviews.slice(0, 5).map((review) => `${starsText(review.stars)} <@${review.reviewer_id}> <t:${unix(review.updated_at)}:R>${review.comment ? `\n> ${review.comment}` : ''}`);
  return reply(interaction, textCard([t(lang, 'reviews.show.title', { user: target.username }), tn(lang, 'reviews.show.summary', summary.count, { count: summary.count, stars: starsText(summary.average), average: formatNumber(lang, summary.average) }), ...lines].join('\n')));
}

module.exports = {
  prefixOnly: true,
  aliases: ['reviews'],
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('Rate a member from 1 to 5 stars.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('give').setDescription('Review a member. Sending it again changes it.')
      .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
      .addStringOption((o) => o.setName('stars').setDescription('1 to 5').setRequired(true))
      .addStringOption((o) => o.setName('comment').setDescription('What you want to say').setMaxLength(MAX_COMMENT).setRequired(false)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove your review of a member.').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
    .addSubcommand((s) => s.setName('show').setDescription('The reviews of a member.').addUserOption((o) => o.setName('user').setDescription('Who (you by default)').setRequired(false))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const lang = await languageOf(interaction);
    const config = await reviewsDb.getConfig(interaction.guild.id);
    if (!config.reviews_enabled) return reply(interaction, textCard(t(lang, 'reviews.off')));
    const sub = interaction.options.getSubcommand();
    if (sub === 'give') return give(interaction, config, lang);
    return sub === 'remove' ? remove(interaction, lang) : show(interaction, lang);
  },
};

// Reviews: rate a member from 1 to 5 stars and see the ratings of a member. A member can review another once, and sending
// it again changes it. The settings are in `!profileconfig`.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const reviewsDb = require('../../db/reviews');
const { summarize, starsText, parseStars, problem, MAX_COMMENT } = require('../../utils/reviewEngine');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const reply = (interaction, component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
const unix = (value) => Math.floor(new Date(value).getTime() / 1000);

async function give(interaction, config) {
  const target = interaction.options.getUser('user', true);
  const stars = parseStars(interaction.options.getString('stars', true));
  const comment = (interaction.options.getString('comment') ?? '').trim().replace(/\s+/g, ' ');
  const refused = problem({ reviewer: interaction.user, target, stars, comment });
  if (refused) return reply(interaction, textCard(refused));
  const existing = await reviewsDb.getReview(interaction.guild.id, target.id, interaction.user.id);
  await reviewsDb.saveReview({ guildId: interaction.guild.id, targetId: target.id, reviewerId: interaction.user.id, stars, comment });
  const summary = summarize(await reviewsDb.listFor(interaction.guild.id, target.id));

  if (config.review_channel_id) {
    const channel = await interaction.guild.channels.fetch(config.review_channel_id).catch(() => null);
    await channel?.send?.({ components: [textCard(`${starsText(stars)}  <@${interaction.user.id}> ${existing ? 'changed their review of' : 'reviewed'} <@${target.id}>${comment ? `\n> ${comment}` : ''}`, 0xf0b232)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => null);
  }
  return reply(interaction, textCard(`${EMOJI.APPROVE}  ${existing ? 'Your review was changed.' : 'Review saved.'} ${target.username} has ${starsText(summary.average)} ${summary.average} from ${summary.count} review${summary.count === 1 ? '' : 's'}.`, 0xa5ea7a));
}

async function remove(interaction) {
  const target = interaction.options.getUser('user', true);
  const removed = await reviewsDb.removeReview(interaction.guild.id, target.id, interaction.user.id);
  return reply(interaction, textCard(removed ? `${EMOJI.APPROVE}  Your review of ${target.username} is removed.` : `You have no review of ${target.username}.`));
}

async function show(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const reviews = await reviewsDb.listFor(interaction.guild.id, target.id);
  const summary = summarize(reviews);
  if (!summary.count) return reply(interaction, textCard(`${target.username} has no reviews yet.`));
  const lines = reviews.slice(0, 5).map((review) => `${starsText(review.stars)} <@${review.reviewer_id}> <t:${unix(review.updated_at)}:R>${review.comment ? `\n> ${review.comment}` : ''}`);
  return reply(interaction, textCard([`### Reviews of ${target.username}`, `${starsText(summary.average)} **${summary.average}** from ${summary.count} review${summary.count === 1 ? '' : 's'}`, ...lines].join('\n')));
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
    const config = await reviewsDb.getConfig(interaction.guild.id);
    if (!config.reviews_enabled) return reply(interaction, textCard('Reviews are turned off in this server.'));
    const sub = interaction.options.getSubcommand();
    if (sub === 'give') return give(interaction, config);
    return sub === 'remove' ? remove(interaction) : show(interaction);
  },
};

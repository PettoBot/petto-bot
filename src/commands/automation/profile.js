// The profile of a member: when they joined, their rating, and the numbers of the modules the server uses (uploads,
// requests and partnerships).
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const reviewsDb = require('../../db/reviews');
const uploadsDb = require('../../db/uploads');
const requestsDb = require('../../db/requests');
const partnersDb = require('../../db/partners');
const { summarize, starsText } = require('../../utils/reviewEngine');
const { counts } = require('../../utils/partnerEngine');
const { textCard } = require('../../utils/caseCard');

const unix = (value) => Math.floor(new Date(value).getTime() / 1000);

/** The lines of a profile; `data` is what each module gave, or null when the module is off. */
function profileLines(user, member, { rating, uploads, requests, partners }) {
  const lines = [`### Profile of ${user.username}`];
  if (member?.joinedTimestamp) lines.push(`Joined <t:${Math.floor(member.joinedTimestamp / 1000)}:D>`);
  if (rating) lines.push(rating.count ? `Rating: ${starsText(rating.average)} **${rating.average}** from ${rating.count} review${rating.count === 1 ? '' : 's'}` : 'Rating: no reviews yet');
  if (uploads) lines.push(`Uploads: **${uploads.total}** (${uploads.files} files)${uploads.last ? ` · last <t:${unix(uploads.last)}:R>` : ''}`);
  if (requests) lines.push(`Requests: **${requests.made}** made, **${requests.done}** done${requests.staffDone ? ` · **${requests.staffDone}** finished for others` : ''}`);
  if (partners) lines.push(`Partnerships: **${partners.total}** (${partners.week} this week)`);
  return lines;
}

module.exports = {
  prefixOnly: true,
  aliases: ['perfil'],
  profileLines,
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('The profile of a member: rating, uploads, requests and partnerships.')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Who (you by default)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const guildId = interaction.guild.id;
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const [reviewConfig, uploadConfig, requestConfig, partnerConfig] = await Promise.all([reviewsDb.getConfig(guildId), uploadsDb.getConfig(guildId), requestsDb.getConfig(guildId), partnersDb.getConfig(guildId)]);

    const data = { rating: null, uploads: null, requests: null, partners: null };
    if (reviewConfig.reviews_enabled) data.rating = summarize(await reviewsDb.listFor(guildId, user.id));
    if (uploadConfig?.enabled) {
      const rows = await uploadsDb.listLog(guildId, { userId: user.id });
      data.uploads = { total: rows.length, files: rows.reduce((sum, row) => sum + (row.files ?? 1), 0), last: rows[0]?.created_at ?? null };
    }
    if (requestConfig?.enabled) {
      const [made, staffDone] = await Promise.all([requestsDb.list(guildId, { statuses: ['open', 'claimed', 'done', 'cancelled'], userId: user.id, limit: 500 }), requestsDb.list(guildId, { statuses: ['done'], claimedBy: user.id, limit: 500 })]);
      data.requests = { made: made.length, done: made.filter((row) => row.status === 'done').length, staffDone: staffDone.length };
    }
    if (partnerConfig?.enabled) {
      const rows = await partnersDb.listLog(guildId, { managerId: user.id });
      data.partners = counts(rows);
    }
    return interaction.editReply({ components: [textCard(profileLines(user, member, data).join('\n'))], flags: MessageFlags.IsComponentsV2 });
  },
};

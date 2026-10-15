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
const { t, tn, formatNumber, currentLanguage, languageOf } = require('../../i18n');

const unix = (value) => Math.floor(new Date(value).getTime() / 1000);

/** The lines of a profile; `data` is what each module gave, or null when the module is off. */
function profileLines(user, member, { rating, uploads, requests, partners }, lang = currentLanguage()) {
  const lines = [t(lang, 'profiles.title', { user: user.username })];
  if (member?.joinedTimestamp) lines.push(t(lang, 'profiles.joined', { date: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` }));
  if (rating) lines.push(rating.count ? tn(lang, 'profiles.rating', rating.count, { count: rating.count, stars: starsText(rating.average), average: formatNumber(lang, rating.average) }) : t(lang, 'profiles.noRating'));
  if (uploads) {
    const vars = { total: uploads.total, count: uploads.files };
    lines.push(uploads.last ? tn(lang, 'profiles.uploadsLast', uploads.files, { ...vars, time: `<t:${unix(uploads.last)}:R>` }) : tn(lang, 'profiles.uploads', uploads.files, vars));
  }
  if (requests) {
    const vars = { made: requests.made, done: requests.done };
    lines.push(requests.staffDone ? t(lang, 'profiles.requestsStaff', { ...vars, staff: requests.staffDone }) : t(lang, 'profiles.requests', vars));
  }
  if (partners) lines.push(t(lang, 'profiles.partners', { total: partners.total, week: partners.week }));
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
    const lang = await languageOf(interaction);
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
    return interaction.editReply({ components: [textCard(profileLines(user, member, data, lang).join('\n'))], flags: MessageFlags.IsComponentsV2 });
  },
};

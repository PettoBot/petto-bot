// The profile of a member, one card: when they joined and, for the modules the server uses, their partnerships (total, this week, today,
// rank, last one), uploads (the same), the rating of their reviews (average, count, last one) and their requests. Counts, places and times only.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const reviewsDb = require('../../db/reviews');
const uploadsDb = require('../../db/uploads');
const requestsDb = require('../../db/requests');
const partnersDb = require('../../db/partners');
const { summarize, starsText } = require('../../utils/reviewEngine');
const { counts, rank, periodStart } = require('../../utils/partnerEngine');
const { textCard } = require('../../utils/caseCard');
const { t, tn, formatNumber, currentLanguage, languageOf } = require('../../i18n');
const { addSubcommands, runWrapped, loadByName } = require('../../utils/umbrella');

const unix = (value) => Math.floor(new Date(value).getTime() / 1000);
const MAX_CARD = 3900; // Components V2 take 4000 characters of text in a message

/** The small pieces after a number: `3 this week · 1 today · rank #2 · last <time>`. */
function pieces(lang, { week, day, rank, last }) {
  const parts = [];
  if (week !== undefined) parts.push(t(lang, 'profiles.part.week', { count: week }));
  if (day !== undefined) parts.push(t(lang, 'profiles.part.today', { count: day }));
  if (rank) parts.push(t(lang, 'profiles.part.rank', { rank }));
  if (last) parts.push(t(lang, 'profiles.part.last', { time: `<t:${unix(last)}:R>` }));
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/** The lines of a profile; `data` is what each module gave, or null when the module is off. Nothing private: only counts, places and times. */
function profileLines(user, member, { rating, uploads, requests, partners }, lang = currentLanguage()) {
  const lines = [t(lang, 'profiles.title', { user: user.username })];
  if (member?.joinedTimestamp) lines.push(t(lang, 'profiles.joined', { date: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` }));
  if (rating) lines.push(rating.count ? tn(lang, 'profiles.rating', rating.count, { count: rating.count, stars: starsText(rating.average), average: formatNumber(lang, rating.average) }) + pieces(lang, { last: rating.last }) : t(lang, 'profiles.noRating'));
  if (partners) lines.push(partners.total ? t(lang, 'profiles.partners', { total: partners.total }) + pieces(lang, { week: partners.week, day: partners.day, rank: partners.rank, last: partners.last }) : t(lang, 'profiles.partnersNone'));
  if (uploads) lines.push(uploads.total ? tn(lang, 'profiles.uploads', uploads.files, { total: uploads.total, count: uploads.files }) + pieces(lang, { week: uploads.week, rank: uploads.rank, last: uploads.last }) : t(lang, 'profiles.uploadsNone'));
  if (requests) {
    const vars = { made: requests.made, done: requests.done };
    lines.push(requests.staffDone ? t(lang, 'profiles.requestsStaff', { ...vars, staff: requests.staffDone }) : t(lang, 'profiles.requests', vars));
  }
  return lines;
}

/** One card, cut to what a message can hold. */
const profileText = (user, member, data, lang) => profileLines(user, member, data, lang).join('\n').slice(0, MAX_CARD);

/** Where `userId` stands among all the members of a log (1 is the most), or null when they have none. */
function placeOf(rows, userId) {
  const index = rank(rows).findIndex((entry) => entry.managerId === String(userId));
  return index === -1 ? null : index + 1;
}

// What the command holds besides its own subcommands: the group `config` is the old `!profileconfig`.
const SUBCOMMANDS = [{ group: 'config', wraps: 'profileconfig', description: 'Set up reviews and profiles.' }];

module.exports = {
  subcommands: SUBCOMMANDS,
  // Also a slash command: `/profile show` and, in the group `config`, the subcommands of `!profileconfig` (`/profile config channel`).
  registerSlash: true,
  aliases: ['perfil'],
  profileLines,
  profileText,
  // `!profile @Ana` is `!profile show @Ana`; `!profile config channel #log` is `!profileconfig channel #log`, with its own permission and rules.
  prefixDefaultSubcommand: 'show',
  prefixWords: { config: { command: 'profileconfig', args: [] } },
  rulesViaWords: true,
  groupRuleKeys: { config: 'profileconfig' },
  legacyRuleNames: ['community'], // i18n-ignore: a rule key, never shown
  data: addSubcommands(new SlashCommandBuilder()
    .setName('profile')
    .setDescription('The profile of a member and its settings: rating, uploads, requests and partnerships.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('show').setDescription('The profile of a member: rating, uploads, requests and partnerships.').addUserOption((o) => o.setName('user').setDescription('Who (you by default)').setRequired(false))),
    SUBCOMMANDS, loadByName),

  async execute(interaction, client) {
    // The group `config` is the old `!profileconfig`: it asks for what that command asks for.
    if (interaction.options.getSubcommandGroup?.(false) === 'config') return runWrapped(interaction, client, 'profileconfig');
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const lang = await languageOf(interaction);
    const guildId = interaction.guild.id;
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const [reviewConfig, uploadConfig, requestConfig, partnerConfig] = await Promise.all([reviewsDb.getConfig(guildId), uploadsDb.getConfig(guildId), requestsDb.getConfig(guildId), partnersDb.getConfig(guildId)]);

    const data = { rating: null, uploads: null, requests: null, partners: null };
    if (reviewConfig.reviews_enabled) {
      const reviews = await reviewsDb.listFor(guildId, user.id);
      data.rating = { ...summarize(reviews), last: reviews[0]?.updated_at ?? null };
    }
    if (uploadConfig?.enabled) {
      const [rows, all] = await Promise.all([uploadsDb.listLog(guildId, { userId: user.id }), uploadsDb.listLog(guildId)]);
      const weekStart = periodStart('week').getTime();
      data.uploads = { total: rows.length, files: rows.reduce((sum, row) => sum + (row.files ?? 1), 0), week: rows.filter((row) => new Date(row.created_at).getTime() >= weekStart).length, rank: rows.length ? placeOf(all.map((row) => ({ ...row, manager_id: row.user_id })), user.id) : null, last: rows[0]?.created_at ?? null };
    }
    if (requestConfig?.enabled) {
      const [made, staffDone] = await Promise.all([requestsDb.list(guildId, { statuses: ['open', 'claimed', 'done', 'cancelled'], userId: user.id, limit: 500 }), requestsDb.list(guildId, { statuses: ['done'], claimedBy: user.id, limit: 500 })]);
      data.requests = { made: made.length, done: made.filter((row) => row.status === 'done').length, staffDone: staffDone.length };
    }
    if (partnerConfig?.enabled) {
      const [rows, all] = await Promise.all([partnersDb.listLog(guildId, { managerId: user.id }), partnersDb.listLog(guildId)]);
      data.partners = { ...counts(rows), rank: rows.length ? placeOf(all, user.id) : null, last: rows[0]?.created_at ?? null };
    }
    return interaction.editReply({ components: [textCard(profileText(user, member, data, lang))], flags: MessageFlags.IsComponentsV2 });
  },
};

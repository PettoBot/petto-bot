// The profile of a member. `/profile` (and `!profile`) is a PICTURE: their avatar and banner, level, rank, messages and voice of the server and
// the badges they put in the showcase (utils/profileView.ts). `/profile server` is the card of the server: when they joined and, for the
// modules the server uses, their partnerships (total, this week, today, rank, last one), uploads (the same), the rating of their reviews
// (average, count, last one) and their requests. Counts, places and times only. `/profile badge` and `/profile showcase` are the badges.
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const profileDb = require('../../db/userProfile');
const badgesRules = require('../../utils/profileBadges');
const { buildProfileImage, profileState } = require('../../utils/profileView');
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

/** `/profile show`: the picture. A failure to draw is said in a line, never a blank reply. */
async function showImage(interaction) {
  await interaction.deferReply();
  const lang = await languageOf(interaction);
  const asked = interaction.options.getUser('user') ?? interaction.user;
  const user = await asked.fetch(true).catch(() => asked); // the banner only comes with a full fetch
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  let buffer;
  try {
    buffer = await buildProfileImage({ guildId: interaction.guild.id, user, member, lang });
  } catch (error) {
    console.error('profile image failed', error); // i18n-ignore: log line
    return interaction.editReply({ content: t(lang, 'profiles.image.failed') });
  }
  return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'profile.png' })] });
}

/** `/profile badge`: an identity badge is the person's own to turn on and off. A new one goes to the showcase when there is a free place. */
async function setBadge(interaction) {
  const lang = await languageOf(interaction);
  const id = interaction.options.getString('badge', true);
  const enabled = interaction.options.getBoolean('enabled', true);
  const userId = interaction.user.id;
  if (!badgesRules.isSelfBadge(id)) return interaction.reply({ content: t(lang, 'profiles.badge.notYours'), flags: MessageFlags.Ephemeral });
  const name = t(lang, `profiles.badge.${id}`);
  if (!enabled) {
    const had = await profileDb.removeBadge(userId, id);
    return interaction.reply({ content: t(lang, had ? 'profiles.badge.off' : 'profiles.badge.alreadyOff', { badge: name }), flags: MessageFlags.Ephemeral });
  }
  const isNew = await profileDb.addBadge(userId, id, 'self');
  if (isNew) {
    const state = await profileState(userId);
    if (state.showcase.length < state.slots && !state.showcase.includes(id)) await profileDb.setShowcase(userId, [...state.showcase, id]);
  }
  return interaction.reply({ content: t(lang, isNew ? 'profiles.badge.on' : 'profiles.badge.alreadyOn', { badge: name }), flags: MessageFlags.Ephemeral });
}

/** `/profile showcase`: the badges of the picture, in the order given, cut to what the person has and what their plan holds. */
async function setShowcase(interaction) {
  const lang = await languageOf(interaction);
  const userId = interaction.user.id;
  const chosen = [];
  for (let i = 1; i <= badgesRules.MAX_SLOTS; i += 1) {
    const value = interaction.options.getString(`badge${i}`);
    if (value) chosen.push(value);
  }
  const state = await profileState(userId);
  const kept = badgesRules.normalizeShowcase(chosen, state.owned, state.slots);
  const dropped = chosen.filter((id, index) => !kept.includes(id) && chosen.indexOf(id) === index).map((id) => t(lang, `profiles.badge.${id}`));
  await profileDb.setShowcase(userId, kept);
  const lines = [t(lang, kept.length ? 'profiles.showcase.saved' : 'profiles.showcase.empty', { badges: kept.map((id) => t(lang, `profiles.badge.${id}`)).join(', '), slots: state.slots })];
  if (dropped.length) lines.push(t(lang, 'profiles.showcase.dropped', { badges: dropped.join(', '), slots: state.slots }));
  return interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
}

module.exports = {
  subcommands: SUBCOMMANDS,
  // Also a slash command: `/profile show` (the picture), `/profile server` (the card), and, in the group `config`, the subcommands of `!profileconfig` (`/profile config channel`).
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
    .addSubcommand((s) => s.setName('show').setDescription('The profile of a member as a picture: level, rank, messages, voice and badges.').addUserOption((o) => o.setName('user').setDescription('Who (you by default)').setRequired(false)))
    .addSubcommand((s) => s.setName('server').setDescription('The card of a member in this server: rating, uploads, requests and partnerships.').addUserOption((o) => o.setName('user').setDescription('Who (you by default)').setRequired(false)))
    .addSubcommand((s) => s.setName('badge').setDescription('Turn one of your identity badges on or off.')
      .addStringOption((o) => o.setName('badge').setDescription('Which badge').setRequired(true).addChoices(...badgesRules.BADGES.filter((b) => b.unlock === 'self').map((b) => ({ name: b.id, value: b.id }))))
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => {
      s.setName('showcase').setDescription('Choose the badges of the showcase of your profile picture, in order.');
      const choices = badgesRules.BADGES.map((b) => ({ name: b.id, value: b.id }));
      for (let i = 1; i <= badgesRules.MAX_SLOTS; i += 1) {
        // i18n-ignore: the real text comes from the catalog (cmd.automation.profile.showcase.opt.badgeN.desc)
        s.addStringOption((o) => o.setName(`badge${i}`).setDescription(`Badge ${i}`).setRequired(i === 1).addChoices(...choices));
      }
      return s;
    }),
    SUBCOMMANDS, loadByName),

  async execute(interaction, client) {
    // The group `config` is the old `!profileconfig`: it asks for what that command asks for.
    if (interaction.options.getSubcommandGroup?.(false) === 'config') return runWrapped(interaction, client, 'profileconfig');
    const sub = interaction.options.getSubcommand(false) ?? 'show';
    if (sub === 'badge') return setBadge(interaction);
    if (sub === 'showcase') return setShowcase(interaction);
    if (sub === 'show') return showImage(interaction);
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

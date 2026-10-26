// `!stats`: the analysis of a server. The week by hour, the top channels and members with their share, how the server grows and how long members
// stay, a period against the one before it with the change in percent, and what one member did. Only counts are read (never what was written), and
// nobody is counted who asked not to be (`!stats privacy`) or in a server that turned the counters off (`!statsconfig`).
const { SlashCommandBuilder, AttachmentBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const statsRules = require('../../db/statsRules');
const { readServerStats, readMemberStats } = require('../../db/statsQueries');
const { buildStatsV2, buildMemberStats, quietChannels } = require('../../utils/statsV2');
const { describeStats, quietLine } = require('../../utils/statsLines');
const { describeSummary } = require('../../utils/summaryText');
const cards = require('../../imgutils/statsCards');
const { buildPrivacyPanel } = require('../../utils/statsPanels');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

const V2 = MessageFlags.IsComponentsV2;
const MAX_DAYS = 180; // compare needs the same number of days before, and the counters are kept for two years
const DEFAULT_DAYS = 7;
const MEMBER_TOKEN = /^<@!?\d+>$|^\d{15,25}$/;

/** `30`, `30d` or nothing: the number of days, between 1 and 180. */
function parseDays(raw, fallback = DEFAULT_DAYS) {
  const match = /^(\d{1,3})\s*d?$/i.exec(String(raw ?? '').trim());
  return match ? Math.min(MAX_DAYS, Math.max(1, Number.parseInt(match[1], 10))) : fallback;
}

const daysOption = (option) => option.setName('days').setDescription('How many days to include, from 1 to 180 (default 7)').setRequired(false);
const MEMBER_SUBCOMMANDS = ['members', 'member'];

module.exports = {
  cooldownMs: 6000, // each answer reads and adds up many rows
  aliases: ['analytics', 'analysis'],
  // `!stats` is the server overview; `!stats 30` its days; `!stats @liam` what one member did.
  prefixDefaultSubcommand: (tokens) => {
    if (!tokens.length) return 'server';
    if (MEMBER_TOKEN.test(tokens[0])) return 'member';
    return /^\d{1,3}d?$/i.test(tokens[0]) ? 'server' : null;
  },
  prefixSubcommandAliases: { overview: 'server', summary: 'server', trend: 'server', chart: 'server', charts: 'server', channel: 'channels', top: 'members', users: 'members', heat: 'heatmap', hours: 'heatmap', week: 'heatmap', retention: 'growth', joins: 'growth', versus: 'compare', vs: 'compare', user: 'member', me: 'member', data: 'privacy', optout: 'privacy', opt: 'privacy' },
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Analysis of this server: trends, busiest hours, top channels and members, growth.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('server').setDescription('The server at a glance, against the period before it.').addStringOption(daysOption))
    .addSubcommand((s) => s.setName('channels').setDescription('The channels with the most messages and voice time, and the ones that were quiet.').addStringOption(daysOption))
    .addSubcommand((s) => s.setName('members').setDescription('The members with the most messages and voice time.').addStringOption(daysOption))
    .addSubcommand((s) => s.setName('heatmap').setDescription('The busiest hours of the week.').addStringOption(daysOption))
    .addSubcommand((s) => s.setName('growth').setDescription('Members who joined and left, and how long the ones who left had stayed.').addStringOption(daysOption))
    .addSubcommand((s) => s.setName('compare').setDescription('This period next to the one before it, with the change in percent.').addStringOption(daysOption))
    .addSubcommand((s) => s.setName('member').setDescription('What a member did: messages, voice time, streak and place in the server.')
      .addUserOption((o) => o.setName('member').setDescription('The member (default: you)').setRequired(false))
      .addStringOption(daysOption))
    .addSubcommand((s) => s.setName('privacy').setDescription('Choose not to be counted in the statistics, or delete what was counted about you.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    const guild = interaction.guild;
    const send = (payload) => interaction.editReply({ ...payload, flags: V2 });
    const notice = (text) => send({ components: [textCard(text, null)] });

    if (sub === 'privacy') {
      await interaction.deferReply({ flags: V2 | MessageFlags.Ephemeral });
      return send(buildPrivacyPanel({ userId: interaction.user.id, optedOut: statsRules.isOptedOut(interaction.user.id), lang }));
    }

    await interaction.deferReply({ flags: V2 | MessageFlags.SuppressNotifications });
    const rules = statsRules.rulesOf(guild.id);
    if (!rules.enabled) return notice(t(lang, 'info.stats.disabled'));
    if (MEMBER_SUBCOMMANDS.includes(sub) && !rules.members) return notice(t(lang, 'info.stats.membersOff'));

    const days = parseDays(interaction.options.getString('days'));
    try {
      if (sub === 'member') return await memberReply({ interaction, guild, lang, days, send, notice });
      return await serverReply({ sub, interaction, guild, lang, days, rules, send, notice });
    } catch (error) {
      logger.warn({ guildId: guild.id, command: 'stats' }, `Statistics could not be built: ${error.message}`);
      return notice(t(lang, 'info.summary.unavailable'));
    }
  },
  parseDays,
};

/** The reply of the server subcommands: the picture, then a few lines. */
async function serverReply({ sub, guild, lang, days, rules, send }) {
  const data = await readServerStats(guild.id, days, { perMember: rules.members });
  const stats = buildStatsV2({ days, ...data, memberTotal: guild.memberCount });
  const channelName = (id) => (guild.channels.cache.get(id) ? `#${guild.channels.cache.get(id).name}` : t(lang, 'info.summary.text.goneChannel'));
  let image;
  let lines;
  if (sub === 'heatmap') {
    image = cards.buildHeatmapCard({ guildName: guild.name, days, stats, lang });
    lines = describeStats('heatmap', stats, lang);
  } else if (sub === 'growth') {
    image = cards.buildGrowthCard({ guildName: guild.name, days, stats, lang });
    lines = describeStats('growth', stats, lang);
  } else if (sub === 'compare') {
    image = cards.buildCompareCard({ guildName: guild.name, days, stats, lang });
    lines = describeStats('compare', stats, lang);
  } else if (sub === 'channels') {
    const textIds = [...guild.channels.cache.values()].filter((channel) => channel.isTextBased?.() && !channel.isVoiceBased?.() && !channel.isThread?.()).map((channel) => channel.id);
    const quiet = quietChannels(textIds, data.channelRows, days);
    image = cards.buildTopCard({
      guildName: guild.name, days, kind: 'channels', lang,
      messages: stats.topChannels.messages.map((row) => ({ label: channelName(row.id), value: row.messages, share: row.share })),
      voice: stats.topChannels.voice.map((row) => ({ label: channelName(row.id), value: row.voiceSeconds, share: row.share })),
    });
    lines = [quietLine(quiet, lang)];
  } else if (sub === 'members') {
    const names = await memberNames(guild, [...stats.topMembers.messages, ...stats.topMembers.voice].map((row) => row.id), lang);
    const concentration = describeStats('members', stats, lang)[0] ?? null;
    image = cards.buildTopCard({
      guildName: guild.name, days, kind: 'members', lang, note: concentration ? concentration.replace(/^<:[^>]+>\s*/, '').replace(/\*\*/g, '') : null,
      messages: stats.topMembers.messages.map((row) => ({ label: names.get(row.id), value: row.messages, share: row.share })),
      voice: stats.topMembers.voice.map((row) => ({ label: names.get(row.id), value: row.voiceSeconds, share: row.share })),
    });
    lines = [];
  } else {
    image = cards.buildTrendCard({ guildName: guild.name, days, stats, lang });
    lines = describeStats('overview', stats, lang);
  }

  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(tn(lang, 'info.stats.header', days, { title: t(lang, `info.statsCard.title.${sub === 'server' ? 'overview' : sub}`), server: guild.name, count: days })));
  container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://stats.png')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([...lines, t(lang, 'info.stats.line.private')].join('\n')));
  return send({ components: [container], files: [new AttachmentBuilder(image, { name: 'stats.png' })] });
}

/** The names of members for a ranking: from the server, else from Discord's profile, else a plain "left" label. */
async function memberNames(guild, ids, lang) {
  const unique = [...new Set(ids)];
  const names = new Map();
  const missing = unique.filter((id) => !guild.members.cache.has(id));
  if (missing.length) await guild.members.fetch({ user: missing.slice(0, 30) }).catch(() => null);
  for (const id of unique) {
    const member = guild.members.cache.get(id);
    if (member) { names.set(id, member.displayName); continue; }
    const user = await guild.client.users.fetch(id).catch(() => null);
    names.set(id, user ? (user.globalName ?? user.username) : t(lang, 'info.stats.member.left'));
  }
  return names;
}

async function memberReply({ interaction, guild, lang, days, send, notice }) {
  const user = interaction.options.getUser('member') ?? interaction.user;
  if (user.bot) return notice(t(lang, 'info.stats.member.bot'));
  const member = guild.members.cache.get(user.id) ?? await guild.members.fetch(user.id).catch(() => null);
  const name = member?.displayName ?? user.globalName ?? user.username;
  if (statsRules.isOptedOut(user.id)) return notice(t(lang, 'info.stats.member.optedOut', { name }));
  const { userRows, memberTotals } = await readMemberStats(guild.id, user.id, days);
  const stats = buildMemberStats({ userId: user.id, days, userRows, memberTotals });
  if (!stats.totals.messages && !stats.totals.voiceSeconds) return notice(t(lang, 'info.stats.member.none', { name }));
  const image = await cards.buildMemberCard({ guildName: guild.name, name, avatarUrl: (member ?? user).displayAvatarURL({ extension: 'png', size: 128 }), member: stats, lang });
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(tn(lang, 'info.stats.header', days, { title: t(lang, 'info.statsCard.title.member'), server: guild.name, count: days })));
  container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://stats.png')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'info.stats.line.private')));
  return send({ components: [container], files: [new AttachmentBuilder(image, { name: 'stats.png' })] });
}

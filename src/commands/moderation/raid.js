// !raid: after a raid, ban or kick everyone who joined in the last minutes (with a confirmation), or just list them.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { createCase } = require('../../db/modActions');
const { textCard } = require('../../utils/caseCard');
const { canModerate } = require('../../utils/permissions');
const { EMOJI } = require('../../utils/emojis');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { confirmBulkAction, bulkTargetBlocked, protectedLine } = require('../../utils/moderationCommand');
const { handleStaffAction } = require('../../logging/moreLog');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TARGETS = 500;
const LIST_LIMIT = 40;

/** The members (not bots) who joined in the last `windowMs`, newest first. */
function recentJoins(members, windowMs, now = Date.now()) {
  return [...members.values()]
    .filter((member) => !member.user.bot && member.joinedTimestamp && now - member.joinedTimestamp <= windowMs)
    .sort((a, b) => b.joinedTimestamp - a.joinedTimestamp);
}

module.exports = {
  aliases: ['recentban', 'chunkban', 'raidban'],
  prefixDefaultSubcommand: 'clean',
  data: new SlashCommandBuilder()
    .setName('raid')
    .setDescription('Ban or kick everyone who joined in the last minutes, after a raid.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('clean')
        .setDescription('Ban or kick the members who joined in this time (asks first).')
        .addStringOption((o) => o.setName('duration').setDescription('How far back, like 10m or 2h (max 7d)').setRequired(true))
        .addStringOption((o) => o.setName('action').setDescription('Ban (default) or kick').addChoices({ name: 'ban', value: 'ban' }, { name: 'kick', value: 'kick' }))
        .addStringOption((o) => o.setName('reason').setDescription('Reason for the cases')),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('See who joined in this time.').addStringOption((o) => o.setName('duration').setDescription('How far back, like 30m or 1d (default 1h)'))),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const raw = interaction.options.getString('duration') ?? '1h';
    const windowMs = parseDuration(raw);
    if (!windowMs || windowMs > MAX_WINDOW_MS) {
      await interaction.reply({ content: t(lang, 'moderation.raid.badDuration'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (sub === 'list') return list(interaction, windowMs, lang);
    return clean(interaction, windowMs, lang);
  },
  recentJoins,
};

async function list(interaction, windowMs, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const members = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
  const joined = recentJoins(members, windowMs);
  const span = formatDuration(windowMs, lang);
  if (!joined.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.raid.none', { span }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const lines = joined.slice(0, LIST_LIMIT).map((member) => `${member} \`${member.id}\` · <t:${Math.floor(member.joinedTimestamp / 1000)}:R> · ${t(lang, 'moderation.raid.created', { time: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` })}`);
  if (joined.length > LIST_LIMIT) lines.push(t(lang, 'moderation.role.more', { count: joined.length - LIST_LIMIT }));
  await interaction.editReply({ components: [textCard([tn(lang, 'moderation.raid.listTitle', joined.length, { count: joined.length, span }), ...lines].join('\n').slice(0, 3900), 0x4b4f59)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function clean(interaction, windowMs, lang) {
  const action = interaction.options.getString('action') ?? 'ban';
  const reason = interaction.options.getString('reason') ?? t(lang, 'moderation.raid.defaultReason');
  const permission = action === 'kick' ? PermissionFlagsBits.KickMembers : PermissionFlagsBits.BanMembers;
  // You and Petto both need the permission of the action (Kick Members for a kick).
  const check = canModerate(interaction, null, permission);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const members = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
  const span = formatDuration(windowMs, lang);
  const joined = recentJoins(members, windowMs);
  if (!joined.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.raid.none', { span }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (joined.length > MAX_TARGETS) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.raid.tooMany', { count: joined.length, max: MAX_TARGETS }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (!(await confirmBulkAction(interaction, action, tn(lang, 'moderation.raid.targets', joined.length, { count: joined.length, span })))) return;

  await ensureGuild(interaction.guild.id);
  const done = [];
  const blocked = [];
  let failed = 0;
  for (const member of joined) {
    if (bulkTargetBlocked(interaction, member, permission)) {
      blocked.push(member.user);
      continue;
    }
    try {
      if (action === 'kick') await member.kick(reason);
      else await interaction.guild.members.ban(member.id, { reason, deleteMessageSeconds: 86_400 });
      done.push(member.user);
    } catch (err) {
      failed += 1;
      logger.warn(`raid ${action}: failed on ${member.id} in ${interaction.guild.id}: ${err.message}`);
      continue;
    }
    // One case each, so the history of every account says what happened; the log gets one summary instead of hundreds.
    await createCase({ guildId: interaction.guild.id, userId: member.id, moderatorId: interaction.user.id, type: action, reason }).catch((err) => logger.error(`raid: ${action} done but no case for ${member.id}:`, err));
  }

  handleStaffAction('raidCleaned', interaction.client, interaction.guild, { moderator: interaction.user, detail: (l) => tn(l, action === 'kick' ? 'moderation.raid.logKicked' : 'moderation.raid.logBanned', done.length, { count: done.length, span: formatDuration(windowMs, l) }), note: reason }).catch(() => {});
  const lines = [tn(lang, action === 'kick' ? 'moderation.raid.kicked' : 'moderation.raid.banned', done.length, { emoji: EMOJI.APPROVE, count: done.length, span })];
  if (failed) lines.push(t(lang, 'moderation.raid.failed', { emoji: EMOJI.DENY, count: failed }));
  const protectedText = protectedLine(blocked, lang);
  if (protectedText) lines.push(protectedText.slice(0, 1500));
  lines.push(t(lang, 'moderation.common.reason', { reason }));
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

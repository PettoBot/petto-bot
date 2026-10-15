const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { listJailed } = require('../../db/jail');
const { canModerate } = require('../../utils/permissions');
const { textCard } = require('../../utils/caseCard');
const { logSanction } = require('../../utils/caseLog');
const { sanctionDM, sanctionReply } = require('../../utils/sanctionTemplates');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { JailError, jailMember, unjailMember, ensureJailSetup } = require('../../utils/jail');
const { infoPayload, noticePayload } = require('../../utils/infoCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

const MAX_JAIL_MS = 365 * 24 * 60 * 60 * 1000;
const V2 = MessageFlags.IsComponentsV2;

module.exports = {
  prefixDefaultSubcommand: 'user',
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('Jail members: they lose their roles and can only talk to staff in the jail channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('user')
      .setDescription('Jail a member until they are released, or for a set time.')
      .addUserOption((opt) => opt.setName('user').setDescription('The member to jail').setRequired(true))
      .addStringOption((opt) => opt.setName('duration').setDescription('e.g. 30m, 12h, 7d (leave empty for no end)').setRequired(false))
      .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the jail').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('Release a member and give their roles back.')
      .addUserOption((opt) => opt.setName('user').setDescription('The member to release').setRequired(true))
      .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the release').setRequired(false)))
    .addSubcommand((sub) => sub.setName('list').setDescription('Show who is in jail right now.'))
    .addSubcommand((sub) => sub.setName('setup').setDescription('Create the jail role and channel, or repair them.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'user') return jailUser(interaction);
    if (sub === 'remove') return releaseUser(interaction);
    if (sub === 'list') return list(interaction);
    return setup(interaction);
  },
};

function refuse(interaction, text) {
  return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
}

async function jailUser(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');
  const durationInput = interaction.options.getString('duration');
  const durationMs = durationInput ? parseDuration(durationInput) : null;

  if (durationInput && !durationMs) return refuse(interaction, t(lang, 'moderation.duration.invalidJail'));
  if (durationMs && durationMs > MAX_JAIL_MS) return refuse(interaction, t(lang, 'moderation.jail.tooLong'));

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return refuse(interaction, t(lang, 'moderation.common.notMember'));

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.ModerateMembers, { hierarchy: 'none' });
  if (!check.ok) return refuse(interaction, check.message);
  if (!targetMember.manageable) return refuse(interaction, t(lang, 'moderation.jail.notManageable'));

  await interaction.deferReply({ flags: V2 });
  await ensureGuild(interaction.guild.id);

  let result;
  try {
    result = await jailMember({ guild: interaction.guild, member: targetMember, moderator: interaction.user, reason, durationMs });
  } catch (err) {
    if (!(err instanceof JailError)) logger.error('Failed to jail member:', err);
    await interaction.editReply({ components: [textCard(err instanceof JailError ? err.message : t(lang, 'moderation.jail.jailFailed'), COLORS.RED)], flags: V2 });
    return;
  }

  const duration = durationMs ? formatDuration(durationMs, lang) : undefined;
  await sanctionReply(interaction, { modCase: result.modCase, type: 'jail', target: targetUser, moderator: interaction.user, reason, duration });
  await logSanction(interaction.client, interaction.guild, { modCase: result.modCase, target: targetUser, moderator: interaction.user, reason, duration });

  await targetMember
    .send(await sanctionDM({ type: 'jail', guild: interaction.guild, client: interaction.client, reason, duration, member: targetMember, moderator: interaction.user, caseNumber: result.modCase.case_number }))
    .catch(() => logger.warn(`Could not DM jail notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
}

async function releaseUser(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  const check = canModerate(interaction, targetMember, PermissionFlagsBits.ModerateMembers, { hierarchy: 'none' });
  if (!check.ok) return refuse(interaction, check.message);

  await interaction.deferReply({ flags: V2 });

  let result;
  try {
    result = await unjailMember({ guild: interaction.guild, userId: targetUser.id, moderator: interaction.user, reason });
  } catch (err) {
    if (!(err instanceof JailError)) logger.error('Failed to release member from jail:', err);
    await interaction.editReply({ components: [textCard(err instanceof JailError ? err.message : t(lang, 'moderation.jail.releaseFailed'), COLORS.RED)], flags: V2 });
    return;
  }

  if (!result.ok) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.jail.notJailed'), COLORS.DEFAULT)], flags: V2 });
    return;
  }

  await sanctionReply(interaction, { modCase: result.modCase, type: 'unjail', target: targetUser, moderator: interaction.user, reason });
  await logSanction(interaction.client, interaction.guild, { modCase: result.modCase, target: targetUser, moderator: interaction.user, reason });

  await result.member
    ?.send(await sanctionDM({ type: 'unjail', guild: interaction.guild, client: interaction.client, reason, member: result.member, moderator: interaction.user, caseNumber: result.modCase.case_number }))
    .catch(() => logger.warn(`Could not DM unjail notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
}

async function list(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: V2 });
  const rows = await listJailed(interaction.guild.id);
  if (!rows.length) {
    await interaction.editReply({ ...noticePayload(t(lang, 'moderation.jail.listEmpty'), COLORS.DEFAULT), flags: V2 });
    return;
  }

  const shown = rows.slice(0, 15);
  const lines = shown.map((row) => {
    const jailedAt = Math.floor(new Date(row.jailed_at).getTime() / 1000);
    const ends = row.expires_at ? t(lang, 'moderation.jail.listEnds', { time: `<t:${Math.floor(new Date(row.expires_at).getTime() / 1000)}:R>` }) : t(lang, 'moderation.jail.listNoEnd');
    return `<@${row.user_id}> · ${t(lang, 'moderation.caseList.by', { moderator: `<@${row.jailed_by}>` })} · <t:${jailedAt}:R>${ends}${row.reason ? `\n> ${row.reason.slice(0, 100)}` : ''}`;
  });
  if (rows.length > shown.length) lines.push(t(lang, 'moderation.jail.listMore', { count: rows.length - shown.length }));

  await interaction.editReply(infoPayload({
    accent: 0xfed53c,
    title: t(lang, 'moderation.jail.listTitle', { emoji: EMOJI.RELEASE_LOCKED }),
    thumbnail: interaction.guild.iconURL({ size: 256 }),
    subtitle: [tn(lang, 'moderation.jail.listCount', rows.length, { count: rows.length })],
    sections: [{ lines, limit: 3000 }],
    footer: t(lang, 'moderation.jail.listFooter'),
  }));
}

async function setup(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return refuse(interaction, t(lang, 'moderation.jail.setup.needsManageServer'));
  const me = interaction.guild.members.me;
  if (!me.permissions.has([PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels])) return refuse(interaction, t(lang, 'moderation.jail.setup.botNeeds'));

  await interaction.deferReply({ flags: V2 });
  await ensureGuild(interaction.guild.id);

  try {
    const result = await ensureJailSetup(interaction.guild);
    await interaction.editReply(infoPayload({
      accent: result.failed ? COLORS.YELLOW : COLORS.GREEN,
      title: t(lang, 'moderation.jail.setup.title', { emoji: EMOJI.APPROVE }),
      thumbnail: interaction.guild.iconURL({ size: 256 }),
      sections: [
        {
          lines: [
            t(lang, result.createdRole ? 'moderation.jail.setup.roleCreated' : 'moderation.jail.setup.roleExisted', { role: `${result.role}` }),
            t(lang, result.createdChannel ? 'moderation.jail.setup.channelCreated' : 'moderation.jail.setup.channelExisted', { channel: `${result.channel}` }),
            tn(lang, 'moderation.jail.setup.hiddenIn', result.applied, { count: result.applied }),
            result.failed ? tn(lang, 'moderation.jail.setup.hideFailed', result.failed, { emoji: EMOJI.WARNING, count: result.failed }) : null,
          ],
        },
        { title: t(lang, 'moderation.jail.setup.nextTitle'), lines: [t(lang, 'moderation.jail.setup.next')] },
      ],
    }));
  } catch (err) {
    logger.error('Jail setup failed:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.jail.setup.failed', { emoji: EMOJI.DENY, error: err.message }), COLORS.RED)], flags: V2 });
  }
}


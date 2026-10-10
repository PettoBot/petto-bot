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
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');
  const durationInput = interaction.options.getString('duration');
  const durationMs = durationInput ? parseDuration(durationInput) : null;

  if (durationInput && !durationMs) return refuse(interaction, 'Invalid duration. Use something like `30m`, `12h`, or `7d`.');
  if (durationMs && durationMs > MAX_JAIL_MS) return refuse(interaction, 'A jail can last up to 365 days. Leave the duration empty for no end.');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return refuse(interaction, 'That user is not a member of this server.');

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.ModerateMembers, { hierarchy: 'none' });
  if (!check.ok) return refuse(interaction, check.message);
  if (!targetMember.manageable) return refuse(interaction, 'I cannot change that member’s roles: their highest role is above or equal to mine.');

  await interaction.deferReply({ flags: V2 });
  await ensureGuild(interaction.guild.id);

  let result;
  try {
    result = await jailMember({ guild: interaction.guild, member: targetMember, moderator: interaction.user, reason, durationMs });
  } catch (err) {
    if (!(err instanceof JailError)) logger.error('Failed to jail member:', err);
    await interaction.editReply({ components: [textCard(err instanceof JailError ? err.message : 'Something went wrong while jailing that member.', COLORS.RED)], flags: V2 });
    return;
  }

  const duration = durationMs ? formatDuration(durationMs) : undefined;
  await sanctionReply(interaction, { modCase: result.modCase, type: 'jail', target: targetUser, moderator: interaction.user, reason, duration });
  await logSanction(interaction.client, interaction.guild, { modCase: result.modCase, target: targetUser, moderator: interaction.user, reason, duration });

  await targetMember
    .send(await sanctionDM({ type: 'jail', guild: interaction.guild, client: interaction.client, reason, duration, member: targetMember, moderator: interaction.user, caseNumber: result.modCase.case_number }))
    .catch(() => logger.warn(`Could not DM jail notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
}

async function releaseUser(interaction) {
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
    await interaction.editReply({ components: [textCard(err instanceof JailError ? err.message : 'Something went wrong while releasing that member.', COLORS.RED)], flags: V2 });
    return;
  }

  if (!result.ok) {
    await interaction.editReply({ components: [textCard('That user is not in jail.', COLORS.DEFAULT)], flags: V2 });
    return;
  }

  await sanctionReply(interaction, { modCase: result.modCase, type: 'unjail', target: targetUser, moderator: interaction.user, reason });
  await logSanction(interaction.client, interaction.guild, { modCase: result.modCase, target: targetUser, moderator: interaction.user, reason });

  await result.member
    ?.send(await sanctionDM({ type: 'unjail', guild: interaction.guild, client: interaction.client, reason, member: result.member, moderator: interaction.user, caseNumber: result.modCase.case_number }))
    .catch(() => logger.warn(`Could not DM unjail notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
}

async function list(interaction) {
  await interaction.deferReply({ flags: V2 });
  const rows = await listJailed(interaction.guild.id);
  if (!rows.length) {
    await interaction.editReply({ ...noticePayload('Nobody is in jail right now.', COLORS.DEFAULT), flags: V2 });
    return;
  }

  const shown = rows.slice(0, 15);
  const lines = shown.map((row) => {
    const jailedAt = Math.floor(new Date(row.jailed_at).getTime() / 1000);
    const ends = row.expires_at ? ` · ends <t:${Math.floor(new Date(row.expires_at).getTime() / 1000)}:R>` : ' · no end';
    return `<@${row.user_id}> · by <@${row.jailed_by}> · <t:${jailedAt}:R>${ends}${row.reason ? `\n> ${row.reason.slice(0, 100)}` : ''}`;
  });
  if (rows.length > shown.length) lines.push(`…and ${rows.length - shown.length} more`);

  await interaction.editReply(infoPayload({
    accent: 0xfed53c,
    title: `${EMOJI.RELEASE_LOCKED} Jail`,
    thumbnail: interaction.guild.iconURL({ size: 256 }),
    subtitle: [`-# ${rows.length} ${rows.length === 1 ? 'member' : 'members'} in jail`],
    sections: [{ lines, limit: 3000 }],
    footer: 'Use jail remove to release someone.',
  }));
}

async function setup(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return refuse(interaction, 'You need the **Manage Server** permission to set up jail.');
  const me = interaction.guild.members.me;
  if (!me.permissions.has([PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels])) return refuse(interaction, 'I need the **Manage Roles** and **Manage Channels** permissions to set up jail.');

  await interaction.deferReply({ flags: V2 });
  await ensureGuild(interaction.guild.id);

  try {
    const result = await ensureJailSetup(interaction.guild);
    await interaction.editReply(infoPayload({
      accent: result.failed ? COLORS.YELLOW : COLORS.GREEN,
      title: `${EMOJI.APPROVE} Jail is ready`,
      thumbnail: interaction.guild.iconURL({ size: 256 }),
      sections: [
        {
          lines: [
            `**Role** ${result.role} ${result.createdRole ? '· created' : '· already existed'}`,
            `**Channel** ${result.channel} ${result.createdChannel ? '· created' : '· already existed'}`,
            `**Hidden in** ${result.applied} ${result.applied === 1 ? 'channel' : 'channels'}`,
            result.failed ? `${EMOJI.WARNING} Could not hide ${result.failed} ${result.failed === 1 ? 'channel' : 'channels'}. Check my permissions there and run setup again.` : null,
          ],
        },
        { title: 'Next', lines: ['Jail a member with `jail @user 2h reason`. Staff roles can see the jail channel; add more roles to it if you need.'] },
      ],
    }));
  } catch (err) {
    logger.error('Jail setup failed:', err);
    await interaction.editReply({ components: [textCard(`${EMOJI.DENY} Jail setup failed: ${err.message}`, COLORS.RED)], flags: V2 });
  }
}


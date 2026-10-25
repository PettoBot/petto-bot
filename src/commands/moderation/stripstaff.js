// !stripstaff: takes away every role of a member that gives a staff permission, for a compromised or rogue staff account.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { canModerate } = require('../../utils/permissions');
const { filterAssignableRoles } = require('../../utils/roleResolve');
const { requireAdministrator } = require('../../utils/moderationCommand');
const { DANGEROUS_ROLE_FLAGS } = require('../../utils/antiNukeDanger');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { handleStaffAction } = require('../../logging/moreLog');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

// Every permission that makes a role a staff role: the ones a nuke needs and the everyday moderation ones.
const STAFF_FLAGS = [...DANGEROUS_ROLE_FLAGS, 'ManageMessages', 'ManageNicknames', 'ManageThreads', 'ManageGuildExpressions', 'ManageEvents', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ViewAuditLog'];
const STAFF_BITS = STAFF_FLAGS.reduce((bits, name) => bits | PermissionFlagsBits[name], 0n);

/** The roles of a member that give one of the staff permissions (@everyone is never one of them). */
function staffRolesOf(member) {
  return [...member.roles.cache.values()].filter((role) => role.id !== member.guild.id && (BigInt(role.permissions.bitfield) & STAFF_BITS) !== 0n);
}

module.exports = {
  aliases: ['strip', 'destaff'],
  data: new SlashCommandBuilder()
    .setName('stripstaff')
    .setDescription('Remove every role with staff permissions from a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason (shown in the audit log)')),

  async execute(interaction) {
    if (!(await requireAdministrator(interaction))) return;
    const lang = await languageOf(interaction);
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
      return;
    }
    // Petto needs Manage Roles, and the member must be below the moderator (never the owner, never Petto).
    const check = canModerate(interaction, member, PermissionFlagsBits.ManageRoles, { hierarchy: 'none' });
    if (!check.ok) {
      await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const staff = staffRolesOf(member);
    if (!staff.length) {
      await interaction.editReply({ components: [textCard(t(lang, 'moderation.stripstaff.none', { user: `${user}` }))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
      return;
    }
    const { assignable, blocked } = filterAssignableRoles(interaction, staff, lang);
    if (assignable.length) {
      const failed = await member.roles.remove(assignable, reason ?? t(lang, 'moderation.stripstaff.audit', { user: interaction.user.tag })).then(() => null, (err) => err);
      if (failed) {
        logger.warn(`stripstaff failed for ${member.id} in ${interaction.guild.id}: ${failed.message}`);
        await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.changeFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
        return;
      }
      handleStaffAction('staffStripped', interaction.client, interaction.guild, { moderator: interaction.user, user, detail: assignable.map((role) => `${role}`).join(' '), note: reason }).catch(() => {});
    }

    const lines = [assignable.length
      ? tn(lang, 'moderation.stripstaff.done', assignable.length, { emoji: EMOJI.APPROVE, count: assignable.length, user: `${user}`, roles: assignable.map((role) => `${role}`).join(' ') })
      : t(lang, 'moderation.stripstaff.noneRemovable', { emoji: EMOJI.DENY, user: `${user}` })];
    if (blocked.length) lines.push(t(lang, 'moderation.common.skipped', { list: blocked.join(', ') }));
    await interaction.editReply({ components: [textCard(lines.join('\n'), assignable.length ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  },
  staffRolesOf,
  STAFF_FLAGS,
};

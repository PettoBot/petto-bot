const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { createCase, getActiveSanction, deactivateCase } = require('../../db/modActions');
const { canModerate } = require('../../utils/permissions');
const { buildCaseCard, textCard } = require('../../utils/caseCard');
const { logSanction } = require('../../utils/caseLog');
const { buildSanctionDM } = require('../../utils/sanctionMessage');
const { ensureMuteRole } = require('../../utils/muteRole');
const { resolveUsers } = require('../../utils/userResolve');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { confirmBulkAction } = require('../../utils/moderationCommand');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord's native timeout hard limit

module.exports = {
  aliases: ['m'],
  prefixDefaultSubcommand: 'user',
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute members.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Mute a single member indefinitely, until manually unmuted.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to mute').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the mute').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('users')
        .setDescription('Mute multiple members indefinitely with the same reason.')
        .addStringOption((opt) => opt.setName('users').setDescription('User mentions/IDs, space or comma separated').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the mutes').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('temp')
        .setDescription("Mute a member for a set amount of time (Discord's native timeout, max 28 days).")
        .addUserOption((opt) => opt.setName('user').setDescription('The user to mute').setRequired(true))
        .addStringOption((opt) => opt.setName('duration').setDescription('e.g. 10m, 2h, 7d (max 28d)').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the mute').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a mute (timeout or mute role) from a member.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to unmute').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the unmute').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove-users')
        .setDescription('Unmute multiple members at once.')
        .addStringOption((opt) => opt.setName('users').setDescription('User mentions/IDs, space or comma separated').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the unmutes').setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'user') return muteUser(interaction);
    if (sub === 'users') return muteUsers(interaction);
    if (sub === 'temp') return tempMute(interaction);
    if (sub === 'remove') return unmuteUser(interaction);
    return unmuteUsers(interaction);
  },
};

async function muteUser(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.ModerateMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: 'I need the **Manage Roles** permission to mute members.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const guildConfig = await ensureGuild(interaction.guild.id);

  let muteRole;
  try {
    muteRole = await ensureMuteRole(interaction.guild, guildConfig);
  } catch (err) {
    logger.error('Failed to set up mute role:', err);
    await interaction.editReply({
      components: [textCard('I was unable to set up the mute role. Check my **Manage Roles** and **Manage Channels** permissions.', 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  try {
    await targetMember.roles.add(muteRole, reason ?? undefined);
  } catch (err) {
    logger.error('Failed to mute member:', err);
    await interaction.editReply({ components: [textCard('I was unable to mute that user. My role may be below theirs.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'mute', reason });

  const card = buildCaseCard({ caseNumber: modCase.case_number, type: 'mute', target: targetUser, moderator: interaction.user, reason });
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });

  await targetMember
    .send(buildSanctionDM({ type: 'mute', guild: interaction.guild, client: interaction.client, reason }))
    .catch(() => logger.warn(`Could not DM mute notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
}

async function muteUsers(interaction) {
  const usersInput = interaction.options.getString('users', true);
  const reason = interaction.options.getString('reason');

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: 'I need the **Manage Roles** permission to mute members.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  if (!(await confirmBulkAction(interaction, 'mute', usersInput))) return;

  const guildConfig = await ensureGuild(interaction.guild.id);

  let muteRole;
  try {
    muteRole = await ensureMuteRole(interaction.guild, guildConfig);
  } catch (err) {
    logger.error('Failed to set up mute role:', err);
    await interaction.editReply({ components: [textCard('I was unable to set up the mute role.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const { users, failed: notFound } = await resolveUsers(interaction.client, usersInput);

  const succeeded = [];
  const failed = [];
  const skipped = [];
  const caseNumbers = [];

  for (const user of users) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      skipped.push(user);
      continue;
    }

    try {
      await member.roles.add(muteRole, reason ?? undefined);
      const modCase = await createCase({ guildId: interaction.guild.id, userId: user.id, moderatorId: interaction.user.id, type: 'mute', reason });
      caseNumbers.push(modCase.case_number);
      succeeded.push(user);
      await logSanction(interaction.client, interaction.guild, { modCase, target: user, moderator: interaction.user, reason });
      await member
        .send(buildSanctionDM({ type: 'mute', guild: interaction.guild, client: interaction.client, reason }))
        .catch(() => logger.warn(`Could not DM mute notice to ${user.id} in guild ${interaction.guild.id}.`));
    } catch (err) {
      logger.warn(`mute users: failed to mute ${user.id}:`, err.message);
      failed.push(user);
    }
  }

  const lines = [`${EMOJI.ALERT}  Muted **${succeeded.length}** user(s)${caseNumbers.length ? ` (cases #${caseNumbers.join(', #')})` : ''}.`];
  if (succeeded.length) lines.push(succeeded.map((u) => `${u}`).join(' '));
  if (failed.length) lines.push(`${EMOJI.DENY}  Failed: ${failed.map((u) => `${u}`).join(' ')}`);
  if (skipped.length) lines.push(`Not in this server: ${skipped.map((u) => `${u}`).join(' ')}`);
  if (notFound.length) lines.push(`Not found: ${notFound.map((id) => `\`${id}\``).join(', ')}`);
  lines.push(`**Reason:** ${reason || 'No reason provided.'}`);

  const card = textCard(lines.join('\n'), 0xfed53c);
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
}

async function tempMute(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');
  const durationMs = parseDuration(interaction.options.getString('duration', true));

  if (!durationMs) {
    await interaction.reply({ content: 'Invalid duration. Use something like `10m`, `2h`, or `7d`.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (durationMs > MAX_TIMEOUT_MS) {
    await interaction.reply({ content: 'Discord timeouts cap at 28 days. Use `!mute user` for an indefinite mute instead.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.ModerateMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await targetMember.timeout(durationMs, reason ?? undefined);
  } catch (err) {
    logger.error('Failed to timeout member:', err);
    await interaction.editReply({ components: [textCard('I was unable to mute that user.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const expiresAt = new Date(Date.now() + durationMs).toISOString();
  await ensureGuild(interaction.guild.id);
  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'tempmute', reason, expiresAt });

  const duration = formatDuration(durationMs);
  const card = buildCaseCard({ caseNumber: modCase.case_number, type: 'tempmute', target: targetUser, moderator: interaction.user, reason, duration });
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason, duration });

  await targetMember
    .send(buildSanctionDM({ type: 'tempmute', guild: interaction.guild, client: interaction.client, reason, duration }))
    .catch(() => logger.warn(`Could not DM tempmute notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
}

async function unmuteUser(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.ModerateMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const guildConfig = await ensureGuild(interaction.guild.id);
  let didSomething = false;

  if (targetMember.isCommunicationDisabled?.()) {
    await targetMember.timeout(null, reason ?? undefined).catch((err) => logger.warn('Failed to clear timeout:', err.message));
    didSomething = true;
  }

  if (guildConfig.mute_role_id && targetMember.roles.cache.has(guildConfig.mute_role_id)) {
    await targetMember.roles.remove(guildConfig.mute_role_id, reason ?? undefined).catch((err) => logger.warn('Failed to remove mute role:', err.message));
    didSomething = true;
  }

  const activeSanction = await getActiveSanction(interaction.guild.id, targetUser.id, ['mute', 'tempmute']);
  if (activeSanction) {
    await deactivateCase(interaction.guild.id, activeSanction.case_number);
    didSomething = true;
  }

  if (!didSomething) {
    await interaction.editReply({ components: [textCard('That user is not currently muted.', 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'unmute', reason });

  const card = buildCaseCard({ caseNumber: modCase.case_number, type: 'unmute', target: targetUser, moderator: interaction.user, reason });
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });

  await targetMember
    .send(buildSanctionDM({ type: 'unmute', guild: interaction.guild, client: interaction.client, reason }))
    .catch(() => logger.warn(`Could not DM unmute notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
}

async function unmuteUsers(interaction) {
  const usersInput = interaction.options.getString('users', true);
  const reason = interaction.options.getString('reason');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  if (!(await confirmBulkAction(interaction, 'unmute', usersInput))) return;

  const { users, failed: notFound } = await resolveUsers(interaction.client, usersInput);
  const guildConfig = await ensureGuild(interaction.guild.id);

  const succeeded = [];
  const skipped = [];
  const caseNumbers = [];

  for (const user of users) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      skipped.push(user);
      continue;
    }

    let didSomething = false;

    if (member.isCommunicationDisabled?.()) {
      await member.timeout(null, reason ?? undefined).catch((err) => logger.warn('Failed to clear timeout:', err.message));
      didSomething = true;
    }

    if (guildConfig.mute_role_id && member.roles.cache.has(guildConfig.mute_role_id)) {
      await member.roles.remove(guildConfig.mute_role_id, reason ?? undefined).catch((err) => logger.warn('Failed to remove mute role:', err.message));
      didSomething = true;
    }

    const activeSanction = await getActiveSanction(interaction.guild.id, user.id, ['mute', 'tempmute']);
    if (activeSanction) {
      await deactivateCase(interaction.guild.id, activeSanction.case_number);
      didSomething = true;
    }

    if (!didSomething) {
      skipped.push(user);
      continue;
    }

    const modCase = await createCase({ guildId: interaction.guild.id, userId: user.id, moderatorId: interaction.user.id, type: 'unmute', reason });
    caseNumbers.push(modCase.case_number);
    succeeded.push(user);
    await logSanction(interaction.client, interaction.guild, { modCase, target: user, moderator: interaction.user, reason });

    await member
      .send(buildSanctionDM({ type: 'unmute', guild: interaction.guild, client: interaction.client, reason }))
      .catch(() => logger.warn(`Could not DM unmute notice to ${user.id} in guild ${interaction.guild.id}.`));
  }

  const lines = [`${EMOJI.APPROVE}  Unmuted **${succeeded.length}** user(s)${caseNumbers.length ? ` (cases #${caseNumbers.join(', #')})` : ''}.`];
  if (succeeded.length) lines.push(succeeded.map((u) => `${u}`).join(' '));
  if (skipped.length) lines.push(`Skipped (not muted / not in server): ${skipped.map((u) => `${u}`).join(' ')}`);
  if (notFound.length) lines.push(`Not found: ${notFound.map((id) => `\`${id}\``).join(', ')}`);

  const card = textCard(lines.join('\n'), 0xa5ea7a);
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
}

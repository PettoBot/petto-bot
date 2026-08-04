const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { addWarn } = require('../../db/warns');
const { getRules, addRule, removeRule } = require('../../db/escalation');
const { canModerate } = require('../../utils/permissions');
const { buildCaseCard, textCard } = require('../../utils/caseCard');
const { logSanction } = require('../../utils/caseLog');
const { buildSanctionDM } = require('../../utils/sanctionMessage');
const { resolveUsers } = require('../../utils/userResolve');
const { checkAndApplyEscalation } = require('../../utils/escalation');
const { parseDuration } = require('../../utils/duration');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { confirmBulkAction } = require('../../utils/moderationCommand');

// Discord has no native "warn" permission; Moderate Members (used for timeouts)
// is the closest built-in stand-in for "this person is server staff".
const WARN_PERMISSION = PermissionFlagsBits.ModerateMembers;

module.exports = {
  aliases: ['w'],
  prefixDefaultSubcommand: 'user',
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn members. Warnings are recorded in their history.')
    .setDefaultMemberPermissions(WARN_PERMISSION)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Warn a single member.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to warn').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the warning').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('users')
        .setDescription('Warn multiple members with the same reason.')
        .addStringOption((opt) => opt.setName('users').setDescription('User mentions/IDs, space or comma separated').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the warnings').setRequired(true)),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('escalation')
        .setDescription('Automatic consequences once a user reaches a certain number of warnings.')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Set what happens at a warning threshold.')
            .addIntegerOption((opt) => opt.setName('threshold').setDescription('Warning count that triggers this').setRequired(true).setMinValue(1))
            .addStringOption((opt) =>
              opt
                .setName('action')
                .setDescription('What to do')
                .setRequired(true)
                .addChoices({ name: 'mute (indefinite)', value: 'mute' }, { name: 'tempmute', value: 'tempmute' }, { name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' }),
            )
            .addStringOption((opt) => opt.setName('duration').setDescription('Duration for tempmute, e.g. 1h, 12h, 1d (required if action is tempmute)').setRequired(false)),
        )
        .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a threshold rule.').addIntegerOption((opt) => opt.setName('threshold').setDescription('Warning count').setRequired(true).setMinValue(1)))
        .addSubcommand((sub) => sub.setName('list').setDescription('List escalation rules.')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    if (group === 'escalation') return escalation(interaction, sub);
    if (sub === 'user') return warnUser(interaction);
    return warnUsers(interaction);
  },
};

async function warnUser(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const check = canModerate(interaction, targetMember, WARN_PERMISSION);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  await ensureGuild(interaction.guild.id);
  const { modCase, warnCount } = await addWarn({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, reason });

  const card = buildCaseCard({ caseNumber: modCase.case_number, type: 'warn', target: targetUser, moderator: interaction.user, reason });
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });

  await targetMember
    .send(buildSanctionDM({ type: 'warn', guild: interaction.guild, client: interaction.client, reason }))
    .catch(() => logger.warn(`Could not DM warn notice to ${targetUser.id} in guild ${interaction.guild.id}.`));

  await checkAndApplyEscalation(interaction.client, interaction.guild, targetMember, warnCount).catch((err) => logger.error('Escalation check failed:', err));
}

async function warnUsers(interaction) {
  const usersInput = interaction.options.getString('users', true);
  const reason = interaction.options.getString('reason', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  if (!(await confirmBulkAction(interaction, 'warn', usersInput))) return;

  const { users, failed: notFound } = await resolveUsers(interaction.client, usersInput);
  await ensureGuild(interaction.guild.id);

  const succeeded = [];
  const skipped = [];
  const caseNumbers = [];

  for (const user of users) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      skipped.push(user);
      continue;
    }

    const { modCase, warnCount } = await addWarn({ guildId: interaction.guild.id, userId: user.id, moderatorId: interaction.user.id, reason });
    caseNumbers.push(modCase.case_number);
    succeeded.push(user);
    await logSanction(interaction.client, interaction.guild, { modCase, target: user, moderator: interaction.user, reason });

    await member
      .send(buildSanctionDM({ type: 'warn', guild: interaction.guild, client: interaction.client, reason }))
      .catch(() => logger.warn(`Could not DM warn notice to ${user.id} in guild ${interaction.guild.id}.`));

    await checkAndApplyEscalation(interaction.client, interaction.guild, member, warnCount).catch((err) => logger.error('Escalation check failed:', err));
  }

  const lines = [`${EMOJI.WARNING}  Warned **${succeeded.length}** user(s)${caseNumbers.length ? ` (cases #${caseNumbers.join(', #')})` : ''}.`];
  if (succeeded.length) lines.push(succeeded.map((u) => `${u}`).join(' '));
  if (skipped.length) lines.push(`Not in this server: ${skipped.map((u) => `${u}`).join(' ')}`);
  if (notFound.length) lines.push(`Not found: ${notFound.map((id) => `\`${id}\``).join(', ')}`);
  lines.push(`**Reason:** ${reason}`);

  const card = textCard(lines.join('\n'), 0xfed53c);
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
}

async function escalation(interaction, sub) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const rules = await getRules(interaction.guild.id);
    if (!rules.length) {
      await interaction.editReply({ components: [textCard('No escalation rules configured.', 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const lines = rules.map((r) => `**${r.warn_count}** warning(s) → ${r.action}${r.duration_ms ? ` (${Math.round(r.duration_ms / 60000)}m)` : ''}`);
    await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'remove') {
    const threshold = interaction.options.getInteger('threshold', true);
    const removed = await removeRule(interaction.guild.id, threshold);
    await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Removed the rule for ${threshold} warning(s).` : `No rule found for ${threshold} warning(s).`, removed ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // add
  const threshold = interaction.options.getInteger('threshold', true);
  const action = interaction.options.getString('action', true);
  const durationStr = interaction.options.getString('duration');

  let durationMs = null;
  if (action === 'tempmute') {
    durationMs = parseDuration(durationStr ?? '');
    if (!durationMs) {
      await interaction.editReply({ components: [textCard('`tempmute` needs a valid `duration`, e.g. `1h`, `12h`, `1d`.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  await addRule(interaction.guild.id, threshold, action, durationMs);
  const text = `${EMOJI.APPROVE}  At **${threshold}** warning(s), users will now be **${action}${durationMs ? ` (${durationStr})` : ''}** automatically.`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

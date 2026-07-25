const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserHistory, getLastCase, getCase, updateCase, deleteCase, deleteAllForUser } = require('../../db/modActions');
const { formatCaseLine, formatCaseDetail } = require('../../utils/caseFormat');
const { textCard } = require('../../utils/caseCard');
const { resolveUsers } = require('../../utils/userResolve');
const { parseDuration } = require('../../utils/duration');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  aliases: ['cases'],
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Look up, edit, or delete moderation case history.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('list').setDescription("Show a user's infraction history.").addUserOption((opt) => opt.setName('user').setDescription('The user to check').setRequired(true)))
    .addSubcommand((sub) => sub.setName('last').setDescription("Show a user's most recent infraction.").addUserOption((opt) => opt.setName('user').setDescription('The user to check').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('last-many').setDescription('Show the most recent infraction for multiple users.').addStringOption((opt) => opt.setName('users').setDescription('User mentions/IDs, space or comma separated').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('view').setDescription('Look up a case by its number.').addIntegerOption((opt) => opt.setName('case').setDescription('Case number').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit a case\'s reason or duration.')
        .addIntegerOption((opt) => opt.setName('case').setDescription('Case number').setRequired(true).setMinValue(1))
        .addStringOption((opt) => opt.setName('duration').setDescription('New duration from now, e.g. 7d (only for tempban/tempmute)').setRequired(false))
        .addStringOption((opt) => opt.setName('reason').setDescription('New reason').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit-many')
        .setDescription('Edit the reason or duration of multiple cases at once.')
        .addStringOption((opt) => opt.setName('cases').setDescription('Case numbers, space or comma separated').setRequired(true))
        .addStringOption((opt) => opt.setName('duration').setDescription('New duration from now, e.g. 7d (only for tempban/tempmute)').setRequired(false))
        .addStringOption((opt) => opt.setName('reason').setDescription('New reason').setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete a single case by number.').addIntegerOption((opt) => opt.setName('case').setDescription('Case number').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('delete-all').setDescription("Delete a user's entire case history.").addUserOption((opt) => opt.setName('user').setDescription('The user whose cases to wipe').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') return list(interaction);
    if (sub === 'last') return last(interaction);
    if (sub === 'last-many') return lastMany(interaction);
    if (sub === 'view') return view(interaction);
    if (sub === 'edit') return edit(interaction);
    if (sub === 'edit-many') return editMany(interaction);
    if (sub === 'delete') return del(interaction);
    return deleteAll(interaction);
  },
};

async function list(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const history = await getUserHistory(interaction.guild.id, targetUser.id, { limit: 15 });
  if (!history.length) {
    await interaction.editReply({ components: [textCard(`${targetUser} has no infractions on record.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [`### Infractions for ${targetUser}`, ...history.map(formatCaseLine)];
  await interaction.editReply({ components: [textCard(lines.join('\n\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function last(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const row = await getLastCase(interaction.guild.id, targetUser.id);
  if (!row) {
    await interaction.editReply({ components: [textCard(`${targetUser} has no infractions on record.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await interaction.editReply({ components: [textCard(formatCaseDetail(row), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function lastMany(interaction) {
  const usersInput = interaction.options.getString('users', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const { users, failed: notFound } = await resolveUsers(interaction.client, usersInput);

  const lines = ['### Most recent infractions'];
  for (const user of users) {
    const row = await getLastCase(interaction.guild.id, user.id);
    lines.push(row ? formatCaseLine(row) : `${user}: no infractions on record.`);
  }
  if (notFound.length) lines.push(`Not found: ${notFound.map((id) => `\`${id}\``).join(', ')}`);

  await interaction.editReply({ components: [textCard(lines.join('\n\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function view(interaction) {
  const caseNumber = interaction.options.getInteger('case', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const row = await getCase(interaction.guild.id, caseNumber);
  if (!row) {
    await interaction.editReply({ components: [textCard(`No case #${caseNumber} found in this server.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await interaction.editReply({ components: [textCard(formatCaseDetail(row), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function edit(interaction) {
  const caseNumber = interaction.options.getInteger('case', true);
  const reason = interaction.options.getString('reason');
  const durationStr = interaction.options.getString('duration');

  if (!reason && !durationStr) {
    await interaction.reply({ content: 'Provide at least a new `reason` or `duration`.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const row = await getCase(interaction.guild.id, caseNumber);
  if (!row) {
    await interaction.editReply({ components: [textCard(`No case #${caseNumber} found in this server.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const patch = {};
  if (reason) patch.reason = reason;

  if (durationStr) {
    if (!['tempban', 'tempmute'].includes(row.type)) {
      await interaction.editReply({ components: [textCard(`Case #${caseNumber} is a \`${row.type}\`, which has no duration to change.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
      await interaction.editReply({ components: [textCard('Invalid duration. Use something like `10m`, `2h`, or `7d`.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    patch.expiresAt = new Date(Date.now() + durationMs).toISOString();
  }

  const updated = await updateCase(interaction.guild.id, caseNumber, patch);
  const text = `${EMOJI.APPROVE}  Updated case #${caseNumber}.\n\n${formatCaseDetail(updated)}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function editMany(interaction) {
  const casesInput = interaction.options.getString('cases', true);
  const reason = interaction.options.getString('reason');
  const durationStr = interaction.options.getString('duration');

  if (!reason && !durationStr) {
    await interaction.reply({ content: 'Provide at least a new `reason` or `duration`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const durationMs = durationStr ? parseDuration(durationStr) : null;
  if (durationStr && !durationMs) {
    await interaction.reply({ content: 'Invalid duration. Use something like `10m`, `2h`, or `7d`.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const caseNumbers = [...new Set(casesInput.split(/[\s,]+/).filter(Boolean).map(Number))].filter((n) => Number.isInteger(n) && n > 0);

  const updated = [];
  const skipped = [];

  for (const caseNumber of caseNumbers) {
    const row = await getCase(interaction.guild.id, caseNumber);
    if (!row) {
      skipped.push(`#${caseNumber} (not found)`);
      continue;
    }

    const patch = {};
    if (reason) patch.reason = reason;
    if (durationMs) {
      if (!['tempban', 'tempmute'].includes(row.type)) {
        skipped.push(`#${caseNumber} (no duration to change)`);
        continue;
      }
      patch.expiresAt = new Date(Date.now() + durationMs).toISOString();
    }

    await updateCase(interaction.guild.id, caseNumber, patch);
    updated.push(caseNumber);
  }

  const lines = [`${EMOJI.APPROVE}  Updated **${updated.length}** case(s)${updated.length ? `: #${updated.join(', #')}` : ''}.`];
  if (skipped.length) lines.push(`Skipped: ${skipped.join(', ')}`);
  if (reason) lines.push(`**New reason:** ${reason}`);
  if (durationStr) lines.push(`**New duration:** ${durationStr}`);

  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function del(interaction) {
  const caseNumber = interaction.options.getInteger('case', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const row = await getCase(interaction.guild.id, caseNumber);
  if (!row) {
    await interaction.editReply({ components: [textCard(`No case #${caseNumber} found in this server.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await deleteCase(interaction.guild.id, caseNumber);

  const text = `${EMOJI.APPROVE}  Deleted case #${caseNumber}.\n\n${formatCaseDetail(row)}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function deleteAll(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const history = await getUserHistory(interaction.guild.id, targetUser.id, { limit: 1000 });
  if (!history.length) {
    await interaction.editReply({ components: [textCard(`${targetUser} has no infractions on record.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('case_deleteall_confirm').setLabel(`Delete all ${history.length}`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('case_deleteall_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  const promptCard = textCard(`${EMOJI.ALERT}  This will permanently delete **${history.length}** infraction(s) for ${targetUser}. Continue?`, 0xfe6465);
  const promptMessage = await interaction.editReply({ components: [promptCard, confirmRow], flags: MessageFlags.IsComponentsV2 });

  let click;
  try {
    click = await promptMessage.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 30_000 });
  } catch {
    await interaction.editReply({ components: [textCard(`${EMOJI.DENY}  Timed out. Nothing was deleted.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (click.customId === 'case_deleteall_cancel') {
    await click.update({ components: [textCard(`${EMOJI.DENY}  Cancelled. Nothing was deleted.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const deleted = await deleteAllForUser(interaction.guild.id, targetUser.id);
  await click.update({ components: [textCard(`${EMOJI.APPROVE}  Deleted **${deleted}** infraction(s) for ${targetUser}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

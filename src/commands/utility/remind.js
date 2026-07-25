const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const remindersDb = require('../../db/reminders');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { ensureGuild } = require('../../db/guilds');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set a personal reminder.')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Set a reminder.')
        .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d').setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('What to remind you about').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List your active reminders.'))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a reminder.').addIntegerOption((o) => o.setName('id').setDescription('Reminder ID (from `remind list`)').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addCmd(interaction);
    if (sub === 'list') return listCmd(interaction);
    return cancelCmd(interaction);
  },
};

async function addCmd(interaction) {
  const durationMs = parseDuration(interaction.options.getString('duration', true));
  if (!durationMs) {
    await interaction.reply({ content: 'Provide a valid duration, e.g. `10m`, `2h`, `1d`.', flags: MessageFlags.Ephemeral });
    return;
  }
  const message = interaction.options.getString('message', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  try {
    const reminder = await remindersDb.createReminder({ guildId: interaction.guild.id, channelId: interaction.channel.id, userId: interaction.user.id, message, remindAt: new Date(Date.now() + durationMs) });
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Reminder #${reminder.id} set for **${formatDuration(durationMs)}** from now.`, COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    await interaction.editReply({ components: [textCard(err.userFacing ? err.message : 'Failed to set that reminder.', COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function listCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await remindersDb.listActive(interaction.guild.id, interaction.user.id);
  const text = rows.length
    ? rows.map((r) => `**#${r.id}** — <t:${Math.floor(new Date(r.remind_at).getTime() / 1000)}:R> — ${r.message}`).join('\n')
    : "You don't have any active reminders.";
  await interaction.editReply({ components: [textCard(text, COLORS.BLUE)], flags: MessageFlags.IsComponentsV2 });
}

async function cancelCmd(interaction) {
  const id = interaction.options.getInteger('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await remindersDb.cancelReminder(interaction.guild.id, interaction.user.id, id);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Reminder cancelled.` : "That reminder doesn't exist (or isn't yours).", removed ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
}

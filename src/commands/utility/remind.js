const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const remindersDb = require('../../db/reminders');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { parseWhen } = require('../../utils/when');
const { ensureGuild } = require('../../db/guilds');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['rem'],
  // `!remind 2h text` is shorthand for `!remind add 2h text`.
  prefixDefaultSubcommand: 'add',
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set a personal reminder.')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Ask Petto to remind you of something later, e.g. remind add 2h water.')
        .addStringOption((o) => o.setName('duration').setDescription('A length or a moment: 10m, 3d 4h, tomorrow 8pm, 2026-10-12 18:00').setRequired(true))
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
  const lang = await languageOf(interaction);
  // A length of time ("2h", "3d 4h") or a moment ("tomorrow 8pm", "2026-10-12 18:00").
  const when = interaction.options.getString('duration', true);
  const moment = parseWhen(when);
  const durationMs = moment === null ? null : moment - Date.now();
  if (!durationMs || durationMs <= 0) {
    await interaction.reply({ content: t(lang, 'utility.remind.badTime'), flags: MessageFlags.Ephemeral });
    return;
  }
  const message = interaction.options.getString('message', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  try {
    const reminder = await remindersDb.createReminder({ guildId: interaction.guild.id, channelId: interaction.channel.id, userId: interaction.user.id, message, remindAt: new Date(Date.now() + durationMs) });
    await interaction.editReply({ components: [textCard(t(lang, 'utility.remind.set', { emoji: EMOJI.APPROVE, id: reminder.id, duration: formatDuration(durationMs, lang) }), COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    await interaction.editReply({ components: [textCard(err.userFacing ? err.message : t(lang, 'utility.remind.failed'), COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await remindersDb.listActive(interaction.guild.id, interaction.user.id);
  const text = rows.length
    ? rows.map((r) => `**#${r.id}** — <t:${Math.floor(new Date(r.remind_at).getTime() / 1000)}:R> — ${r.message}`).join('\n')
    : t(lang, 'utility.remind.none');
  await interaction.editReply({ components: [textCard(text, COLORS.DEFAULT)], flags: MessageFlags.IsComponentsV2 });
}

async function cancelCmd(interaction) {
  const lang = await languageOf(interaction);
  const id = interaction.options.getInteger('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await remindersDb.cancelReminder(interaction.guild.id, interaction.user.id, id);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'utility.remind.cancelled', { emoji: EMOJI.APPROVE }) : t(lang, 'utility.remind.notFound'), removed ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
}

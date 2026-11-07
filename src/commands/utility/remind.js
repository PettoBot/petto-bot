const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } = require('discord.js');
const remindersDb = require('../../db/reminders');
const { parseDuration } = require('../../utils/duration');
const { parseWhen } = require('../../utils/when');
const { ensureGuild } = require('../../db/guilds');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

module.exports = {
  // Also registered as a slash command (one of the everyday ones people look for with `/`); the prefix keeps working.
  registerSlash: true,
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
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a reminder.').addIntegerOption((o) => o.setName('id').setDescription('Number of the reminder in your list (from `remind list`)').setMinValue(1).setRequired(true))),

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
    const remindAt = new Date(Date.now() + durationMs);
    await remindersDb.createReminder({ guildId: interaction.guild.id, channelId: interaction.channel.id, userId: interaction.user.id, message, remindAt });
    await interaction.editReply({ components: [reminderSetCard({ lang, channelId: interaction.channel.id, message, remindAt })], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    await interaction.editReply({ components: [textCard(err.userFacing ? err.message : t(lang, 'utility.remind.failed'), COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
  }
}

/** The moment as Discord shows it in each person's own clock: `22:54 (in 9 minutes)`. */
const momentText = (date) => `<t:${Math.floor(new Date(date).getTime() / 1000)}:t> (<t:${Math.floor(new Date(date).getTime() / 1000)}:R>)`;
const clip = (text, length) => (String(text).length > length ? `${String(text).slice(0, length - 1)}…` : String(text));
const quote = (text) => String(text).split('\n').map((line) => `> ${line}`).join('\n');

/** The confirmation of a reminder: what it says, where Petto will remind and when. Nothing here is a number of the database. */
function reminderSetCard({ lang, channelId, message, remindAt }) {
  const card = new ContainerBuilder();
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${t(lang, 'utility.remind.card.title')}\n${t(lang, 'utility.remind.card.where', { channel: `<#${channelId}>` })}`));
  card.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${t(lang, 'utility.remind.card.when')}**\n${momentText(remindAt)}\n\n**${t(lang, 'utility.remind.card.what')}**\n${quote(clip(message, 900))}`));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${t(lang, 'utility.remind.card.footer')}`));
  return card;
}

/** The list of a member's reminders: numbered 1, 2, 3 in their own list (the order they will ring in), not by the database's number. */
function reminderListCard({ lang, rows }) {
  const card = new ContainerBuilder();
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${t(lang, 'utility.remind.list.title')}`));
  card.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const lines = rows.map((row, i) => `**${i + 1}.** ${momentText(row.remind_at)}\n${quote(clip(row.message, 160))}`);
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(lines.join('\n\n'), 3800)));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${t(lang, 'utility.remind.list.footer')}`));
  return card;
}

async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await remindersDb.listActive(interaction.guild.id, interaction.user.id);
  const card = rows.length ? reminderListCard({ lang, rows }) : textCard(t(lang, 'utility.remind.none'), COLORS.DEFAULT);
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
}

async function cancelCmd(interaction) {
  const lang = await languageOf(interaction);
  // The number is the place in the member's own list (`remind list`), never the database's number, which is shared by everybody.
  const number = interaction.options.getInteger('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await remindersDb.listActive(interaction.guild.id, interaction.user.id);
  // A number that is not in the list matches nothing (0 is never a reminder), so the answer is "not found" and nothing is deleted.
  const removed = await remindersDb.cancelReminder(interaction.guild.id, interaction.user.id, rows[number - 1]?.id ?? 0);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'utility.remind.cancelled', { emoji: EMOJI.APPROVE }) : t(lang, 'utility.remind.notFound'), removed ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
}

module.exports.reminderSetCard = reminderSetCard;
module.exports.reminderListCard = reminderListCard;

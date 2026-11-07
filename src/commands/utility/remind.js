const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder } = require('discord.js');
const remindersDb = require('../../db/reminders');
const { parseDuration, formatDuration } = require('../../utils/duration');
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
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a reminder: pick it from your list.')),

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

const MENU_ID = 'remind_cancel';
const MENU_TIMEOUT_MS = 120_000;

/** The list of a member's reminders: when each one rings and what it says, and a menu to cancel one (no numbers: the database's are shared by everybody). */
function reminderListCard({ lang, rows, notice = null, disabled = false }) {
  const card = new ContainerBuilder();
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${t(lang, 'utility.remind.list.title')}${notice ? `\n${notice}` : ''}`));
  card.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  if (!rows.length) {
    card.addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'utility.remind.none')));
    return card;
  }
  const lines = rows.map((row) => `${momentText(row.remind_at)}\n${quote(clip(row.message, 160))}`);
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(lines.join('\n\n'), 3800)));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${t(lang, 'utility.remind.list.footer')}`));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(MENU_ID)
    .setPlaceholder(t(lang, 'utility.remind.menu.placeholder'))
    .setDisabled(disabled)
    .addOptions(rows.slice(0, 25).map((row) => ({
      label: clip(String(row.message).replace(/\s+/g, ' '), 90),
      description: clip(t(lang, 'utility.remind.menu.in', { duration: formatDuration(Math.max(0, new Date(row.remind_at).getTime() - Date.now()), lang) }), 90),
      value: String(row.id),
    })));
  card.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  return card;
}

/** `remind list` and `remind cancel`: the member's reminders, with a menu to cancel the one picked (only the member who asked can use it). */
async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  let rows = await remindersDb.listActive(guildId, userId);
  const msg = await interaction.editReply({ components: [reminderListCard({ lang, rows })], flags: MessageFlags.IsComponentsV2 });
  if (!rows.length || !msg?.createMessageComponentCollector) return;

  const collector = msg.createMessageComponentCollector({ time: MENU_TIMEOUT_MS });
  collector.on('collect', async (i) => {
    if (i.user.id !== userId) {
      await i.reply({ content: t(lang, 'utility.remind.notYours'), flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    // Deleted with the member's own id, so a reminder of somebody else can never be removed from here.
    const removed = await remindersDb.cancelReminder(guildId, userId, Number(i.values?.[0]));
    rows = await remindersDb.listActive(guildId, userId);
    const notice = removed ? t(lang, 'utility.remind.cancelled', { emoji: EMOJI.APPROVE }) : t(lang, 'utility.remind.notFound');
    await i.update({ components: [reminderListCard({ lang, rows, notice })], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    if (!rows.length) collector.stop('empty');
  });
  collector.on('end', (_collected, reason) => {
    if (reason === 'empty') return;
    msg.edit({ components: [reminderListCard({ lang, rows, disabled: true })], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  });
}

const cancelCmd = listCmd;

module.exports.reminderSetCard = reminderSetCard;
module.exports.reminderListCard = reminderListCard;

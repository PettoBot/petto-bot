const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { textCard } = require('./caseCard');
const { EMOJI } = require('./emojis');
const { t, currentLanguage, languageOf } = require('../i18n');

function asSubcommand(interaction, subcommand) {
  const proxy = Object.create(interaction);
  proxy.options = Object.create(interaction.options);
  proxy.options.getSubcommand = () => subcommand;
  return proxy;
}

async function requireAdministrator(interaction) {
  if (interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  const lang = await languageOf(interaction);
  await interaction.reply({
    content: t(lang, 'moderation.bulk.needsAdmin'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

/** `action` is `ban`, `kick`, `mute`, `unmute` or `warn`: each has its own sentence in the confirmation. */
async function confirmBulkAction(interaction, action, targets) {
  const lang = await languageOf(interaction);
  const targetText = String(targets).trim().slice(0, 180);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('modbulk_confirm').setLabel(t(lang, 'moderation.bulk.confirm.button')).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('modbulk_cancel').setLabel(t(lang, 'moderation.bulk.cancel.button')).setStyle(ButtonStyle.Secondary),
  );

  const prompt = [
    t(lang, `moderation.bulk.prompt.${action}`, { emoji: EMOJI.WARNING }),
    '',
    t(lang, 'moderation.bulk.targets', { targets: targetText }),
    '',
    t(lang, 'moderation.bulk.skipNote'),
    t(lang, 'moderation.bulk.continue'),
  ].join('\n');

  const message = await interaction.editReply({
    components: [textCard(prompt, 0xfed53c), row],
    flags: MessageFlags.IsComponentsV2,
  });

  let click;
  try {
    click = await message.awaitMessageComponent({
      filter: (component) => component.user.id === interaction.user.id,
      time: 30_000,
    });
  } catch {
    await interaction.editReply({
      components: [textCard(t(lang, 'moderation.bulk.timedOut', { emoji: EMOJI.DENY }), 0x4b4f59)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
    return false;
  }

  if (click.customId !== 'modbulk_confirm') {
    await click.update({
      components: [textCard(t(lang, 'moderation.bulk.cancelled', { emoji: EMOJI.DENY }), 0x4b4f59)],
      flags: MessageFlags.IsComponentsV2,
    });
    return false;
  }

  await click.update({
    components: [textCard(t(lang, 'moderation.bulk.confirmed', { emoji: EMOJI.APPROVE }), 0xfed53c)],
    flags: MessageFlags.IsComponentsV2,
  });
  return true;
}

/** What Discord said when an action failed, in a few words, to add to "I was unable to...". Empty when there is nothing useful to say. */
function failureDetail(error, lang = currentLanguage()) {
  const text = String(error?.rawError?.message ?? error?.message ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return t(lang, 'moderation.failure.discordSaid', { text: `${text.slice(0, 160)}${error?.code ? ` (${error.code})` : ''}` });
}

module.exports = { asSubcommand, confirmBulkAction, requireAdministrator, failureDetail };

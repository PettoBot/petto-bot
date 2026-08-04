const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { textCard } = require('./caseCard');
const { EMOJI } = require('./emojis');

function asSubcommand(interaction, subcommand) {
  const proxy = Object.create(interaction);
  proxy.options = Object.create(interaction.options);
  proxy.options.getSubcommand = () => subcommand;
  return proxy;
}

async function confirmBulkAction(interaction, action, targets) {
  const targetText = String(targets).trim().slice(0, 180);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('modbulk_confirm').setLabel('Confirm').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('modbulk_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  const prompt = [
    EMOJI.WARNING + '  You are about to **' + action + '** multiple members.',
    '',
    '**Targets:** ' + targetText,
    '',
    'This action will skip members above my role and cannot be automatically undone.',
    'Continue?',
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
      components: [textCard(EMOJI.DENY + '  Timed out. No members were changed.', 0x4b4f59)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
    return false;
  }

  if (click.customId !== 'modbulk_confirm') {
    await click.update({
      components: [textCard(EMOJI.DENY + '  Cancelled. No members were changed.', 0x4b4f59)],
      flags: MessageFlags.IsComponentsV2,
    });
    return false;
  }

  await click.update({
    components: [textCard(EMOJI.APPROVE + '  Confirmed. Processing the moderation action...', 0xfed53c)],
    flags: MessageFlags.IsComponentsV2,
  });
  return true;
}

module.exports = { asSubcommand, confirmBulkAction };

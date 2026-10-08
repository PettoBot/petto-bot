const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { isPettoOperator } = require('../../utils/autoModControl');
const { STATUSES, chooseStatus, currentStatus } = require('../../utils/botPresence');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const LABELS = { online: 'Online (green dot, with the phone icon)', idle: 'Idle (yellow moon)', dnd: 'Do not disturb (red dot)', invisible: 'Invisible (shown as offline)' };

/** Private control for Petto's team: the status dot of the bot. Prefix-only and hidden from !help. */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  data: new SlashCommandBuilder()
    .setName('botstatus')
    .setDescription("Private control: change Petto's status dot, or show it if you give none.")
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('status')
      .setDescription('online, idle, dnd or invisible')
      .addChoices(...STATUSES.map((value) => ({ name: value, value })))
      .setRequired(false)),

  async execute(interaction) {
    if (!isPettoOperator(interaction.user?.id)) {
      return reply(interaction, `${EMOJI.DENY} This private control is not available to this account.`, 0xfe6465);
    }

    const requested = interaction.options.getString('status');
    if (!requested) {
      const status = await currentStatus();
      return reply(interaction, `${EMOJI.STAR} Petto's status is **${LABELS[status]}**.\n-# Change it with \`!botstatus online\`, \`idle\`, \`dnd\` or \`invisible\`. The phone icon only shows with online.${config.mobileStatus ? '' : ' The phone app mode is off (PETTO_MOBILE_STATUS=false).'}`, 0x4b4f59);
    }

    try {
      const status = await chooseStatus(interaction.client, requested);
      return reply(interaction, `${EMOJI.APPROVE} Petto's status is now **${LABELS[status]}**. It stays that way after a restart.`, 0xa5ea7a);
    } catch (error) {
      return reply(interaction, `${EMOJI.DENY} ${error.message || 'Could not change the status.'}`, 0xfe6465);
    }
  },
};

async function reply(interaction, content, color) {
  return interaction.reply({ components: [textCard(content, color)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

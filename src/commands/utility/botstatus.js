// i18n-ignore-file: Petto team operator command.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isPettoOperator } = require('../../utils/autoModControl');
const { STATUSES, chooseStatus, currentStatus } = require('../../utils/botPresence');
const botDevice = require('../../utils/botDevice');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const DEVICE_LABELS = {
  normal: 'Normal (no phone icon)',
  phone: (identity) => `Phone (the ${identity === 'ios' ? 'iOS' : 'Android'} app icon)`,
  android: 'Android app (phone icon)',
  ios: 'iOS app (phone icon)',
};

/** What the dot is called, with the phone icon only when the bot connects as a phone. */
function statusLabel(status, device) {
  const icon = device === 'normal' ? '' : ', with the phone icon';
  return {
    online: `Online (green dot${icon})`,
    idle: 'Idle (yellow moon)',
    dnd: 'Do not disturb (red dot)',
    invisible: 'Invisible (shown as offline)',
  }[status];
}

function deviceLabel(device) {
  const label = DEVICE_LABELS[device];
  return typeof label === 'function' ? label(botDevice.identityOf(device)) : label;
}

/** Private control for Petto's team: the status dot of the bot and the device it connects as. Prefix-only and hidden from !help. */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  statusLabel,
  deviceLabel,
  data: new SlashCommandBuilder()
    .setName('botstatus')
    .setDescription("Private control: change Petto's status dot and device, or show them if you give none.")
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('status')
      .setDescription('online, idle, dnd or invisible')
      .addChoices(...STATUSES.map((value) => ({ name: value, value })))
      .setRequired(false))
    .addStringOption((option) => option
      .setName('device')
      .setDescription('normal, phone, android or ios')
      .addChoices(...botDevice.DEVICES.map((value) => ({ name: value, value })))
      .setRequired(false)),

  async execute(interaction) {
    if (!isPettoOperator(interaction.user?.id)) {
      return reply(interaction, `${EMOJI.DENY} This private control is not available to this account.`, 0xfe6465);
    }

    // `!botstatus device phone` reads as status "device" and device "phone": the word `device` says which one is meant, and a device
    // word typed alone (`!botstatus phone`) is the device too. None of them is a status.
    let requestedStatus = interaction.options.getString('status');
    let requestedDevice = interaction.options.getString('device');
    let deviceKeyword = false;
    if (requestedStatus && String(requestedStatus).trim().toLowerCase() === 'device') {
      deviceKeyword = true;
      requestedStatus = null;
    } else if (requestedStatus && !requestedDevice && !STATUSES.includes(String(requestedStatus).trim().toLowerCase()) && botDevice.normalizeDevice(requestedStatus)) {
      requestedDevice = requestedStatus;
      requestedStatus = null;
    }
    if (requestedDevice) deviceKeyword = true;

    if (!requestedStatus && !requestedDevice) {
      const [status, { device, source }] = await Promise.all([currentStatus(), botDevice.currentDevice()]);
      const where = source === 'saved' ? 'saved' : 'from the environment, PETTO_MOBILE_STATUS';
      return reply(interaction, `${EMOJI.STAR} Petto's status is **${statusLabel(status, device)}**.\n${EMOJI.STAR} Its device is **${deviceLabel(device)}** (${where}).\n-# Change the dot with \`!botstatus online\`, \`idle\`, \`dnd\` or \`invisible\`, and the device with \`!botstatus device normal\`, \`phone\`, \`android\` or \`ios\`. The phone icon only shows with online, and a new device restarts the bot.${deviceKeyword ? '\n-# Give the device after the word: `!botstatus device phone`.' : ''}`);
    }

    const lines = [];
    let change = null;
    try {
      if (requestedStatus) {
        const status = await chooseStatus(interaction.client, requestedStatus);
        const { device } = await botDevice.currentDevice();
        lines.push(`${EMOJI.APPROVE} Petto's status is now **${statusLabel(status, device)}**. It stays that way after a restart.`);
      }
      if (requestedDevice) {
        change = await botDevice.chooseDevice(requestedDevice);
        lines.push(change.restart
          ? `${EMOJI.APPROVE} Petto's device is now **${deviceLabel(change.device)}**. It is saved, so it stays after a restart. Petto restarts in a few seconds to connect that way: the host starts it again by itself, and it is back in about a minute.`
          : `${EMOJI.APPROVE} Petto's device is **${deviceLabel(change.device)}**, which is how it already connects. It is saved, and nothing restarts.`);
      }
    } catch (error) {
      return reply(interaction, `${EMOJI.DENY} ${error.message || 'Could not change the status.'}`, 0xfe6465);
    }

    // The answer first; the restart waits a few seconds after it so it is delivered.
    await reply(interaction, lines.join('\n'), 0xa5ea7a);
    if (change?.restart) botDevice.reconnectWith(change.device);
    return undefined;
  },
};

async function reply(interaction, content, color) {
  return interaction.reply({ components: [textCard(content, color)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

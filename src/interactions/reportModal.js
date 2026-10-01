const {
  CheckboxBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getConfig } = require('../db/report');
const { REPORT_CATEGORIES, DEFAULT_CATEGORY } = require('../utils/reportCategories');
const { submitReport } = require('../utils/reportService');
const { infoPayload, noticePayload } = require('../utils/infoCard');
const { categoryLabel } = require('../utils/reportCategories');
const { COLORS } = require('../utils/colors');

const MESSAGE_MODAL_PREFIX = 'rp_msg::';
const USER_MODAL_PREFIX = 'rp_usr::';

/**
 * The form shared by "Report Message" and "Report User": what kind of problem it is, optional context, and the
 * ping and anonymous switches the server has turned on.
 */
function buildReportModal({ customId, title, intro, config }) {
  const contextInput = new TextInputBuilder()
    .setCustomId('context')
    .setPlaceholder('Why are you reporting this?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(config.require_reason === true)
    .setMaxLength(500);

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(intro))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('What is happening?')
        .setDescription('Pick the closest match so staff can act faster.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('report_category')
            .setPlaceholder('Choose a category')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(REPORT_CATEGORIES.map((category) => ({ label: category.label, value: category.value, description: category.description, default: category.value === DEFAULT_CATEGORY }))),
        ),
      new LabelBuilder()
        .setLabel('Additional Context')
        .setDescription(config.require_reason ? 'Required by this server' : 'Anything the moderators should know (optional)')
        .setTextInputComponent(contextInput),
    );

  const extras = [];
  if (config.urgent_role_id) {
    extras.push(new LabelBuilder().setLabel('Ping Moderators').setDescription('Urgently notify the mod role (use wisely)').setCheckboxComponent(new CheckboxBuilder().setCustomId('report_ping')));
  }
  if (config.anonymous_reporting_enabled) {
    extras.push(new LabelBuilder().setLabel('Report Anonymously').setDescription('Your name won’t be shown in the report').setCheckboxComponent(new CheckboxBuilder().setCustomId('report_anonymous')));
  }
  if (extras.length) modal.addLabelComponents(...extras);
  return modal;
}

/** Confirmation shown only to the reporter. */
function buildReceipt(result, config) {
  const { report } = result;
  return {
    ...infoPayload({
      accent: COLORS.GREEN,
      title: `Report #${report.report_number} sent`,
      subtitle: [`${categoryLabel(report.category)} · the staff team will review it.`],
      sections: [
        {
          lines: [
            config.notify_reporter === false ? null : 'You will get a DM when staff close this report, if your DMs are open.',
            report.anonymous ? 'Your name is hidden from the report.' : null,
          ],
        },
      ],
      footer: 'Thank you for helping keep the server safe.',
    }),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

function refusal(message) {
  return { ...noticePayload(message, COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

/**
 * The ping and anonymous checkboxes only exist in the form when the server has those options turned on, and fields
 * reads throw for a field that is not there, so a missing checkbox means "not ticked".
 */
function readOptionalCheckbox(fields, customId) {
  try {
    return fields.getCheckbox(customId) === true;
  } catch {
    return false;
  }
}

/** Handles the submitted form (customId `rp_msg::<messageId>` or `rp_usr::<userId>`). */
async function handleModal(interaction) {
  const isMessage = interaction.customId.startsWith(MESSAGE_MODAL_PREFIX);
  const targetId = interaction.customId.slice((isMessage ? MESSAGE_MODAL_PREFIX : USER_MODAL_PREFIX).length);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

  const config = await getConfig(interaction.guild.id).catch(() => null);
  if (!config?.enabled || !config.channel_id) {
    await interaction.editReply(noticePayload('Reports are not set up on this server yet.', COLORS.RED));
    return;
  }

  let message = null;
  let reportedUser;
  if (isMessage) {
    message = await interaction.channel.messages.fetch(targetId).catch(() => null);
    if (!message) {
      await interaction.editReply(noticePayload('That message is no longer available to report.', COLORS.RED));
      return;
    }
    reportedUser = message.author;
  } else {
    reportedUser = await interaction.client.users.fetch(targetId).catch(() => null);
    if (!reportedUser) {
      await interaction.editReply(noticePayload('That user could not be found.', COLORS.RED));
      return;
    }
  }

  const category = interaction.fields.getStringSelectValues('report_category')?.[0] ?? DEFAULT_CATEGORY;
  const result = await submitReport({
    guild: interaction.guild,
    reporter: interaction.user,
    reportedUser,
    category,
    reason: interaction.fields.getTextInputValue('context'),
    sourceChannel: interaction.channel,
    message,
    urgent: readOptionalCheckbox(interaction.fields, 'report_ping'),
    anonymous: readOptionalCheckbox(interaction.fields, 'report_anonymous'),
  });

  await interaction.editReply(result.ok ? buildReceipt(result, config) : noticePayload(result.message, COLORS.RED));
}

module.exports = { MESSAGE_MODAL_PREFIX, USER_MODAL_PREFIX, buildReportModal, buildReceipt, handleModal, readOptionalCheckbox };

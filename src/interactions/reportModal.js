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
const { DEFAULT_CATEGORY, categoryLabel, categoryOptions } = require('../utils/reportCategories');
const { submitReport } = require('../utils/reportService');
const { infoPayload, noticePayload } = require('../utils/infoCard');
const { COLORS } = require('../utils/colors');
const { t, languageOf, currentLanguage } = require('../i18n');

const MESSAGE_MODAL_PREFIX = 'rp_msg::';
const USER_MODAL_PREFIX = 'rp_usr::';

/**
 * The form shared by "Report Message" and "Report User": what kind of problem it is, optional context, and the
 * ping and anonymous switches the server has turned on.
 */
function buildReportModal({ customId, title, intro, config, lang = currentLanguage() }) {
  const contextInput = new TextInputBuilder()
    .setCustomId('context')
    .setPlaceholder(t(lang, 'reports.form.contextPlaceholder'))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(config.require_reason === true)
    .setMaxLength(500);

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(intro))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(t(lang, 'reports.form.categoryLabel'))
        .setDescription(t(lang, 'reports.form.categoryHelp'))
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('report_category')
            .setPlaceholder(t(lang, 'reports.form.category.menu'))
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(categoryOptions(lang).map((category) => ({ ...category, default: category.value === DEFAULT_CATEGORY }))),
        ),
      new LabelBuilder()
        .setLabel(t(lang, 'reports.form.contextLabel'))
        .setDescription(t(lang, config.require_reason ? 'reports.form.contextRequired' : 'reports.form.contextOptional'))
        .setTextInputComponent(contextInput),
    );

  const extras = [];
  if (config.urgent_role_id) {
    extras.push(new LabelBuilder().setLabel(t(lang, 'reports.form.pingLabel')).setDescription(t(lang, 'reports.form.pingHelp')).setCheckboxComponent(new CheckboxBuilder().setCustomId('report_ping')));
  }
  if (config.anonymous_reporting_enabled) {
    extras.push(new LabelBuilder().setLabel(t(lang, 'reports.form.anonymousLabel')).setDescription(t(lang, 'reports.form.anonymousHelp')).setCheckboxComponent(new CheckboxBuilder().setCustomId('report_anonymous')));
  }
  if (extras.length) modal.addLabelComponents(...extras);
  return modal;
}

/** Confirmation shown only to the reporter. */
function buildReceipt(result, config, lang = currentLanguage()) {
  const { report } = result;
  return {
    ...infoPayload({
      accent: COLORS.GREEN,
      title: t(lang, 'reports.receipt.title', { number: report.report_number }),
      subtitle: [t(lang, 'reports.receipt.subtitle', { category: categoryLabel(report.category, lang) })],
      sections: [
        {
          lines: [
            config.notify_reporter === false ? null : t(lang, 'reports.receipt.dmNotice'),
            report.anonymous ? t(lang, 'reports.receipt.anonymous') : null,
          ],
        },
      ],
      footer: t(lang, 'reports.dm.thanks'),
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
  const lang = await languageOf(interaction);
  const isMessage = interaction.customId.startsWith(MESSAGE_MODAL_PREFIX);
  const targetId = interaction.customId.slice((isMessage ? MESSAGE_MODAL_PREFIX : USER_MODAL_PREFIX).length);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

  const config = await getConfig(interaction.guild.id).catch(() => null);
  if (!config?.enabled || !config.channel_id) {
    await interaction.editReply(noticePayload(t(lang, 'reports.send.notSetUp'), COLORS.RED));
    return;
  }

  let message = null;
  let reportedUser;
  if (isMessage) {
    message = await interaction.channel.messages.fetch(targetId).catch(() => null);
    if (!message) {
      await interaction.editReply(noticePayload(t(lang, 'reports.form.messageGone'), COLORS.RED));
      return;
    }
    reportedUser = message.author;
  } else {
    reportedUser = await interaction.client.users.fetch(targetId).catch(() => null);
    if (!reportedUser) {
      await interaction.editReply(noticePayload(t(lang, 'reports.form.userGone'), COLORS.RED));
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
    lang,
  });

  await interaction.editReply(result.ok ? buildReceipt(result, config, lang) : noticePayload(result.message, COLORS.RED));
}

module.exports = { MESSAGE_MODAL_PREFIX, USER_MODAL_PREFIX, buildReportModal, buildReceipt, handleModal, readOptionalCheckbox };

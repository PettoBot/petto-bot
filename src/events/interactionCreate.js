const { isPermissionError, permissionHelp } = require('../utils/permissionErrors');
const { isPayloadError, sendWithPlainFallback } = require('../utils/payloadFallback');
const { Events, MessageFlags } = require('discord.js');
const { getRemainingCooldownShared } = require('../utils/sharedCooldown');
const moderationPermissions = require('../utils/moderationPermissions');
const { handleButton: handleEmbedPanelButton, handleModal: handleEmbedPanelModal } = require('../interactions/embedPanel');
const { handleModal: handleReportModal } = require('../interactions/reportModal');
const { handleModal: handleReportConfigModal } = require('../interactions/reportConfigModal');
const { handleButton: handleReportActionButton, handleReasonModal: handleReportReasonModal, handleListButton: handleReportListButton } = require('../interactions/reportActions');
const { CONFIG_PREFIX: REPORT_CONFIG_PREFIX, LIMITS_MODAL_ID: REPORT_LIMITS_MODAL_ID, handleConfigComponent: handleReportConfigComponent, handleLimitsModal: handleReportLimitsModal } = require('../interactions/reportConfigPanel');
const { handleButton: handleTicketPanelButton, handleSelect: handleTicketPanelSelect } = require('../interactions/ticketPanel');
const { handleModal: handleTicketFormModal } = require('../interactions/ticketForm');
const { handleButton: handleTicketSetupButton, handleSelect: handleTicketSetupSelect, handleModal: handleTicketSetupModal } = require('../interactions/ticketSetupWizard');
const { handleButton: handleTicketFormPanelButton, handleModal: handleTicketFormPanelModal } = require('../interactions/ticketFormPanel');
const {
  handleButton: handleTicketControlButton,
  handleCloseModal: handleTicketCloseModal,
  handleUserSelect: handleTicketUserSelect,
  handleRatingButton: handleTicketRatingButton,
  handleRatingModal: handleTicketRatingModal,
} = require('../interactions/ticketControls');
const { handleButton: handleGiveawayButton } = require('../interactions/giveawayButton');
const { handleButton: handleTicketAiButton } = require('../interactions/ticketAi');
const { HUMAN_BUTTON: TICKET_AI_BUTTON } = require('../utils/ticketAiFlow');
const { handlePager, isPagerId } = require('../utils/pager');
const { handlePaginationInteraction } = require('../interactions/pagination');
const { isPaginationId } = require('../utils/pagination');
const { handleButton: handlePollButton } = require('../interactions/pollButton');
const { handleButton: handlePollPanelButton, handleModal: handlePollPanelModal } = require('../interactions/pollPanel');
const { HONEYPOT_COUNT_BUTTON_ID, handleButton: handleHoneypotButton } = require('../interactions/honeypot');
const { ROLEPLAY_BUTTON_PREFIX, handleButton: handleRoleplayButton } = require('../interactions/roleplay');
const { handleSelect: handleBackupSelect, handleScheduleModal, handleRestoreModal, handleRestoreButton, handleRestoreCodeModal, handleDeleteModal, handleDeleteButton } = require('../interactions/backup');
const { STEAL_PREFIX: JUMBO_PREFIX, handleButton: handleJumboButton } = require('../interactions/jumbo');
const { VERSION_SELECT_ID, handleButton: handleVersionButton, handleSelect: handleVersionSelect } = require('../interactions/version');
const { handleButton: handleVoiceMasterButton, handleModal: handleVoiceMasterModal, handleSelect: handleVoiceMasterSelect } = require('../interactions/voiceMaster');
const { SELECT_ID: QUEST_SELECT_ID, PAGE_ID: QUEST_PAGE_ID, handleSelect: handleQuestSelect, handleButton: handleQuestButton } = require('../interactions/quests');
const { COMPONENT_PREFIX: CODE_COMMAND_PREFIX, handleComponent: handleCodeCommandComponent } = require('../interactions/codeCommands');
const { BUTTON_PREFIX: RESPONDER_BUTTON_PREFIX, SELECT_PREFIX: RESPONDER_SELECT_PREFIX } = require('../utils/responderEngine');
const { handleButton: handleResponderButton, handleSelect: handleResponderSelect } = require('../interactions/responders');
const { PREFIX: REQUEST_PREFIX } = require('../utils/requestCards');
const { handleButton: handleRequestButton } = require('../interactions/requests');
const { PREFIX: SCAM_PREFIX, handleButton: handleScamButton } = require('../utils/antiScam');
const { PREFIX: STATS_PREFIX, handleButton: handleStatsButton } = require('../interactions/stats');
const { PREFIX: MUSIC_PREFIX, handleButton: handleMusicButton } = require('../interactions/music');
const { PREFIX: ANTINUKE_PREFIX, handleButton: handleAntiNukeButton } = require('../interactions/antiNuke');
const { PREFIX: APPEAL_PREFIX, handleButton: handleAppealButton, handleModal: handleAppealModal } = require('../interactions/appeals');
const { PREFIX: CONFESSION_PREFIX, handleButton: handleConfessionButton, handleModal: handleConfessionModal } = require('../interactions/confessions');
const { PREFIX: FORM_PREFIX, handleFormInteraction } = require('../interactions/forms');
const { PREFIX: SUGGESTION_PREFIX, handleButton: handleSuggestionButton, handleModal: handleSuggestionModal } = require('../interactions/suggestions');
const { PREFIX: VERIFY_LETTERS_PREFIX, handleButton: handleVerifyLettersButton, handleModal: handleVerifyLettersModal } = require('../interactions/verifyLetters');
const { handleSetupModal } = require('../interactions/setup');
const { SETUP_BUTTON_PREFIX, handleSetupButton } = require('../interactions/setupPanel');
const { maybeHintLanguage } = require('../utils/languageHint');
const { PREFIX: LANGUAGE_CHOICE_PREFIX, handleButton: handleLanguageChoice } = require('../interactions/languageChoice');
const { BUTTON_PREFIX, handleButton: handleReactionRoleButton } = require('../interactions/reactionRoleButton');
const permissionsDb = require('../db/permissions');
const commandRules = require('../utils/commandRules');
const disabledCommandsDb = require('../db/disabledCommands');
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');
const { logCommandUse } = require('../logging/extraLog');
const { commandKey } = require('../handlers/commandHandler');
const { DISPLAY_BUTTON_PREFIX } = require('../utils/embedV2');
const { PREFIX: EMBED_BUTTON_PREFIX } = require('../utils/embedActions');
const { handleButton: handleEmbedButton } = require('../interactions/embedButtons');
const { PREFIX: FEED_SENSE_PREFIX, handleButton: handleFeedSense } = require('../interactions/feedSense');
const { t, formatDecimal, languageOf } = require('../i18n');

const DEFAULT_COOLDOWN_MS = 3000;

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith(CODE_COMMAND_PREFIX)) {
      try { await handleCodeCommandComponent(interaction); } catch (err) { logger.error('Error handling a custom command button or menu:', err); }
      return;
    }

    // The buttons of `!stats privacy` and the confirmation of `!statsconfig delete`.
    if (interaction.isButton() && interaction.customId.startsWith(`${STATS_PREFIX}:`)) {
      try { await handleStatsButton(interaction); } catch (err) { logger.error('Error handling a statistics button:', err); }
      return;
    }

    // The buttons of the music card.
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(`${MUSIC_PREFIX}:`)) {
      try { await handleMusicButton(interaction); } catch (err) { logger.error('Error handling a music button:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${SCAM_PREFIX}::`)) {
      await handleScamButton(interaction);
      return;
    }
    // The card of an appeal: accept, reject or reply, and the small forms those open.
    if (interaction.isButton() && interaction.customId.startsWith(`${APPEAL_PREFIX}::`)) {
      await handleAppealButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${APPEAL_PREFIX}::`)) {
      await handleAppealModal(interaction);
      return;
    }

    // Forms (applications): the panel that opens a form, its pages, and the buttons of the review card.
    if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith(FORM_PREFIX)) {
      await handleFormInteraction(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${ANTINUKE_PREFIX}::`)) {
      await handleAntiNukeButton(interaction);
      return;
    }

    // The letters check of verification, inside Discord (the buttons and the form of the verification DM).
    if (interaction.isButton() && interaction.customId.startsWith(`${CONFESSION_PREFIX}:`)) {
      await handleConfessionButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${CONFESSION_PREFIX}:`)) {
      await handleConfessionModal(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${SUGGESTION_PREFIX}:`)) {
      await handleSuggestionButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${SUGGESTION_PREFIX}:`)) {
      await handleSuggestionModal(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${VERIFY_LETTERS_PREFIX}:`)) {
      try { await handleVerifyLettersButton(interaction); } catch (err) { logger.error('Error handling a verification button:', err); }
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${VERIFY_LETTERS_PREFIX}:`)) {
      try { await handleVerifyLettersModal(interaction); } catch (err) { logger.error('Error handling the verification form:', err); }
      return;
    }

    // A button that only shows something (a change in a rollout card): answered with nothing.
    if (interaction.isButton() && interaction.customId.startsWith(`${DISPLAY_BUTTON_PREFIX}:`)) {
      try { await interaction.deferUpdate(); } catch { /* it expired */ }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(REQUEST_PREFIX)) {
      try { await handleRequestButton(interaction); } catch (err) { logger.error('Error handling a request button:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(FEED_SENSE_PREFIX)) {
      try { await handleFeedSense(interaction); } catch (err) { logger.error('Error handling the meaning of a word of a feed:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(EMBED_BUTTON_PREFIX)) {
      try { await handleEmbedButton(interaction); } catch (err) { logger.error('Error handling a button of an embed code:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(RESPONDER_BUTTON_PREFIX)) {
      try { await handleResponderButton(interaction); } catch (err) { logger.error('Error handling a button responder:', err); }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(RESPONDER_SELECT_PREFIX)) {
      try { await handleResponderSelect(interaction); } catch (err) { logger.error('Error handling a panel menu:', err); }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'petto_setup_modal') {
      try { await handleSetupModal(interaction); } catch (err) { logger.error('Error handling Petto setup modal:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(SETUP_BUTTON_PREFIX)) {
      try { await handleSetupButton(interaction); } catch (err) { logger.error('Error handling Petto setup button:', err); }
      return;
    }

    // The language buttons of the setup message of a new server.
    if (interaction.isButton() && interaction.customId.startsWith(LANGUAGE_CHOICE_PREFIX)) {
      try { await handleLanguageChoice(interaction); } catch (err) { logger.error('Error handling the language button of the setup message:', err); }
      return;
    }

    if (interaction.isButton() && (interaction.customId.startsWith('vm:') || interaction.customId.startsWith('vc:'))) {
      try { await handleVoiceMasterButton(interaction); } catch (err) { logger.error('Error handling VoiceMaster button:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId === HONEYPOT_COUNT_BUTTON_ID) {
      try { await handleHoneypotButton(interaction); } catch (err) { logger.error('Error handling honeypot count button:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(ROLEPLAY_BUTTON_PREFIX)) {
      try { await handleRoleplayButton(interaction); } catch (err) { logger.error('Error handling roleplay response button:', err); }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('backup_menu:')) {
      try { await handleBackupSelect(interaction); } catch (err) { logger.error('Error handling backup menu:', err); }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === QUEST_SELECT_ID) {
      try { await handleQuestSelect(interaction); } catch (err) { logger.error('Error handling quest menu:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${QUEST_PAGE_ID}:`)) {
      try { await handleQuestButton(interaction); } catch (err) { logger.error('Error handling quest page button:', err); }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === VERSION_SELECT_ID) {
      try { await handleVersionSelect(interaction); } catch (err) { logger.error('Error handling version select:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${JUMBO_PREFIX}:`)) {
      try { await handleJumboButton(interaction); } catch (err) { logger.error('Error handling the jumbo steal button:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('version:')) {
      try { await handleVersionButton(interaction); } catch (err) { logger.error('Error handling version button:', err); }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('backup_schedule_modal:')) {
      try { await handleScheduleModal(interaction); } catch (err) { logger.error('Error handling backup schedule modal:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('backup_delete:')) {
      try { await handleDeleteButton(interaction); } catch (err) { logger.error('Error handling backup delete button:', err); }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('backup_delete_modal:')) {
      try { await handleDeleteModal(interaction); } catch (err) { logger.error('Error handling backup delete modal:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('backup_restore:')) {
      try { await handleRestoreButton(interaction); } catch (err) { logger.error('Error handling backup restore button:', err); }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('backup_restore_code:')) {
      try { await handleRestoreCodeModal(interaction); } catch (err) { logger.error('Error handling backup restore check:', err); }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('backup_restore_modal:')) {
      try { await handleRestoreModal(interaction); } catch (err) { logger.error('Error handling backup restore modal:', err); }
      return;
    }

    if (interaction.isModalSubmit() && (interaction.customId.startsWith('vm_modal_') || interaction.customId.startsWith('vcm:'))) {
      try { await handleVoiceMasterModal(interaction); } catch (err) { logger.error('Error handling VoiceMaster modal:', err); }
      return;
    }

    if (interaction.isUserSelectMenu() && (interaction.customId.startsWith('vm_select:') || interaction.customId.startsWith('vc:do_'))) {
      try { await handleVoiceMasterSelect(interaction); } catch (err) { logger.error('Error handling VoiceMaster select:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('eb_')) {
      try {
        await handleEmbedPanelButton(interaction);
      } catch (err) {
        logger.error('Error handling embed panel button:', err);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('em_')) {
      try {
        await handleEmbedPanelModal(interaction);
      } catch (err) {
        logger.error('Error handling embed panel modal:', err);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('rpt:')) {
      try { await handleReportActionButton(interaction); } catch (err) { logger.error('Error handling report action button:', err); }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('rptr:')) {
      try { await handleReportReasonModal(interaction); } catch (err) { logger.error('Error handling report reason modal:', err); }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('rptl:')) {
      try { await handleReportListButton(interaction); } catch (err) { logger.error('Error handling report list button:', err); }
      return;
    }

    if ((interaction.isButton() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) && interaction.customId.startsWith(REPORT_CONFIG_PREFIX)) {
      try { await handleReportConfigComponent(interaction); } catch (err) { logger.error('Error handling report settings component:', err); }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === REPORT_LIMITS_MODAL_ID) {
      try { await handleReportLimitsModal(interaction); } catch (err) { logger.error('Error handling report limits modal:', err); }
      return;
    }

    if (interaction.isModalSubmit() && (interaction.customId.startsWith('rp_msg::') || interaction.customId.startsWith('rp_usr::'))) {
      try {
        await handleReportModal(interaction);
      } catch (err) {
        logger.error('Error handling report modal:', err);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'petto_report_config_modal') {
      try {
        await handleReportConfigModal(interaction);
      } catch (err) {
        logger.error('Error handling report config modal:', err);
      }
      return;
    }

    if ((interaction.isButton() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) && interaction.customId.startsWith('tfw_')) {
      try {
        if (interaction.isButton()) await handleTicketSetupButton(interaction);
        else await handleTicketSetupSelect(interaction);
      } catch (err) {
        logger.error('Error handling ticket setup:', err);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('tfwm_')) {
      try {
        await handleTicketSetupModal(interaction);
      } catch (err) {
        logger.error('Error handling ticket setup modal:', err);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('tf_')) {
      try {
        await handleTicketFormPanelButton(interaction);
      } catch (err) {
        logger.error('Error handling ticket form builder button:', err);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('tfm_')) {
      try {
        await handleTicketFormPanelModal(interaction);
      } catch (err) {
        logger.error('Error handling ticket form builder modal:', err);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('tk_open::')) {
      try {
        await handleTicketPanelButton(interaction);
      } catch (err) {
        logger.error('Error handling ticket panel button:', err);
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'tk_open_select') {
      try {
        await handleTicketPanelSelect(interaction);
      } catch (err) {
        logger.error('Error handling ticket panel select:', err);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('tk_form::')) {
      try {
        await handleTicketFormModal(interaction);
      } catch (err) {
        logger.error('Error handling ticket form modal:', err);
      }
      return;
    }

    // Rated from the closed-ticket DM, not the ticket channel itself, so it can't go through the
    // generic tk_* handler below (that one resolves the ticket by interaction.channel.id).
    if (interaction.isButton() && interaction.customId.startsWith('tk_rate::')) {
      try {
        await handleTicketRatingButton(interaction);
      } catch (err) {
        logger.error('Error handling ticket rating button:', err);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('tk_ratemodal::')) {
      try {
        await handleTicketRatingModal(interaction);
      } catch (err) {
        logger.error('Error handling ticket rating modal:', err);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('tk_')) {
      try {
        await handleTicketControlButton(interaction);
      } catch (err) {
        logger.error('Error handling ticket control button:', err);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('tk_closemodal::')) {
      try {
        await handleTicketCloseModal(interaction);
      } catch (err) {
        logger.error('Error handling ticket close modal:', err);
      }
      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('tk_')) {
      try {
        await handleTicketUserSelect(interaction);
      } catch (err) {
        logger.error('Error handling ticket user select:', err);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('gw_')) {
      try {
        await handleGiveawayButton(interaction);
      } catch (err) {
        logger.error('Error handling giveaway button:', err);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(BUTTON_PREFIX)) {
      try {
        await handleReactionRoleButton(interaction);
      } catch (err) {
        logger.error('Error handling reaction role button:', err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: t(await languageOf(interaction), 'core.reactionRoleError'), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
        }
      }
      return;
    }

    // Paginated messages (`!pagination`): anyone turns the pages, and the reset confirmation.
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && isPaginationId(interaction.customId)) {
      await handlePaginationInteraction(interaction);
      return;
    }

    if ((interaction.isButton() || interaction.isStringSelectMenu()) && isPagerId(interaction.customId)) {
      try {
        await handlePager(interaction);
      } catch (err) {
        logger.error('Error handling list page:', err);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: t(await languageOf(interaction), 'core.pagerError'), flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return;
    }

    if (interaction.isButton() && interaction.customId === TICKET_AI_BUTTON) {
      try {
        await handleTicketAiButton(interaction);
      } catch (err) {
        logger.error('Error handling the ticket AI button:', err);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('plv_')) {
      try {
        await handlePollButton(interaction);
      } catch (err) {
        logger.error('Error handling poll button:', err);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('pl_')) {
      try {
        await handlePollPanelButton(interaction);
      } catch (err) {
        logger.error('Error handling poll panel button:', err);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('plm_')) {
      try {
        await handlePollPanelModal(interaction);
      } catch (err) {
        logger.error('Error handling poll panel modal:', err);
      }
      return;
    }

    // The list that Discord shows under an option while it is typed: the command that has one fills it, and the rest do nothing.
    if (interaction.isAutocomplete()) {
      const target = client.commands.get(commandKey(interaction.commandName, interaction.commandType ?? 1));
      if (typeof target?.autocomplete !== 'function') return;
      try { await target.autocomplete(interaction); } catch (err) {
        logger.warn(`The list of an option of ${interaction.commandName} could not be made: ${err.message}`);
        await interaction.respond([]).catch(() => {});
      }
      return;
    }

    if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand() && !interaction.isUserContextMenuCommand()) return;

    const command = client.commands.get(commandKey(interaction.commandName, interaction.commandType));
    if (!command) {
      logger.warn(`Received unknown command: /${interaction.commandName}`);
      return;
    }

    const lang = await languageOf(interaction);
    const cooldownMs = command.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const remaining = await getRemainingCooldownShared(command.data.name, interaction.user.id, cooldownMs);
    if (remaining > 0) {
      // Spanish and Portuguese name the prefix form when the command has one (only slash-only commands and menus do not).
      const prefixForm = !command.slashOnly && (command.data.toJSON().type ?? 1) === 1;
      await interaction.reply({
        content: t(lang, prefixForm ? 'core.slash.cooldown' : 'core.slash.cooldownSlashOnly', { seconds: formatDecimal(lang, remaining / 1000), command: command.data.name }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.guildId && interaction.member) {
      try {
        const allowed = await permissionsDb.hasCommandPermission(interaction.guildId, command.data.name, interaction.member);
        if (!allowed) {
          await interaction.reply({ content: t(lang, 'core.slash.missingLevel'), flags: MessageFlags.Ephemeral });
          return;
        }
      } catch (err) {
        // Custom permission levels are opt-in on top of Discord's own permissions, if the check
        // itself fails (DB hiccup) let the command through rather than break it for everyone.
        logger.error('Error checking custom command permission level:', err);
      }
    }

    // The rules of a server are the same ones the prefix checks (utils/commandRules.js): an action of /act (`hug`) or the whole command
    // (`act`) can be restricted or turned off.
    const ruleNames = commandRules.ruleNames(command, { subcommand: interaction.options?.getSubcommand?.(false) ?? null });
    // !restrictcommand: only the roles chosen for this command (administrators always can).
    if (interaction.guildId && interaction.member) {
      const restricted = await commandRules.restrictedForNames(interaction.guildId, ruleNames, interaction.member).catch(() => null);
      if (restricted) {
        await interaction.reply({ content: t(lang, 'core.restricted', { command: restricted.name, roles: restricted.roles.map((id) => `<@&${id}>`).join(', ') }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        return;
      }
    }

    // The same rules as !disablecommand: a command switched off for the server or this channel does not run as a slash command either.
    if (interaction.guildId && interaction.channelId) {
      const found = await commandRules.disabledFor(interaction.guildId, ruleNames, interaction.channelId, disabledCommandsDb);
      if (found) {
        const disabled = found.row;
        // `/act love hug` when the rule is for the action, `/act` when it is for the whole command.
        const shown = found.name === command.data.name ? `/${command.data.name}` : `/${[command.data.name, interaction.options.getSubcommandGroup?.(false), found.name].filter(Boolean).join(' ')}`;
        const text = disabled.channel_id
          ? t(lang, 'core.disabled.channel', { emoji: EMOJI.WARNING, command: shown, channel: `<#${disabled.channel_id}>` })
          : t(lang, 'core.disabled.server', { emoji: EMOJI.WARNING, command: shown });
        // A private card with no colored side bar, the same look as the prefix notice.
        await interaction.reply({ components: [textCard(text, null)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
        return;
      }
    }

    logCommandUse({ guild: interaction.guild, user: interaction.user, channel: interaction.channel, name: interaction.commandName, prefix: '/', subcommand: interaction.options?.getSubcommand?.(false) ?? null }, client);

    interaction.pettoLang = lang;
    // A member with a role chosen for this moderation command passes its permission check, the same as with the prefix (Discord only
    // shows the command to them when the server allows it in Integrations).
    if (command.category === 'moderation' && interaction.guildId && interaction.member) {
      interaction.pettoModerationRoleAllowed = await moderationPermissions.hasConfiguredRole(interaction.guildId, command.data.name, interaction.member).catch(() => false);
    }
    try {
      await command.execute(interaction, client);
      // Once, for a server whose language Petto only detected: the first administrator whose Discord is in another language hears about `!language`.
      if (interaction.isChatInputCommand()) maybeHintLanguage(interaction);
    } catch (err) {
      if (err?.code === 40060) {
        logger.warn(`Ignored duplicate acknowledgement for /${interaction.commandName}. Another handler or bot instance already responded.`);
        return;
      }
      if (isPermissionError(err)) logger.warn(`Missing permission running /${interaction.commandName}: ${err.message} (code ${err.code})`);
      else logger.error(`Error executing /${interaction.commandName}:`, err);

      const errorReply = { content: isPermissionError(err) ? permissionHelp(err, lang) : isPayloadError(err) ? t(lang, 'core.replyTooLong') : t(lang, 'core.error'), flags: MessageFlags.Ephemeral };
      // If Discord refuses the error card itself for what it is made of (a deferred answer in Components V2 does not take `content`), a short text is sent once.
      const send = (payload) => (interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload));
      await sendWithPlainFallback(send, errorReply, { lang, context: `/${interaction.commandName}` }).catch(() => {});
    }
  },
};

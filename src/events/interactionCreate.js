const { Events, MessageFlags } = require('discord.js');
const { getRemainingCooldown } = require('../utils/cooldown');
const { handleButton: handleEmbedPanelButton, handleModal: handleEmbedPanelModal } = require('../interactions/embedPanel');
const { handleModal: handleReportModal } = require('../interactions/reportModal');
const { handleButton: handleTicketPanelButton, handleSelect: handleTicketPanelSelect } = require('../interactions/ticketPanel');
const { handleModal: handleTicketFormModal } = require('../interactions/ticketForm');
const {
  handleButton: handleTicketControlButton,
  handleCloseModal: handleTicketCloseModal,
  handleUserSelect: handleTicketUserSelect,
  handleRatingButton: handleTicketRatingButton,
  handleRatingModal: handleTicketRatingModal,
} = require('../interactions/ticketControls');
const { handleButton: handleGiveawayButton } = require('../interactions/giveawayButton');
const { handleButton: handlePollButton } = require('../interactions/pollButton');
const { handleButton: handlePollPanelButton, handleModal: handlePollPanelModal } = require('../interactions/pollPanel');
const { handleButton: handleVoiceMasterButton, handleModal: handleVoiceMasterModal, handleSelect: handleVoiceMasterSelect } = require('../interactions/voiceMaster');
const { BUTTON_PREFIX, handleButton: handleReactionRoleButton } = require('../interactions/reactionRoleButton');
const permissionsDb = require('../db/permissions');
const logger = require('../utils/logger');

const DEFAULT_COOLDOWN_MS = 3000;

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (interaction.isButton() && (interaction.customId.startsWith('vm:') || interaction.customId.startsWith('vc:'))) {
      try { await handleVoiceMasterButton(interaction); } catch (err) { logger.error('Error handling VoiceMaster button:', err); }
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith('rp_msg::')) {
      try {
        await handleReportModal(interaction);
      } catch (err) {
        logger.error('Error handling report modal:', err);
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
          await interaction.reply({ content: 'Something went wrong while updating that role.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
        }
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

    if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`Received unknown command: /${interaction.commandName}`);
      return;
    }

    const cooldownMs = command.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const remaining = getRemainingCooldown(command.data.name, interaction.user.id, cooldownMs);
    if (remaining > 0) {
      await interaction.reply({
        content: `Please wait ${(remaining / 1000).toFixed(1)}s before using /${command.data.name} again.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.guildId && interaction.member) {
      try {
        const allowed = await permissionsDb.hasCommandPermission(interaction.guildId, command.data.name, interaction.member);
        if (!allowed) {
          await interaction.reply({ content: "You don't have the required permission level to use this command.", flags: MessageFlags.Ephemeral });
          return;
        }
      } catch (err) {
        // Custom permission levels are opt-in on top of Discord's own permissions, if the check
        // itself fails (DB hiccup) let the command through rather than break it for everyone.
        logger.error('Error checking custom command permission level:', err);
      }
    }

    try {
      await command.execute(interaction, client);
    } catch (err) {
      logger.error(`Error executing /${interaction.commandName}:`, err);

      const errorReply = { content: 'Something went wrong while running that command.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorReply).catch(() => {});
      } else {
        await interaction.reply(errorReply).catch(() => {});
      }
    }
  },
};

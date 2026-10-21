const { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, UserSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db/tickets');
const settingsDb = require('../db/ticketSettings');
const actions = require('../utils/ticketActions');
const { buildTranscriptLinkRow, componentsAfterRating, starsText } = require('../utils/ticketCards');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');
const { t, languageOf, guildLanguage } = require('../i18n');

async function loadTicketContext(interaction, lang) {
  const ticket = await db.getTicketByChannel(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({ content: t(lang, 'tickets.gone'), flags: MessageFlags.Ephemeral });
    return null;
  }
  const category = (await db.getCategoryById(ticket.category_id)) ?? { support_role_ids: [] };
  return { ticket, category };
}

async function requireStaff(interaction, category, ticket, lang) {
  const settings = await settingsDb.getSettings(interaction.guild.id);
  if (actions.isStaffAllowedForTicket(interaction.member, category, ticket, settings)) return true;
  if (settings.claim_mode === 'exclusive' && ticket?.claimed_by && ticket.claimed_by !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: t(lang, 'tickets.exclusiveClaim', { user: ticket.claimed_by }), flags: MessageFlags.Ephemeral });
    return false;
  }
  await interaction.reply({ content: t(lang, 'tickets.staffOnlyTicket'), flags: MessageFlags.Ephemeral });
  return false;
}

async function requireOpenerOrStaff(interaction, ticket, category, lang) {
  if (interaction.user.id === ticket.opener_id) return true;
  if (await requireStaff(interaction, category, ticket, lang)) return true;
  return false;
}

/** Same as requireOpenerOrStaff, except when the server's "close requires support role" setting is on, in which case the opener alone isn't enough. */
async function requireCloseAllowed(interaction, ticket, category, lang) {
  const isStaff = actions.isStaffForCategory(interaction.member, category);
  if (isStaff) return requireStaff(interaction, category, ticket, lang);

  const settings = await settingsDb.getSettings(interaction.guild.id);
  if (settings.close_requires_support_role) {
    await interaction.reply({ content: t(lang, 'tickets.staffOnlyClose'), flags: MessageFlags.Ephemeral });
    return false;
  }
  if (interaction.user.id === ticket.opener_id) return true;

  await interaction.reply({ content: t(lang, 'tickets.openerOrStaffOnly'), flags: MessageFlags.Ephemeral });
  return false;
}

/** All ticket-control button clicks — customId `tk_<action>::<ticketId>` (except tk_open, handled by ticketPanel.js). */
async function handleButton(interaction) {
  const [action, ticketId] = interaction.customId.split('::');
  const lang = await languageOf(interaction);
  const ctxData = await loadTicketContext(interaction, lang);
  if (!ctxData) return;
  const { ticket, category } = ctxData;

  if (String(ticket.id) !== ticketId) {
    await interaction.reply({ content: t(lang, 'tickets.buttonMismatch'), flags: MessageFlags.Ephemeral });
    return;
  }

  const ctx = { guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user };

  try {
    switch (action) {
      case 'tk_claim': {
        if (!(await requireStaff(interaction, category, ticket, lang))) return;
        if (ticket.claimed_by) {
          await interaction.reply({ content: t(lang, 'tickets.alreadyClaimed', { user: ticket.claimed_by }), flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await actions.claimTicket(ctx); // posts the claim notice in the ticket
        await interaction.editReply({ content: t(lang, 'tickets.claim.youClaimed', { emoji: EMOJI.STAR }) });
        return;
      }

      case 'tk_closeyes':
      case 'tk_closeno': {
        if (interaction.user.id !== ticket.opener_id) {
          await interaction.reply({ content: t(lang, 'tickets.requestClose.openerOnly'), flags: MessageFlags.Ephemeral });
          return;
        }
        if (ticket.status === 'closed') {
          await interaction.update({ components: [] });
          return;
        }
        if (action === 'tk_closeno') {
          await interaction.update({ content: `${interaction.message.content}\n\n${t(lang, 'tickets.requestClose.keptOpen', { emoji: EMOJI.DENY, user: interaction.user.id })}`, components: [], allowedMentions: { parse: [] } });
          return;
        }
        await interaction.update({ content: `${interaction.message.content}\n\n${t(lang, 'tickets.requestClose.agreed', { emoji: EMOJI.APPROVE, user: interaction.user.id })}`, components: [], allowedMentions: { parse: [] } });
        await actions.closeTicket({ ...ctx, reason: t(lang, 'tickets.requestClose.reason') });
        return;
      }

      case 'tk_unclaim': {
        if (!(await requireStaff(interaction, category, ticket, lang))) return;
        await actions.unclaimTicket(ctx);
        await interaction.reply({ content: t(lang, 'tickets.claim.released'), flags: MessageFlags.Ephemeral });
        return;
      }

      case 'tk_close': {
        if (!(await requireCloseAllowed(interaction, ticket, category, lang))) return;
        if (ticket.status === 'closed') {
          await interaction.reply({ content: t(lang, 'tickets.alreadyClosed'), flags: MessageFlags.Ephemeral });
          return;
        }
        const settings = await settingsDb.getSettings(interaction.guild.id);
        const modal = new ModalBuilder()
          .setCustomId(`tk_closemodal::${ticket.id}`)
          .setTitle(t(lang, 'tickets.closeModal.title'))
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('reason')
                .setLabel(t(lang, settings.close_requires_reason ? 'tickets.closeModal.reasonRequired' : 'tickets.closeModal.reasonOptional'))
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(settings.close_requires_reason)
                .setMaxLength(500),
            ),
          );
        await interaction.showModal(modal);
        return;
      }

      case 'tk_reopen': {
        if (!(await requireStaff(interaction, category, ticket, lang))) return;
        if (ticket.status !== 'closed') {
          await interaction.reply({ content: t(lang, 'tickets.notClosed'), flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferUpdate();
        await actions.reopenTicket(ctx);
        return;
      }

      case 'tk_delete': {
        if (!(await requireStaff(interaction, category, ticket, lang))) return;
        await interaction.reply({ content: t(lang, 'tickets.deleting', { emoji: EMOJI.HAMMER }) });
        await actions.deleteTicketChannel(ctx);
        return;
      }

      case 'tk_transcript': {
        if (!(await requireStaff(interaction, category, ticket, lang))) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { link } = await actions.postTranscript(ctx);
        const linkRow = buildTranscriptLinkRow(link, lang);
        await interaction.editReply({ content: t(lang, 'tickets.transcript.posted', { emoji: EMOJI.APPROVE }), components: linkRow ? [linkRow] : [] });
        return;
      }

      case 'tk_addmember': {
        if (!(await requireOpenerOrStaff(interaction, ticket, category, lang))) return;
        const select = new UserSelectMenuBuilder().setCustomId(`tk_addmember_select::${ticket.id}`).setPlaceholder(t(lang, 'tickets.addMember.placeholder.menu')).setMinValues(1).setMaxValues(1);
        await interaction.reply({ content: t(lang, 'tickets.addMember.question'), components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
        return;
      }

      case 'tk_removemember': {
        if (!(await requireOpenerOrStaff(interaction, ticket, category, lang))) return;
        const select = new UserSelectMenuBuilder().setCustomId(`tk_removemember_select::${ticket.id}`).setPlaceholder(t(lang, 'tickets.removeMember.placeholder.menu')).setMinValues(1).setMaxValues(1);
        await interaction.reply({ content: t(lang, 'tickets.removeMember.question'), components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
        return;
      }
    }
  } catch (err) {
    logger.error(`Ticket button "${action}" failed:`, err);
    const reply = { content: t(lang, 'tickets.actionFailed'), flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
}

/** Close-reason modal submit — customId `tk_closemodal::<ticketId>`. */
async function handleCloseModal(interaction) {
  const [, ticketId] = interaction.customId.split('::');
  const lang = await languageOf(interaction);
  const ctxData = await loadTicketContext(interaction, lang);
  if (!ctxData) return;
  const { ticket, category } = ctxData;
  if (String(ticket.id) !== ticketId) return;
  if (!(await requireCloseAllowed(interaction, ticket, category, lang))) return;

  const reason = interaction.fields.getTextInputValue('reason');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await actions.closeTicket({ guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user, reason });
    await interaction.editReply({ content: t(lang, 'tickets.closed', { emoji: EMOJI.DENY }) });
  } catch (err) {
    if (err.userFacing) {
      await interaction.editReply({ content: err.message });
      return;
    }
    logger.error('Ticket close (modal) failed:', err);
    await interaction.editReply({ content: t(lang, 'tickets.closeFailed') });
  }
}

function ratingDeps(deps = {}) {
  return {
    db: deps.db ?? db,
    ratingsDb: deps.ratingsDb ?? require('../db/ticketRatings'),
    settingsDb: deps.settingsDb ?? settingsDb,
    rateTicket: deps.rateTicket ?? actions.rateTicket,
    guildLanguage: deps.guildLanguage ?? guildLanguage,
    languageOf: deps.languageOf ?? languageOf,
  };
}

/** The ticket and language behind a rating click or modal, or null after answering why it cannot be rated. */
async function loadRatingContext(interaction, rating, d) {
  const [, ticketId] = interaction.customId.split('::');
  const ticket = await d.db.getTicketById(Number(ticketId));
  if (!ticket) {
    await interaction.reply({ content: t(await d.languageOf(interaction), 'tickets.gone'), flags: MessageFlags.Ephemeral });
    return null;
  }
  // Pressed in the member's DMs: answered in the language of the server the ticket belongs to.
  const lang = await d.guildLanguage(ticket.guild_id);
  if (interaction.user.id !== ticket.opener_id || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    await interaction.reply({ content: t(lang, 'tickets.rating.openerOnly'), flags: MessageFlags.Ephemeral });
    return null;
  }
  return { ticket, lang };
}

/**
 * The message with the rating buttons, updated in place: the buttons become the "thanks" card (or are disabled in an older message),
 * so they cannot be pressed again. Then a private line for the member. Works for a button and for the modal opened from it.
 */
async function finishRating(interaction, rating, { lang, already }) {
  const message = interaction.message;
  const content = t(lang, already ? 'tickets.rating.already' : 'tickets.rating.thanks', { stars: starsText(rating) });
  if (message?.components?.length && typeof interaction.update === 'function') {
    const v2 = Boolean(message.flags?.has?.(MessageFlags.IsComponentsV2));
    await interaction.update({ components: componentsAfterRating(message.components, rating, { v2, lang }) });
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/** Rating-button click on the closed-ticket DM — customId `tk_rate::<ticketId>::<1-5>`. Only the ticket's own opener can rate it, once. */
async function handleRatingButton(interaction, deps = {}) {
  const d = ratingDeps(deps);
  const rating = Number(interaction.customId.split('::')[2]);
  const context = await loadRatingContext(interaction, rating, d);
  if (!context) return;
  const { ticket, lang } = context;

  try {
    // Rated already (a second click, another device): the buttons go away and the member sees what they gave.
    const existing = await d.ratingsDb.getRating(ticket.id);
    if (existing) {
      await finishRating(interaction, existing.rating, { lang, already: true });
      return;
    }
    const guild = await interaction.client.guilds.fetch(ticket.guild_id).catch(() => null);
    if (!guild) {
      await interaction.reply({ content: t(lang, 'tickets.rating.failed'), flags: MessageFlags.Ephemeral });
      return;
    }
    const settings = await d.settingsDb.getSettings(ticket.guild_id);
    if (settings.rating_mode === 'rating_comment') {
      const modal = new ModalBuilder()
        .setCustomId(`tk_ratemodal::${ticket.id}::${rating}`)
        .setTitle(t(lang, 'tickets.rating.modalTitle'))
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('comment')
              .setLabel(t(lang, 'tickets.rating.commentLabel'))
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(500),
          ),
        );
      await interaction.showModal(modal);
      return;
    }
    const result = await d.rateTicket({ guild, client: interaction.client, ticket, user: interaction.user, rating });
    await finishRating(interaction, result?.rating?.rating ?? rating, { lang, already: result?.created === false });
  } catch (err) {
    logger.error('Ticket rating failed:', err);
    const payload = { content: t(lang, 'tickets.rating.failed'), flags: MessageFlags.Ephemeral };
    await (interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload)).catch(() => {});
  }
}

/** Optional-comment follow-up for the closed-ticket DM rating flow (the modal opened from a rating button). */
async function handleRatingModal(interaction, deps = {}) {
  const d = ratingDeps(deps);
  const rating = Number(interaction.customId.split('::')[2]);
  const context = await loadRatingContext(interaction, rating, d);
  if (!context) return;
  const { ticket, lang } = context;
  const guild = await interaction.client.guilds.fetch(ticket.guild_id).catch(() => null);
  if (!guild) {
    await interaction.reply({ content: t(lang, 'tickets.rating.failed'), flags: MessageFlags.Ephemeral });
    return;
  }
  const comment = interaction.fields.getTextInputValue('comment').trim() || null;
  try {
    const result = await d.rateTicket({ guild, client: interaction.client, ticket, user: interaction.user, rating, comment });
    await finishRating(interaction, result?.rating?.rating ?? rating, { lang, already: result?.created === false });
  } catch (err) {
    logger.error('Ticket rating with comment failed:', err);
    const payload = { content: t(lang, 'tickets.rating.feedbackFailed'), flags: MessageFlags.Ephemeral };
    await (interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload)).catch(() => {});
  }
}

/** Add/remove-member user-select follow-up — customId `tk_addmember_select::<ticketId>` / `tk_removemember_select::<ticketId>`. */
async function handleUserSelect(interaction) {
  const [action, ticketId] = interaction.customId.split('::');
  const lang = await languageOf(interaction);
  const ctxData = await loadTicketContext(interaction, lang);
  if (!ctxData) return;
  const { ticket, category } = ctxData;
  if (String(ticket.id) !== ticketId) return;
  if (!(await requireOpenerOrStaff(interaction, ticket, category, lang))) return;

  const targetUser = interaction.users.first();
  const ctx = { guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user, targetUser };

  try {
    if (action === 'tk_addmember_select') {
      await actions.addMember(ctx);
      await interaction.update({ content: t(lang, 'tickets.member.added', { emoji: EMOJI.APPROVE, user: `${targetUser}` }), components: [] });
    } else {
      await actions.removeMember(ctx);
      await interaction.update({ content: t(lang, 'tickets.member.removed', { emoji: EMOJI.APPROVE, user: `${targetUser}` }), components: [] });
    }
  } catch (err) {
    logger.error(`Ticket user-select "${action}" failed:`, err);
    await interaction.update({ content: t(lang, 'tickets.actionFailed'), components: [] }).catch(() => {});
  }
}

module.exports = { handleButton, handleCloseModal, handleUserSelect, handleRatingButton, handleRatingModal };

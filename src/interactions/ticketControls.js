const { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, UserSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db/tickets');
const settingsDb = require('../db/ticketSettings');
const actions = require('../utils/ticketActions');
const { buildTranscriptLinkRow } = require('../utils/ticketCards');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');

async function loadTicketContext(interaction) {
  const ticket = await db.getTicketByChannel(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({ content: 'This ticket no longer exists.', flags: MessageFlags.Ephemeral });
    return null;
  }
  const category = (await db.getCategoryById(ticket.category_id)) ?? { support_role_ids: [] };
  return { ticket, category };
}

async function requireStaff(interaction, category, ticket) {
  const settings = await settingsDb.getSettings(interaction.guild.id);
  if (actions.isStaffAllowedForTicket(interaction.member, category, ticket, settings)) return true;
  if (settings.claim_mode === 'exclusive' && ticket?.claimed_by && ticket.claimed_by !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: `This ticket is exclusively claimed by <@${ticket.claimed_by}>.`, flags: MessageFlags.Ephemeral });
    return false;
  }
  await interaction.reply({ content: 'Only staff for this ticket can do that.', flags: MessageFlags.Ephemeral });
  return false;
}

async function requireOpenerOrStaff(interaction, ticket, category) {
  if (interaction.user.id === ticket.opener_id) return true;
  if (await requireStaff(interaction, category, ticket)) return true;
  return false;
}

/** Same as requireOpenerOrStaff, except when the server's "close requires support role" setting is on, in which case the opener alone isn't enough. */
async function requireCloseAllowed(interaction, ticket, category) {
  const isStaff = actions.isStaffForCategory(interaction.member, category);
  if (isStaff) return requireStaff(interaction, category, ticket);

  const settings = await settingsDb.getSettings(interaction.guild.id);
  if (settings.close_requires_support_role) {
    await interaction.reply({ content: 'Only staff for this ticket can close it.', flags: MessageFlags.Ephemeral });
    return false;
  }
  if (interaction.user.id === ticket.opener_id) return true;

  await interaction.reply({ content: 'Only the ticket opener or staff can do that.', flags: MessageFlags.Ephemeral });
  return false;
}

/** All ticket-control button clicks — customId `tk_<action>::<ticketId>` (except tk_open, handled by ticketPanel.js). */
async function handleButton(interaction) {
  const [action, ticketId] = interaction.customId.split('::');
  const ctxData = await loadTicketContext(interaction);
  if (!ctxData) return;
  const { ticket, category } = ctxData;

  if (String(ticket.id) !== ticketId) {
    await interaction.reply({ content: 'This button no longer matches this ticket.', flags: MessageFlags.Ephemeral });
    return;
  }

  const ctx = { guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user };

  try {
    switch (action) {
      case 'tk_claim': {
        if (!(await requireStaff(interaction, category, ticket))) return;
        if (ticket.claimed_by) {
          await interaction.reply({ content: `Already claimed by <@${ticket.claimed_by}>.`, flags: MessageFlags.Ephemeral });
          return;
        }
        await actions.claimTicket(ctx);
        await interaction.reply({ content: `${EMOJI.STAR} <@${interaction.user.id}> claimed this ticket.` });
        return;
      }

      case 'tk_unclaim': {
        if (!(await requireStaff(interaction, category, ticket))) return;
        await actions.unclaimTicket(ctx);
        await interaction.reply({ content: 'Claim released.', flags: MessageFlags.Ephemeral });
        return;
      }

      case 'tk_close': {
        if (!(await requireCloseAllowed(interaction, ticket, category))) return;
        if (ticket.status === 'closed') {
          await interaction.reply({ content: 'This ticket is already closed.', flags: MessageFlags.Ephemeral });
          return;
        }
        const settings = await settingsDb.getSettings(interaction.guild.id);
        const modal = new ModalBuilder()
          .setCustomId(`tk_closemodal::${ticket.id}`)
          .setTitle('Close Ticket')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('reason')
                .setLabel(settings.close_requires_reason ? 'Reason (required)' : 'Reason (optional)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(settings.close_requires_reason)
                .setMaxLength(500),
            ),
          );
        await interaction.showModal(modal);
        return;
      }

      case 'tk_reopen': {
        if (!(await requireStaff(interaction, category, ticket))) return;
        if (ticket.status !== 'closed') {
          await interaction.reply({ content: 'This ticket is not closed.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferUpdate();
        await actions.reopenTicket(ctx);
        return;
      }

      case 'tk_delete': {
        if (!(await requireStaff(interaction, category, ticket))) return;
        await interaction.reply({ content: `${EMOJI.HAMMER} Deleting this channel...` });
        await actions.deleteTicketChannel(ctx);
        return;
      }

      case 'tk_transcript': {
        if (!(await requireStaff(interaction, category, ticket))) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { link } = await actions.postTranscript(ctx);
        const linkRow = buildTranscriptLinkRow(link);
        await interaction.editReply({ content: `${EMOJI.APPROVE} Transcript posted to the ticket log.`, components: linkRow ? [linkRow] : [] });
        return;
      }

      case 'tk_addmember': {
        if (!(await requireOpenerOrStaff(interaction, ticket, category))) return;
        const select = new UserSelectMenuBuilder().setCustomId(`tk_addmember_select::${ticket.id}`).setPlaceholder('Choose a member to add...').setMinValues(1).setMaxValues(1);
        await interaction.reply({ content: 'Who do you want to add?', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
        return;
      }

      case 'tk_removemember': {
        if (!(await requireOpenerOrStaff(interaction, ticket, category))) return;
        const select = new UserSelectMenuBuilder().setCustomId(`tk_removemember_select::${ticket.id}`).setPlaceholder('Choose a member to remove...').setMinValues(1).setMaxValues(1);
        await interaction.reply({ content: 'Who do you want to remove?', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
        return;
      }
    }
  } catch (err) {
    logger.error(`Ticket button "${action}" failed:`, err);
    const reply = { content: 'Something went wrong performing that action.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
}

/** Close-reason modal submit — customId `tk_closemodal::<ticketId>`. */
async function handleCloseModal(interaction) {
  const [, ticketId] = interaction.customId.split('::');
  const ctxData = await loadTicketContext(interaction);
  if (!ctxData) return;
  const { ticket, category } = ctxData;
  if (String(ticket.id) !== ticketId) return;
  if (!(await requireCloseAllowed(interaction, ticket, category))) return;

  const reason = interaction.fields.getTextInputValue('reason');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await actions.closeTicket({ guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user, reason });
    await interaction.editReply({ content: `${EMOJI.DENY} Ticket closed.` });
  } catch (err) {
    if (err.userFacing) {
      await interaction.editReply({ content: err.message });
      return;
    }
    logger.error('Ticket close (modal) failed:', err);
    await interaction.editReply({ content: 'Something went wrong closing this ticket.' });
  }
}

/** Rating-button click on the closed-ticket DM — customId `tk_rate::<ticketId>::<1-5>`. Only the ticket's own opener can rate it. */
async function handleRatingButton(interaction) {
  const [, ticketId, ratingRaw] = interaction.customId.split('::');
  const rating = Number(ratingRaw);
  const ticket = await db.getTicketById(Number(ticketId));
  if (!ticket) {
    await interaction.reply({ content: 'This ticket no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== ticket.opener_id || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    await interaction.reply({ content: "Only this ticket's opener can rate it.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guild = await interaction.client.guilds.fetch(ticket.guild_id).catch(() => null);
  if (!guild) {
    await interaction.reply({ content: 'Something went wrong recording your rating.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const settings = await settingsDb.getSettings(ticket.guild_id);
    if (settings.rating_mode === 'rating_comment') {
      const modal = new ModalBuilder()
        .setCustomId(`tk_ratemodal::${ticket.id}::${rating}`)
        .setTitle('Ticket feedback')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('comment')
              .setLabel('Optional comment')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(500),
          ),
        );
      await interaction.showModal(modal);
      return;
    }
    await actions.rateTicket({ guild, client: interaction.client, ticket, user: interaction.user, rating });
    // Not interaction.update(): the original DM is Components V2 (card + this row), which can't mix
    // with a plain `content` reply, easier to just send a fresh reply than rebuild the V2 tree minus this row.
    await interaction.reply({ content: `${'⭐'.repeat(rating)} Thanks for the feedback!`, flags: MessageFlags.Ephemeral });
  } catch (err) {
    logger.error('Ticket rating failed:', err);
    await interaction.reply({ content: 'Something went wrong recording your rating.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

/** Optional-comment follow-up for the closed-ticket DM rating flow. */
async function handleRatingModal(interaction) {
  const [, ticketId, ratingRaw] = interaction.customId.split('::');
  const rating = Number(ratingRaw);
  const ticket = await db.getTicketById(Number(ticketId));
  if (!ticket) {
    await interaction.reply({ content: 'This ticket no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== ticket.opener_id || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    await interaction.reply({ content: "Only this ticket's opener can rate it.", flags: MessageFlags.Ephemeral });
    return;
  }
  const guild = await interaction.client.guilds.fetch(ticket.guild_id).catch(() => null);
  if (!guild) {
    await interaction.reply({ content: 'Something went wrong recording your rating.', flags: MessageFlags.Ephemeral });
    return;
  }
  const comment = interaction.fields.getTextInputValue('comment').trim() || null;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await actions.rateTicket({ guild, client: interaction.client, ticket, user: interaction.user, rating, comment });
    await interaction.editReply({ content: `${'⭐'.repeat(rating)} Thanks for the feedback!` });
  } catch (err) {
    logger.error('Ticket rating with comment failed:', err);
    await interaction.editReply({ content: 'Something went wrong recording your feedback.' }).catch(() => {});
  }
}

/** Add/remove-member user-select follow-up — customId `tk_addmember_select::<ticketId>` / `tk_removemember_select::<ticketId>`. */
async function handleUserSelect(interaction) {
  const [action, ticketId] = interaction.customId.split('::');
  const ctxData = await loadTicketContext(interaction);
  if (!ctxData) return;
  const { ticket, category } = ctxData;
  if (String(ticket.id) !== ticketId) return;
  if (!(await requireOpenerOrStaff(interaction, ticket, category))) return;

  const targetUser = interaction.users.first();
  const ctx = { guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user, targetUser };

  try {
    if (action === 'tk_addmember_select') {
      await actions.addMember(ctx);
      await interaction.update({ content: `${EMOJI.APPROVE} Added ${targetUser} to this ticket.`, components: [] });
    } else {
      await actions.removeMember(ctx);
      await interaction.update({ content: `${EMOJI.APPROVE} Removed ${targetUser} from this ticket.`, components: [] });
    }
  } catch (err) {
    logger.error(`Ticket user-select "${action}" failed:`, err);
    await interaction.update({ content: 'Something went wrong performing that action.', components: [] }).catch(() => {});
  }
}

module.exports = { handleButton, handleCloseModal, handleUserSelect, handleRatingButton, handleRatingModal };

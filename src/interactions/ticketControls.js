const { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, UserSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db/tickets');
const settingsDb = require('../db/ticketSettings');
const actions = require('../utils/ticketActions');
const { buildTranscriptLinkRow, componentsAfterRating, starsText } = require('../utils/ticketCards');
const { EMOJI } = require('../utils/emojis');
const { t, languageOf, guildLanguage } = require('../i18n');
const { safeTicketAction } = require('../utils/safeTicketAction');
const { healGoneTicket } = require('../utils/ticketChannelGone');

// How each button is acknowledged before anything slow happens. `none` opens a window, which is the answer itself.
const ACK = { tk_claim: 'reply', tk_unclaim: 'reply', tk_closeyes: 'update', tk_closeno: 'update', tk_close: 'none', tk_reopen: 'update', tk_delete: 'reply', tk_transcript: 'reply', tk_addmember: 'reply', tk_removemember: 'reply' };
// The buttons that must not run twice at once (a second press while the first works is told to wait).
const LOCKED = new Set(['tk_claim', 'tk_unclaim', 'tk_closeyes', 'tk_reopen', 'tk_delete', 'tk_transcript']);

async function loadTicketContext(ctx, lang) {
  const { interaction } = ctx;
  const ticket = await db.getTicketByChannel(interaction.channel.id);
  if (!ticket) {
    await ctx.say(t(lang, 'tickets.gone'));
    return null;
  }
  const category = (await db.getCategoryById(ticket.category_id)) ?? { support_role_ids: [] };
  return { ticket, category };
}

async function requireStaff(ctx, category, ticket, lang) {
  const { interaction } = ctx;
  const settings = await settingsDb.getSettings(interaction.guild.id);
  if (actions.isStaffAllowedForTicket(interaction.member, category, ticket, settings)) return true;
  if (settings.claim_mode === 'exclusive' && ticket?.claimed_by && ticket.claimed_by !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await ctx.say({ content: t(lang, 'tickets.exclusiveClaim', { user: ticket.claimed_by }), allowedMentions: { parse: [] } });
    return false;
  }
  await ctx.say(t(lang, 'tickets.staffOnlyTicket'));
  return false;
}

async function requireOpenerOrStaff(ctx, ticket, category, lang) {
  if (ctx.interaction.user.id === ticket.opener_id) return true;
  if (await requireStaff(ctx, category, ticket, lang)) return true;
  return false;
}

/** Same as requireOpenerOrStaff, except when the server's "close requires support role" setting is on, in which case the opener alone isn't enough. */
async function requireCloseAllowed(ctx, ticket, category, lang) {
  const { interaction } = ctx;
  const isStaff = actions.isStaffForCategory(interaction.member, category);
  if (isStaff) return requireStaff(ctx, category, ticket, lang);

  const settings = await settingsDb.getSettings(interaction.guild.id);
  if (settings.close_requires_support_role) {
    await ctx.say(t(lang, 'tickets.staffOnlyClose'));
    return false;
  }
  if (interaction.user.id === ticket.opener_id) return true;

  await ctx.say(t(lang, 'tickets.openerOrStaffOnly'));
  return false;
}

/** What to do when the channel of the ticket turns out to be gone: the database is made to say the same (see healGoneTicket). */
function goneHealer(interaction, getTicket) {
  return async () => healGoneTicket({ guild: interaction.guild, client: interaction.client, ticket: getTicket(), actorId: interaction.user?.id ?? null });
}

/** All ticket-control button clicks — customId `tk_<action>::<ticketId>` (except tk_open, handled by ticketPanel.js). */
async function handleButton(interaction, deps = {}) {
  const [action, ticketId] = interaction.customId.split('::');
  let loaded = null;
  return safeTicketAction(interaction, action, (ctx) => runButton(ctx, action, ticketId, (ticket) => { loaded = ticket; }), {
    ack: ACK[action] ?? 'reply',
    lockKey: LOCKED.has(action) ? `${action}:${ticketId}` : null,
    label: `Ticket button "${action}" failed:`, // i18n-ignore: log text for the team
    expiredKey: action === 'tk_close' ? 'tickets.safe.tryAgain' : undefined,
    onGone: goneHealer(interaction, () => loaded),
  }, deps.safe);
}

async function runButton(ctx, action, ticketId, remember) {
  const { interaction } = ctx;
  const lang = await ctx.lang();
  const ctxData = await loadTicketContext(ctx, lang);
  if (!ctxData) return;
  const { ticket, category } = ctxData;
  remember(ticket);

  if (String(ticket.id) !== ticketId) {
    await ctx.say(t(lang, 'tickets.buttonMismatch'));
    return;
  }

  const actionCtx = { guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user };

  switch (action) {
    case 'tk_claim': {
      if (!(await requireStaff(ctx, category, ticket, lang))) return;
      if (ticket.claimed_by) {
        await ctx.say({ content: t(lang, 'tickets.alreadyClaimed', { user: ticket.claimed_by }), allowedMentions: { parse: [] } });
        return;
      }
      await actions.claimTicket(actionCtx); // posts the claim notice in the ticket
      await ctx.say(t(lang, 'tickets.claim.youClaimed', { emoji: EMOJI.TICKET_CLAIM }));
      return;
    }

    case 'tk_closeyes':
    case 'tk_closeno': {
      if (interaction.user.id !== ticket.opener_id) {
        await ctx.say(t(lang, 'tickets.requestClose.openerOnly'));
        return;
      }
      if (ticket.status === 'closed') {
        await ctx.updateMessage({ components: [] });
        return;
      }
      const before = interaction.message?.content ?? '';
      if (action === 'tk_closeno') {
        await ctx.updateMessage({ content: `${before}\n\n${t(lang, 'tickets.requestClose.keptOpen', { emoji: EMOJI.DENY, user: interaction.user.id })}`, components: [], allowedMentions: { parse: [] } });
        return;
      }
      await ctx.updateMessage({ content: `${before}\n\n${t(lang, 'tickets.requestClose.agreed', { emoji: EMOJI.APPROVE, user: interaction.user.id })}`, components: [], allowedMentions: { parse: [] } });
      await actions.closeTicket({ ...actionCtx, reason: t(lang, 'tickets.requestClose.reason') });
      return;
    }

    case 'tk_unclaim': {
      if (!(await requireStaff(ctx, category, ticket, lang))) return;
      await actions.unclaimTicket(actionCtx);
      await ctx.say(t(lang, 'tickets.claim.released'));
      return;
    }

    case 'tk_close': {
      if (!(await requireCloseAllowed(ctx, ticket, category, lang))) return;
      if (ticket.status === 'closed') {
        await ctx.say(t(lang, 'tickets.alreadyClosed'));
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
      if (!(await requireStaff(ctx, category, ticket, lang))) return;
      if (ticket.status !== 'closed') {
        await ctx.say(t(lang, 'tickets.notClosed'));
        return;
      }
      await actions.reopenTicket(actionCtx);
      return;
    }

    case 'tk_delete': {
      if (!(await requireStaff(ctx, category, ticket, lang))) return;
      await ctx.say(t(lang, 'tickets.deleting', { emoji: EMOJI.TICKET_DELETE }));
      await actions.deleteTicketChannel(actionCtx);
      return;
    }

    case 'tk_transcript': {
      if (!(await requireStaff(ctx, category, ticket, lang))) return;
      const { link } = await actions.postTranscript(actionCtx);
      const linkRow = buildTranscriptLinkRow(link, lang);
      await ctx.say({ content: t(lang, 'tickets.transcript.posted', { emoji: EMOJI.APPROVE }), components: linkRow ? [linkRow] : [] });
      return;
    }

    case 'tk_addmember': {
      if (!(await requireOpenerOrStaff(ctx, ticket, category, lang))) return;
      const select = new UserSelectMenuBuilder().setCustomId(`tk_addmember_select::${ticket.id}`).setPlaceholder(t(lang, 'tickets.addMember.placeholder.menu')).setMinValues(1).setMaxValues(1);
      await ctx.say({ content: t(lang, 'tickets.addMember.question'), components: [new ActionRowBuilder().addComponents(select)] });
      return;
    }

    case 'tk_removemember': {
      if (!(await requireOpenerOrStaff(ctx, ticket, category, lang))) return;
      const select = new UserSelectMenuBuilder().setCustomId(`tk_removemember_select::${ticket.id}`).setPlaceholder(t(lang, 'tickets.removeMember.placeholder.menu')).setMinValues(1).setMaxValues(1);
      await ctx.say({ content: t(lang, 'tickets.removeMember.question'), components: [new ActionRowBuilder().addComponents(select)] });
      return;
    }

    default:
      await ctx.say(t(lang, 'tickets.buttonMismatch'));
  }
}

/** Close-reason modal submit — customId `tk_closemodal::<ticketId>`. */
async function handleCloseModal(interaction, deps = {}) {
  const [, ticketId] = interaction.customId.split('::');
  let loaded = null;
  return safeTicketAction(interaction, 'tk_closemodal', async (ctx) => {
    const lang = await ctx.lang();
    const ctxData = await loadTicketContext(ctx, lang);
    if (!ctxData) return;
    const { ticket, category } = ctxData;
    loaded = ticket;
    if (String(ticket.id) !== ticketId) return;
    if (!(await requireCloseAllowed(ctx, ticket, category, lang))) return;
    if (ticket.status === 'closed') {
      await ctx.say(t(lang, 'tickets.alreadyClosed'));
      return;
    }
    const reason = interaction.fields.getTextInputValue('reason');
    await actions.closeTicket({ guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user, reason });
    await ctx.say(t(lang, 'tickets.closed', { emoji: EMOJI.DENY }));
  }, {
    ack: 'reply',
    lockKey: `tk_closemodal:${ticketId}`,
    label: 'Ticket close (modal) failed:', // i18n-ignore: log text for the team
    onGone: goneHealer(interaction, () => loaded),
  }, deps.safe);
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
async function loadRatingContext(ctx, rating, d) {
  const { interaction } = ctx;
  const [, ticketId] = interaction.customId.split('::');
  const ticket = await d.db.getTicketById(Number(ticketId));
  if (!ticket) {
    await ctx.say(t(await d.languageOf(interaction), 'tickets.gone'));
    return null;
  }
  // Pressed in the member's DMs: answered in the language of the server the ticket belongs to.
  const lang = await d.guildLanguage(ticket.guild_id);
  if (interaction.user.id !== ticket.opener_id || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    await ctx.say(t(lang, 'tickets.rating.openerOnly'));
    return null;
  }
  return { ticket, lang };
}

/**
 * The message with the rating buttons, updated in place: the buttons become the "thanks" card (or are disabled in an older message),
 * so they cannot be pressed again. Then a private line for the member. Works for a button and for the modal opened from it.
 */
async function finishRating(ctx, rating, { lang, already }) {
  const { interaction } = ctx;
  const message = interaction.message;
  const content = t(lang, already ? 'tickets.rating.already' : 'tickets.rating.thanks', { stars: starsText(rating) });
  if (message?.components?.length && (typeof interaction.update === 'function' || interaction.deferred)) {
    const v2 = Boolean(message.flags?.has?.(MessageFlags.IsComponentsV2));
    await ctx.updateMessage({ components: componentsAfterRating(message.components, rating, { v2, lang }) });
    await ctx.followUp(content).catch(() => {});
    return;
  }
  await ctx.say(content);
}

/**
 * Rating-button click on the closed-ticket DM — customId `tk_rate::<ticketId>::<1-5>`. Only the ticket's own opener can rate it, once.
 * The three seconds of Discord are watched: when looking up the ticket is slow, the click is acknowledged first and the rating is saved without
 * the optional comment (a window cannot open any more), instead of failing with "Unknown interaction".
 */
async function handleRatingButton(interaction, deps = {}) {
  const d = ratingDeps(deps);
  const rating = Number(interaction.customId.split('::')[2]);
  const [, ticketId] = interaction.customId.split('::');
  return safeTicketAction(interaction, 'tk_rate', async (ctx) => {
    const prepare = async () => {
      const context = await loadRatingContext(ctx, rating, d);
      if (!context) return null;
      const { ticket, lang } = context;
      // Rated already (a second click, another device): the buttons go away and the member sees what they gave.
      const existing = await d.ratingsDb.getRating(ticket.id);
      if (existing) return { ...context, existing };
      const guild = await interaction.client.guilds.fetch(ticket.guild_id).catch(() => null);
      if (!guild) return { ...context, guildMissing: true };
      const settings = await d.settingsDb.getSettings(ticket.guild_id);
      return { ...context, guild, settings };
    };
    const { value: prepared, late } = await ctx.afterDeadline(prepare(), 'update');
    if (!prepared) return;
    const { ticket, lang } = prepared;
    if (prepared.existing) {
      await finishRating(ctx, prepared.existing.rating, { lang, already: true });
      return;
    }
    if (prepared.guildMissing) {
      await ctx.say(t(lang, 'tickets.rating.failed'));
      return;
    }
    if (prepared.settings.rating_mode === 'rating_comment' && !late) {
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
    const result = await d.rateTicket({ guild: prepared.guild, client: interaction.client, ticket, user: interaction.user, rating });
    await finishRating(ctx, result?.rating?.rating ?? rating, { lang, already: result?.created === false });
  }, {
    ack: 'none',
    lockKey: `tk_rate:${ticketId}`,
    lang: async () => d.languageOf(interaction),
    label: 'Ticket rating failed:', // i18n-ignore: log text for the team
    expiredKey: 'tickets.safe.tryAgain',
    // The rating message or a log channel is gone: the rating itself is saved, so the member is only thanked.
    onGone: async () => ({ text: t(await d.languageOf(interaction), 'tickets.rating.thanks', { stars: starsText(rating) }) }),
  }, deps.safe);
}

/** Optional-comment follow-up for the closed-ticket DM rating flow (the modal opened from a rating button). */
async function handleRatingModal(interaction, deps = {}) {
  const d = ratingDeps(deps);
  const rating = Number(interaction.customId.split('::')[2]);
  const [, ticketId] = interaction.customId.split('::');
  return safeTicketAction(interaction, 'tk_ratemodal', async (ctx) => {
    const context = await loadRatingContext(ctx, rating, d);
    if (!context) return;
    const { ticket, lang } = context;
    const guild = await interaction.client.guilds.fetch(ticket.guild_id).catch(() => null);
    if (!guild) {
      await ctx.say(t(lang, 'tickets.rating.failed'));
      return;
    }
    const comment = interaction.fields.getTextInputValue('comment').trim() || null;
    const result = await d.rateTicket({ guild, client: interaction.client, ticket, user: interaction.user, rating, comment });
    await finishRating(ctx, result?.rating?.rating ?? rating, { lang, already: result?.created === false });
  }, {
    ack: interaction.message ? 'update' : 'reply',
    lockKey: `tk_ratemodal:${ticketId}`,
    lang: async () => d.languageOf(interaction),
    label: 'Ticket rating with comment failed:', // i18n-ignore: log text for the team
    onGone: async () => ({ text: t(await d.languageOf(interaction), 'tickets.rating.thanks', { stars: starsText(rating) }) }),
  }, deps.safe);
}

/** Add/remove-member user-select follow-up — customId `tk_addmember_select::<ticketId>` / `tk_removemember_select::<ticketId>`. */
async function handleUserSelect(interaction, deps = {}) {
  const [action, ticketId] = interaction.customId.split('::');
  let loaded = null;
  return safeTicketAction(interaction, action, async (ctx) => {
    const lang = await ctx.lang();
    const ctxData = await loadTicketContext(ctx, lang);
    if (!ctxData) return;
    const { ticket, category } = ctxData;
    loaded = ticket;
    if (String(ticket.id) !== ticketId) return;
    if (!(await requireOpenerOrStaff(ctx, ticket, category, lang))) return;

    const targetUser = interaction.users.first();
    const actionCtx = { guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user, targetUser };
    if (action === 'tk_addmember_select') {
      await actions.addMember(actionCtx);
      await ctx.updateMessage({ content: t(lang, 'tickets.member.added', { emoji: EMOJI.APPROVE, user: `${targetUser}` }), components: [] });
    } else {
      await actions.removeMember(actionCtx);
      await ctx.updateMessage({ content: t(lang, 'tickets.member.removed', { emoji: EMOJI.APPROVE, user: `${targetUser}` }), components: [] });
    }
  }, {
    ack: 'update',
    label: `Ticket user-select "${action}" failed:`, // i18n-ignore: log text for the team
    onGone: goneHealer(interaction, () => loaded),
  }, deps.safe);
}

module.exports = { handleButton, handleCloseModal, handleUserSelect, handleRatingButton, handleRatingModal };

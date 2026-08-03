const { ChannelType, PermissionFlagsBits, MessageFlags, AttachmentBuilder } = require('discord.js');
const db = require('../db/tickets');
const formsDb = require('../db/ticketForms');
const accessDb = require('../db/ticketAccess');
const settingsDb = require('../db/ticketSettings');
const ratingsDb = require('../db/ticketRatings');
const { getTemplate } = require('../db/embedTemplates');
const { build } = require('./embedBuilder');
const { formatTicketChannelName, sanitizeChannelName } = require('./ticketName');
const { buildTranscript } = require('./ticketTranscript');
const { createTranscriptToken } = require('./transcriptToken');
const { buildTicketControlRow, buildTicketMemberRow, buildClosedControlRow, buildWelcomeFallbackCard, buildTranscriptLinkRow, buildTicketClosedCard, buildRatingRow } = require('./ticketCards');
const { textCard } = require('./caseCard');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const config = require('../config');
const logger = require('./logger');

const STAFF_OVERWRITE_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

const MEMBER_OVERWRITE_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];

function buildOpenOverwrites({ guild, opener, category }) {
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: opener.id, allow: MEMBER_OVERWRITE_PERMS },
    { id: guild.members.me.id, allow: [...STAFF_OVERWRITE_PERMS, PermissionFlagsBits.ManageChannels] },
  ];
  for (const roleId of category.support_role_ids ?? []) {
    overwrites.push({ id: roleId, allow: STAFF_OVERWRITE_PERMS });
  }
  return overwrites;
}

function isStaffForCategory(member, category) {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return (category.support_role_ids ?? []).some((id) => member.roles.cache.has(id));
}

function isStaffAllowedForTicket(member, category, ticket, settings) {
  if (!isStaffForCategory(member, category)) return false;
  if (settings?.claim_mode !== 'exclusive' || !ticket?.claimed_by) return true;
  return ticket.claimed_by === member.id || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

/**
 * Resolves a category's welcome message: a saved /embed template (rendered with variables) if
 * set, otherwise a plain fallback card. `pingText` (support-role mentions) has to be threaded in
 * here rather than sent as a separate top-level `content` field, since Components V2 messages
 * can't combine `content` with a V2 component tree — only the classic (embed-template) branch can.
 */
async function buildWelcomePayload({ category, guild, channel, opener, ticketId, pingText }) {
  if (category.welcome_embed_template) {
    const doc = await getTemplate(guild.id, category.welcome_embed_template);
    if (doc) {
      const payload = await build(doc.data, { user: opener, guild, channel });
      const content = [pingText, payload.content].filter(Boolean).join('\n') || undefined;
      const controlRows = [buildTicketControlRow(ticketId), buildTicketMemberRow(ticketId)];
      const templateRows = (payload.components ?? []).slice(0, 5 - controlRows.length);
      return { content, embeds: payload.embeds, components: [...templateRows, ...controlRows] };
    }
  }
  return {
    components: [buildWelcomeFallbackCard({ opener, categoryLabel: category.label, pingText }), buildTicketControlRow(ticketId), buildTicketMemberRow(ticketId)],
    flags: MessageFlags.IsComponentsV2,
  };
}

/** Creates the ticket's private channel, DB row, and welcome message. Throws on failure (caller replies with the error). */
async function openTicket({ guild, client, category, opener, formAnswers = null }) {
  const settings = await settingsDb.getSettings(guild.id);
  const member = await guild.members.fetch(opener.id).catch(() => null);
  const roleIds = member ? [...member.roles.cache.keys()] : [];
  if (settings.blocked_role_ids.length > 0) {
    if (member && settings.blocked_role_ids.some((id) => member.roles.cache.has(id))) {
      const err = new Error("You're not allowed to open tickets in this server.");
      err.userFacing = true;
      throw err;
    }
  }

  const blacklistEntry = await accessDb.isBlacklisted(guild.id, opener.id, roleIds);
  if (blacklistEntry) {
    const err = new Error("You're not allowed to open tickets in this server.");
    err.userFacing = true;
    throw err;
  }

  const requiredRoleIds = category.required_role_ids ?? [];
  if (requiredRoleIds.length && (!member || !requiredRoleIds.every((id) => member.roles.cache.has(id)))) {
    const err = new Error(`You need ${requiredRoleIds.map((id) => `<@&${id}>`).join(', ')} to open this ticket.`);
    err.userFacing = true;
    throw err;
  }

  const openCount = await db.countOpenTickets(guild.id, category.id, opener.id);
  if (openCount >= category.max_open_per_user) {
    const err = new Error(`You already have ${openCount} open ticket(s) in this category (limit ${category.max_open_per_user}). Close one before opening another.`);
    err.userFacing = true;
    throw err;
  }

  const ticket = await db.createTicket({ guildId: guild.id, categoryId: category.id, openerId: opener.id });

  let channel;
  try {
    if (category.form_id && formAnswers) await db.setTicketFormData(ticket.id, { formId: category.form_id, answers: formAnswers });
    channel = await guild.channels.create({
      name: formatTicketChannelName(category.naming_pattern, { number: ticket.ticket_number, username: opener.username }),
      type: ChannelType.GuildText,
      parent: category.parent_channel_id || undefined,
      permissionOverwrites: buildOpenOverwrites({ guild, opener, category }),
      reason: `Ticket #${ticket.ticket_number} opened by ${opener.tag ?? opener.username}`,
    });
  } catch (err) {
    await db.deleteTicketRow(ticket.id);
    throw err;
  }

  await db.setTicketChannel(ticket.id, channel.id);

  const pingRoleIds = category.ping_role_ids ?? [];
  const pingText = pingRoleIds.map((id) => `<@&${id}>`).join(' ');
  const welcome = await buildWelcomePayload({ category, guild, channel, opener, ticketId: ticket.id, pingText });

  // The bot's client-level default suppresses all mentions (see index.js) — this is the one ticket
  // message that's actually meant to notify people, so it opts back in for just the configured roles.
  await channel.send({ ...welcome, allowedMentions: { roles: pingRoleIds } }).catch((err) => logger.warn(`Ticket #${ticket.ticket_number}: failed to send welcome message:`, err.message));

  if (formAnswers && Object.keys(formAnswers).length) {
    const answerLines = Object.entries(formAnswers).map(([label, answer]) => `**${label}:** ${String(answer).slice(0, 1000)}`);
    await channel.send({ components: [textCard(`### Submitted form\n${answerLines.join('\n')}`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }

  await sendLog(client, guild.id, 'tickets', {
    author: { name: `Ticket #${ticket.ticket_number} opened` },
    description: `${EMOJI.APPROVE} <@${opener.id}> opened a **${category.label}** ticket: <#${channel.id}>`,
    color: 0xa5ea7a,
    footer: { text: `User ID: ${opener.id}` },
    timestamp: new Date().toISOString(),
  }).catch((err) => logger.error('Ticket log (open) failed:', err));

  if (settings.opened_log_channel_id) {
    const logChannel = await guild.channels.fetch(settings.opened_log_channel_id).catch(() => null);
    if (logChannel) {
      await logChannel
        .send({ components: [textCard(`${EMOJI.APPROVE} Ticket #${ticket.ticket_number} (**${category.label}**) opened by <@${opener.id}>: <#${channel.id}>`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 })
        .catch(() => {});
    }
  }

  return { ticket: { ...ticket, channel_id: channel.id }, channel };
}

async function claimTicket({ guild, client, channel, ticket, actor }) {
  const settings = await settingsDb.getSettings(guild.id);
  const updated = await db.setClaim(ticket.id, actor.id);

  if (channel && settings.roles_to_add_on_claim.length > 0) {
    for (const roleId of settings.roles_to_add_on_claim) {
      await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
    }
  }
  if (channel && settings.ping_on_claim) {
    await channel
      .send({ content: `<@${ticket.opener_id}> your ticket was claimed by <@${actor.id}>.`, allowedMentions: { users: [ticket.opener_id] } })
      .catch(() => {});
  }

  await sendLog(client, guild.id, 'tickets', {
    description: `${EMOJI.STAR} Ticket #${ticket.ticket_number} claimed by <@${actor.id}>.`,
    color: 0x8399ff,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
  return updated;
}

async function unclaimTicket({ guild, client, ticket, actor }) {
  const updated = await db.setClaim(ticket.id, null);
  await sendLog(client, guild.id, 'tickets', {
    description: `Ticket #${ticket.ticket_number} unclaimed by <@${actor.id}>.`,
    color: 0x8399ff,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
  return updated;
}

/** Signed link to the web transcript viewer, or null if the web server isn't configured (see /verify's env vars — this route lives on the same server, just under its own optional hostname). */
function buildTranscriptLink({ guild, ticket }) {
  const baseUrl = config.transcriptBaseUrl ?? config.verifyBaseUrl;
  if (!baseUrl || !config.verifyTokenSecret) return null;
  const token = createTranscriptToken({ ticketId: ticket.id, guildId: guild.id });
  return `${baseUrl}/transcript/${guild.id}/${ticket.ticket_number}/${token}`;
}

/** Builds the transcript HTML, persists it (so the web viewer survives channel deletion), and returns it plus a shareable link. */
async function generateAndStoreTranscript({ guild, channel, ticket, opener }) {
  const { html, messageCount } = await buildTranscript(channel, { ticketNumber: ticket.ticket_number, openerTag: opener?.username });
  await db.saveTranscriptHtml(ticket.id, html).catch((err) => logger.error(`Ticket #${ticket.ticket_number}: failed to persist transcript:`, err));
  const link = buildTranscriptLink({ guild, ticket });
  return { html, messageCount, link };
}

/** Generates and delivers a transcript (log channel + best-effort DM to the opener), without closing anything. */
async function postTranscript({ guild, client, channel, ticket }) {
  const opener = await client.users.fetch(ticket.opener_id).catch(() => null);
  const { html, messageCount, link } = await generateAndStoreTranscript({ guild, channel, ticket, opener });
  const fileName = `ticket-${ticket.ticket_number}-transcript.html`;
  const linkRow = buildTranscriptLinkRow(link);

  await sendLog(
    client,
    guild.id,
    'tickets',
    {
      description: `${EMOJI.STAR} Transcript for ticket #${ticket.ticket_number} (${messageCount} message(s)).${link ? `\n[View online](${link})` : ''}`,
      color: 0x8399ff,
      timestamp: new Date().toISOString(),
    },
    linkRow
      ? { components: [linkRow] }
      : { files: [{ data: Buffer.from(html, 'utf8'), name: fileName }] },
  ).catch((err) => logger.error('Ticket log (transcript) failed:', err));

  return { link };
}

/** Closes (locks) a ticket: removes send access from the opener/added members, posts + delivers a transcript, marks it closed in the DB. */
async function closeTicket({ guild, client, channel, ticket, actor, reason }) {
  const settings = await settingsDb.getSettings(guild.id);

  if (settings.close_requires_reason && !reason?.trim()) {
    const err = new Error('A close reason is required in this server.');
    err.userFacing = true;
    throw err;
  }
  const finalReason = reason?.trim() || settings.default_close_reason || 'No reason provided.';

  const opener = await client.users.fetch(ticket.opener_id).catch(() => null);

  // Lock the channel — keep read access for everyone who had it, drop send access from non-staff.
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (overwrite.id === guild.id) continue;
    if (overwrite.allow.has(PermissionFlagsBits.SendMessages)) {
      await channel.permissionOverwrites.edit(overwrite.id, { SendMessages: false }).catch(() => {});
    }
  }

  const closed = await db.closeTicket(ticket.id, { closedBy: actor.id, reason: finalReason });

  const { html, messageCount, link } = await generateAndStoreTranscript({ guild, channel, ticket, opener });
  const fileBuffer = Buffer.from(html, 'utf8');
  const fileName = `ticket-${ticket.ticket_number}-transcript.html`;

  const closedByLine = settings.hide_closing_user ? 'Closed by staff.' : `Closed by <@${actor.id}>.`;
  const staffCountLine = settings.log_staff_message_counts ? `\n**Staff replies:** ${ticket.staff_message_count ?? 0}` : '';
  const logLinkRow = buildTranscriptLinkRow(link);

  await sendLog(
    client,
    guild.id,
    'tickets',
    {
      author: { name: `Ticket #${ticket.ticket_number} closed` },
      description: `${EMOJI.DENY} ${closedByLine}\n**Reason:** ${finalReason}\n**Messages:** ${messageCount}${staffCountLine}${link ? `\n[View transcript online](${link})` : ''}`,
      color: 0xfe6465,
      footer: { text: `Opened by ${opener?.username ?? ticket.opener_id}` },
      timestamp: new Date().toISOString(),
    },
    logLinkRow
      ? { components: [logLinkRow] }
      : { files: [{ data: fileBuffer, name: fileName }] },
  ).catch((err) => logger.error('Ticket log (close) failed:', err));

  if (settings.closed_log_channel_id) {
    const logChannel = await guild.channels.fetch(settings.closed_log_channel_id).catch(() => null);
    if (logChannel) {
      const desc = `${EMOJI.DENY} Ticket #${ticket.ticket_number} closed. ${closedByLine}\n**Reason:** ${finalReason}\n**Messages:** ${messageCount}${staffCountLine}${link ? `\n[View transcript online](${link})` : ''}`;
      const dedicatedLinkRow = buildTranscriptLinkRow(link);
      const payload = {
        components: [textCard(desc, 0xfe6465), ...(dedicatedLinkRow ? [dedicatedLinkRow] : [])],
        flags: MessageFlags.IsComponentsV2,
        ...(dedicatedLinkRow ? {} : { files: [{ attachment: fileBuffer, name: fileName }] }),
      };
      await logChannel
        .send(payload)
        .catch(() => {});
    }
  }

  if (opener && settings.dm_user_on_close) {
    const linkRow = buildTranscriptLinkRow(link);
    const card = buildTicketClosedCard({ ticket, guild, actor, reason: finalReason, channel, hideCloser: settings.hide_closing_user });
    const rows = [card];
    if (settings.rating_enabled) rows.push(buildRatingRow(ticket.id));
    if (linkRow) rows.push(linkRow);

    // With a web link available, skip the raw .html attachment in the DM — Discord auto-previews
    // small text attachments as a syntax-highlighted code block, which looks noisy for an end user.
    // Without one (web server not configured), the file is the only way to deliver it, so keep it.
    const dmPayload = linkRow ? { components: rows, flags: MessageFlags.IsComponentsV2 } : { components: rows, flags: MessageFlags.IsComponentsV2, files: [new AttachmentBuilder(fileBuffer, { name: fileName })] };

    await opener.send(dmPayload).catch(() => logger.warn(`Ticket #${ticket.ticket_number}: could not DM transcript to opener.`));
  }

  const closeCard = textCard(
    [`${EMOJI.DENY}  **Ticket closed.** ${closedByLine}`, `**Reason:** ${finalReason}`, 'Staff can reopen or permanently delete this channel below.'].join('\n'),
    0xfe6465,
  );
  await channel.send({ components: [closeCard, buildClosedControlRow(ticket.id, link)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});

  return closed;
}

/** Records a member's 1-5 star rating for a closed ticket (from the DM rating buttons), and best-effort logs it if a rating log channel is configured. */
async function rateTicket({ guild, client, ticket, user, rating, comment }) {
  await ratingsDb.addRating(guild.id, ticket.id, user.id, rating, comment);

  const settings = await settingsDb.getSettings(guild.id);
  if (settings.rating_log_channel_id) {
    const logChannel = await guild.channels.fetch(settings.rating_log_channel_id).catch(() => null);
    if (logChannel) {
      const stars = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);
      await logChannel
        .send({
          components: [textCard(`Ticket #${ticket.ticket_number} rated ${stars} by <@${user.id}>.${comment ? `\n**Comment:** ${comment}` : ''}`, 0xfed53c)],
          flags: MessageFlags.IsComponentsV2,
        })
        .catch(() => {});
    }
  }
}

async function reopenTicket({ guild, client, channel, ticket, actor }) {
  await channel.permissionOverwrites.edit(ticket.opener_id, { SendMessages: true }).catch(() => {});

  const category = await db.getCategoryById(ticket.category_id);
  for (const roleId of category?.support_role_ids ?? []) {
    await channel.permissionOverwrites.edit(roleId, { SendMessages: true }).catch(() => {});
  }

  const reopened = await db.reopenTicket(ticket.id);

  await sendLog(client, guild.id, 'tickets', {
    description: `${EMOJI.APPROVE} Ticket #${ticket.ticket_number} reopened by <@${actor.id}>.`,
    color: 0xa5ea7a,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  const card = textCard(`${EMOJI.APPROVE}  **Ticket reopened** by <@${actor.id}>.`, 0xa5ea7a);
  await channel.send({ components: [card, buildTicketControlRow(ticket.id), buildTicketMemberRow(ticket.id)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});

  return reopened;
}

async function deleteTicketChannel({ guild, client, channel, ticket, actor }) {
  await sendLog(client, guild.id, 'tickets', {
    description: `${EMOJI.HAMMER} Ticket #${ticket.ticket_number}'s channel was deleted by <@${actor.id}>.`,
    color: 0xfe6465,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  await db.setTicketChannel(ticket.id, null);
  await channel.delete(`Ticket #${ticket.ticket_number} deleted by ${actor.tag ?? actor.username}`);
}

async function addMember({ guild, client, channel, ticket, actor, targetUser }) {
  await channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
  await sendLog(client, guild.id, 'tickets', {
    description: `${EMOJI.APPROVE} <@${targetUser.id}> was added to ticket #${ticket.ticket_number} by <@${actor.id}>.`,
    color: 0xa5ea7a,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

async function removeMember({ guild, client, channel, ticket, actor, targetUser }) {
  await channel.permissionOverwrites.delete(targetUser.id).catch(() => {});
  await sendLog(client, guild.id, 'tickets', {
    description: `${EMOJI.DENY} <@${targetUser.id}> was removed from ticket #${ticket.ticket_number} by <@${actor.id}>.`,
    color: 0xfe6465,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

async function renameTicket({ guild, client, channel, ticket, actor, newName }) {
  const sanitized = sanitizeChannelName(newName) || channel.name;
  await channel.setName(sanitized, `Ticket #${ticket.ticket_number} renamed by ${actor.tag ?? actor.username}`);
  await sendLog(client, guild.id, 'tickets', {
    description: `Ticket #${ticket.ticket_number} renamed to \`${sanitized}\` by <@${actor.id}>.`,
    color: 0x8399ff,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
  return sanitized;
}

/** Shared "open a ticket from an interaction" flow — used by both the /ticket open slash command and panel buttons/select menus. */
async function openTicketInteractive(interaction, category) {
  if (category.form_id && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) {
    const form = await formsDb.getFormById(category.form_id);
    if (!form) {
      await interaction.reply({ content: 'This ticket form is missing. Ask a server administrator to fix the category.', flags: MessageFlags.Ephemeral });
      return;
    }
    const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    const modal = new ModalBuilder().setCustomId(`tk_form::${category.id}::${form.id}`).setTitle(form.title || 'Ticket details');
    for (const field of form.fields ?? []) {
      const input = new TextInputBuilder().setCustomId(`field::${field.id}`).setLabel(field.label).setStyle(field.type === 'long_text' ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(field.required !== false);
      if (field.placeholder) input.setPlaceholder(field.placeholder);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
    }
    await interaction.showModal(modal);
    return;
  }
  if (category.form_id) {
    await interaction.reply({ content: 'This category requires a form. Open it from the ticket panel so the form can be completed.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const { channel } = await openTicket({ guild: interaction.guild, client: interaction.client, category, opener: interaction.user });
    await interaction.editReply({ content: `${EMOJI.APPROVE} Ticket opened: ${channel}` });
  } catch (err) {
    await interaction.editReply({ content: err.userFacing ? err.message : 'I was unable to open a ticket. Check my permissions (Manage Channels) and try again.' });
    if (!err.userFacing) logger.error('Ticket open failed:', err);
  }
}

module.exports = {
  isStaffForCategory,
  isStaffAllowedForTicket,
  openTicket,
  openTicketInteractive,
  claimTicket,
  unclaimTicket,
  closeTicket,
  rateTicket,
  reopenTicket,
  deleteTicketChannel,
  addMember,
  removeMember,
  renameTicket,
  postTranscript,
};

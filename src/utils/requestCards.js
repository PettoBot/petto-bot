// The card of a request, with the buttons that fit its state, and the rules of who may press them.
const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

const PREFIX = 'rq:';
const COLORS = { open: 0x5865f2, claimed: 0xf0b232, done: 0x23a55a, cancelled: 0x4b4f59 };
const LABELS = { open: 'Open', claimed: 'Claimed', done: 'Done', cancelled: 'Cancelled' };

const unix = (value) => Math.floor(new Date(value).getTime() / 1000);

function statusLine(request) {
  if (request.status === 'claimed') return `Claimed by <@${request.claimed_by}> <t:${unix(request.claimed_at)}:R>`;
  if (request.status === 'done') return `Done${request.claimed_by ? ` by <@${request.claimed_by}>` : ''} <t:${unix(request.completed_at ?? request.created_at)}:R>`;
  if (request.status === 'cancelled') return 'Cancelled';
  return 'Waiting for someone to claim it';
}

/** The Components V2 card. Open and claimed requests have buttons; finished ones do not. */
function requestCard(request) {
  const container = new ContainerBuilder()
    .setAccentColor(COLORS[request.status] ?? COLORS.open)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([`### Request #${request.number} · ${LABELS[request.status] ?? 'Open'}`, `<@${request.user_id}> asks for:`, request.content.split('\n').map((line) => `> ${line}`).join('\n'), statusLine(request)].join('\n')));
  const button = (action, label, style) => new ButtonBuilder().setCustomId(`${PREFIX}${action}:${request.number}`).setLabel(label).setStyle(style);
  if (request.status === 'open') container.addActionRowComponents(new ActionRowBuilder().addComponents(button('claim', 'Claim', ButtonStyle.Success), button('cancel', 'Cancel', ButtonStyle.Danger)));
  if (request.status === 'claimed') container.addActionRowComponents(new ActionRowBuilder().addComponents(button('done', 'Done', ButtonStyle.Success), button('unclaim', 'Unclaim', ButtonStyle.Secondary), button('cancel', 'Cancel', ButtonStyle.Danger)));
  return container;
}

/** Whether a member is staff for requests: has the staff role (or can manage the server), or, with no staff role set, can manage messages. */
function isStaff(member, config) {
  const permissions = member.permissions;
  if (permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (config.staff_role_id) return Boolean(member.roles?.cache?.has(config.staff_role_id));
  return Boolean(permissions?.has(PermissionFlagsBits.ManageMessages));
}

/** What a button may do, or why not: `{ allowed }` or `{ allowed: false, reason }`. */
function mayPress(action, request, member, config) {
  const staff = isStaff(member, config);
  const owner = request.user_id === member.id;
  if (action === 'claim') return request.status !== 'open' ? { allowed: false, reason: 'Someone already claimed it.' } : staff ? { allowed: true } : { allowed: false, reason: 'Only the staff can claim requests.' };
  if (action === 'done') {
    if (request.status !== 'claimed') return { allowed: false, reason: 'It has to be claimed first.' };
    return staff || request.claimed_by === member.id ? { allowed: true } : { allowed: false, reason: 'Only the staff can finish requests.' };
  }
  if (action === 'unclaim') {
    if (request.status !== 'claimed') return { allowed: false, reason: 'Nobody has claimed it.' };
    return request.claimed_by === member.id || member.permissions?.has(PermissionFlagsBits.ManageGuild) ? { allowed: true } : { allowed: false, reason: 'Only who claimed it can unclaim it.' };
  }
  if (action === 'cancel') {
    if (!['open', 'claimed'].includes(request.status)) return { allowed: false, reason: 'It is already finished.' };
    return owner || staff ? { allowed: true } : { allowed: false, reason: 'Only the author or the staff can cancel it.' };
  }
  return { allowed: false, reason: 'Unknown button.' };
}

module.exports = { PREFIX, requestCard, isStaff, mayPress, statusLine };

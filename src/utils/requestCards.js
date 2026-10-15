// The card of a request, with the buttons that fit its state, and the rules of who may press them.
const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

const { t, currentLanguage } = require('../i18n');

const PREFIX = 'rq:';
const COLORS = { open: 0x5865f2, claimed: 0xf0b232, done: 0x23a55a, cancelled: 0x4b4f59 };
const STATUSES = ['open', 'claimed', 'done', 'cancelled'];

const unix = (value) => Math.floor(new Date(value).getTime() / 1000);

/** The name of a state of a request (`Open`, `Claimed`...), for cards and messages. */
const statusLabel = (status, lang = currentLanguage()) => t(lang, `requests.status.${STATUSES.includes(status) ? status : 'open'}`);

function statusLine(request, lang = currentLanguage()) {
  if (request.status === 'claimed') return t(lang, 'requests.card.claimedBy', { user: `<@${request.claimed_by}>`, time: `<t:${unix(request.claimed_at)}:R>` });
  if (request.status === 'done') {
    const time = `<t:${unix(request.completed_at ?? request.created_at)}:R>`;
    return request.claimed_by ? t(lang, 'requests.card.doneBy', { user: `<@${request.claimed_by}>`, time }) : t(lang, 'requests.card.done', { time });
  }
  if (request.status === 'cancelled') return t(lang, 'requests.status.cancelled');
  return t(lang, 'requests.card.waiting');
}

/** The Components V2 card. Open and claimed requests have buttons; finished ones do not. */
function requestCard(request, lang = currentLanguage()) {
  const container = new ContainerBuilder()
    .setAccentColor(COLORS[request.status] ?? COLORS.open)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([t(lang, 'requests.card.title', { number: request.number, status: statusLabel(request.status, lang) }), t(lang, 'requests.card.asks', { user: `<@${request.user_id}>` }), request.content.split('\n').map((line) => `> ${line}`).join('\n'), statusLine(request, lang)].join('\n')));
  const button = (action, style) => new ButtonBuilder().setCustomId(`${PREFIX}${action}:${request.number}`).setLabel(t(lang, `requests.${action}.button`)).setStyle(style);
  if (request.status === 'open') container.addActionRowComponents(new ActionRowBuilder().addComponents(button('claim', ButtonStyle.Success), button('cancel', ButtonStyle.Danger)));
  if (request.status === 'claimed') container.addActionRowComponents(new ActionRowBuilder().addComponents(button('done', ButtonStyle.Success), button('unclaim', ButtonStyle.Secondary), button('cancel', ButtonStyle.Danger)));
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
function mayPress(action, request, member, config, lang = currentLanguage()) {
  const staff = isStaff(member, config);
  const owner = request.user_id === member.id;
  const no = (key) => ({ allowed: false, reason: t(lang, `requests.refuse.${key}`) });
  if (action === 'claim') return request.status !== 'open' ? no('alreadyClaimed') : staff ? { allowed: true } : no('claimStaff');
  if (action === 'done') {
    if (request.status !== 'claimed') return no('claimFirst');
    return staff || request.claimed_by === member.id ? { allowed: true } : no('doneStaff');
  }
  if (action === 'unclaim') {
    if (request.status !== 'claimed') return no('notClaimed');
    return request.claimed_by === member.id || member.permissions?.has(PermissionFlagsBits.ManageGuild) ? { allowed: true } : no('unclaimOwn');
  }
  if (action === 'cancel') {
    if (!['open', 'claimed'].includes(request.status)) return no('finished');
    return owner || staff ? { allowed: true } : no('cancelOwn');
  }
  return no('unknown');
}

module.exports = { PREFIX, requestCard, isStaff, mayPress, statusLine, statusLabel };

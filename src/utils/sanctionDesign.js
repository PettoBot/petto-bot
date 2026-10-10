// The default look of a sanction (Components V2): the same card for the reply of the command, the sanctions log and the
// message the sanctioned member gets. A server can still replace each one with its own saved message.
const { ContainerBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder, MessageFlags } = require('discord.js');
const { EMOJI, TYPE_EMOJI, TYPE_BAR } = require('./emojis');

const COLORS = {
  ban: 0xfe6465, hardban: 0xfe6465, tempban: 0xfe6465, softban: 0xfe6465,
  unban: 0xa5ea7a, unmute: 0xa5ea7a, unjail: 0xa5ea7a,
  kick: 0xfed53c, mute: 0xfed53c, tempmute: 0xfed53c, warn: 0xfed53c, jail: 0xfed53c,
};

const TITLE = {
  ban: 'Ban', hardban: 'Hardban', tempban: 'Tempban', softban: 'Softban', unban: 'Unban',
  kick: 'Kick', mute: 'Mute', tempmute: 'Tempmute', unmute: 'Unmute', warn: 'Warn', jail: 'Jail', unjail: 'Unjail',
};

// What a member reads in their DM: "You were ___ in <server>".
const VERB = {
  ban: 'banned from', hardban: 'permanently banned from', tempban: 'temporarily banned from', softban: 'softbanned from',
  unban: 'unbanned from', kick: 'kicked from', mute: 'muted in', tempmute: 'temporarily muted in', unmute: 'unmuted in',
  warn: 'warned in', jail: 'jailed in', unjail: 'released from jail in',
};

const REASON_LIMIT = 900;

function unix(value) {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function clip(text, limit) {
  const value = String(text ?? '').trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function mention(user) {
  const id = user?.id ?? String(user);
  return `<@${id}>`;
}

function iconOf(user, size = 256) {
  return user?.displayAvatarURL?.({ extension: 'png', size }) ?? null;
}

/** A detail line: the icon, a dim label and the value. */
function detail(icon, label, value) {
  return `${icon} ${label} **${value}**`;
}

/** The details of the sanction itself: moderator, when it ends and how many sanctions the member had before. */
function detailLines({ type, moderator, duration, expiresAt, previous, audience }) {
  const lines = [detail(EMOJI.FIELD_DOT, 'Moderator', mention(moderator))];
  const end = expiresAt ? unix(expiresAt) : null;
  if (end) lines.push(`${EMOJI.FIELD_CALENDAR} Ends <t:${end}:R> · <t:${end}:f>`);
  else if (duration) lines.push(detail(EMOJI.FIELD_CALENDAR, 'Duration', duration));
  else if (['ban', 'hardban'].includes(type)) lines.push(detail(EMOJI.FIELD_CALENDAR, 'Duration', 'Permanent'));
  if (audience === 'staff' && Number.isInteger(previous)) {
    lines.push(`${EMOJI.FIELD_NOTES} ${previous === 0 ? 'First sanction' : `${previous} earlier ${previous === 1 ? 'sanction' : 'sanctions'}`}`);
  }
  return lines;
}

/**
 * The card: title, the member (with their picture), the details and the reason below its own line. `audience` is `staff`
 * (the command reply and the log) or `member` (the DM, addressed to the member, with the server's name and picture).
 * `previous` is the number of earlier sanctions, when known.
 */
function buildSanctionCard({ type, caseNumber = null, guild = null, target = null, moderator = null, reason = null, duration = null, expiresAt = null, previous = null, audience = 'staff' }) {
  const emoji = TYPE_EMOJI[type] ?? EMOJI.ALERT;
  const bar = TYPE_BAR[type] ?? EMOJI.BAR_GRAY;
  const name = TITLE[type] ?? type;
  const heading = audience === 'member'
    ? `### ${emoji} You were ${VERB[type] ?? 'sanctioned in'} ${guild?.name ?? 'the server'}`
    : `### ${emoji} ${name}${caseNumber != null ? ` · Case #${caseNumber}` : ''}`;

  const who = audience === 'staff' ? [`**${mention(target)}** · \`${target?.id ?? target}\``, 'ㅤ'] : [];
  const quoted = [...who, ...detailLines({ type, moderator, duration, expiresAt, previous, audience })].map((l, i) => (i === 0 && audience === 'staff' ? `> ${l}` : `> -# ${l}`)).join('\n');
  const body = new TextDisplayBuilder().setContent(quoted);
  const picture = audience === 'member' ? guild?.iconURL?.({ extension: 'png', size: 256 }) : iconOf(target);
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large);

  const container = new ContainerBuilder().setAccentColor(COLORS[type] ?? 0x4b4f59)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(heading))
    .addSeparatorComponents(divider());
  if (picture) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(body).setThumbnailAccessory(new ThumbnailBuilder().setURL(picture)));
  else container.addTextDisplayComponents(body);
  container
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${bar} ${EMOJI.FIELD_REASON} **REASON** OF THE SANCTION\n> ${clip(reason || 'No reason provided.', REASON_LIMIT).replace(/\n/g, '\n> ')}`));

  const footer = audience === 'member'
    ? `-# ${caseNumber != null ? `Case #${caseNumber} · ` : ''}${guild?.name ?? ''}${guild?.memberCount ? ` · ${guild.memberCount} members` : ''}`
    : `-# ${guild?.name ?? ''} · <t:${Math.floor(Date.now() / 1000)}:f>`;
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
  return container;
}

const DONE = {
  ban: 'banned', hardban: 'permanently banned', tempban: 'temporarily banned', softban: 'softbanned', unban: 'unbanned',
  kick: 'kicked', mute: 'muted', tempmute: 'temporarily muted', unmute: 'unmuted', warn: 'warned', jail: 'jailed', unjail: 'released from jail',
};

/** What the moderator sees right after using the command: one line about what was done and a small one with the reason. */
function buildSanctionConfirm({ type, caseNumber = null, target = null, moderator = null, reason = null, duration = null, expiresAt = null }) {
  const emoji = TYPE_EMOJI[type] ?? EMOJI.ALERT;
  const end = expiresAt ? unix(expiresAt) : null;
  const when = end ? ` until <t:${end}:f>` : duration ? ` for ${duration}` : '';
  const text = [
    `${emoji}  ${mention(target)} has been **${DONE[type] ?? 'sanctioned'}**${when}${caseNumber != null ? ` · Case #${caseNumber}` : ''}`,
    `-# Reason: \`${clip(reason || 'No reason provided.', 300).replace(/`/g, "'")}\`${moderator ? ` · by ${mention(moderator)}` : ''}`,
  ].join('\n');
  return new ContainerBuilder().setAccentColor(COLORS[type] ?? 0x4b4f59).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

/** The same card as something `.send()` or a webhook takes. */
function sanctionPayload(options) {
  return { components: [buildSanctionCard(options)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

module.exports = { buildSanctionCard, buildSanctionConfirm, sanctionPayload, COLORS, TITLE, VERB };

// Every direct message that Petto starts says who it is FROM and carries three small buttons: about it (the "i"), delete it (the bin) and report it
// to the Petto team (the warning). One place does it: `sendDm(target, payload, { guild, kind })` is how Petto messages a person, and `installDmOrigin`
// puts the same step in `User#send` and `GuildMember#send` as a net, so a message that forgot to use `sendDm` still carries the line and the buttons
// (from the server of the member, or "Petto" when the server is not known).
//
// What it is NOT for: messages to channels of a server, to the channels of the team, to webhooks, the answers to something a person typed in the
// direct messages with the bot (they have no server), and the receipts of a report (`plain: true`).
//
// The three shapes of a message:
//  - a plain text or embeds: the line goes first in `content` (`-# From <server>`: grey, small), the buttons are one more row;
//  - a Components V2 message (no `content` allowed): the line is a small text as the FIRST component and the row goes last;
//  - when the message is already at a limit (5 rows, 2000 characters of content, 40 components, 4000 characters of text) something goes, never the
//    message: first the buttons or the line, whichever does not fit, the line before the message.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, TextDisplayBuilder } = require('discord.js');
const { EMOJI } = require('./emojis');
const logger = require('./logger');
const { t, peekGuildLanguage } = require('../i18n');

const ORIGIN = Symbol.for('petto.dmOrigin'); // on a payload: { guild, kind, lang, plain } for the step that sends it
const DONE = Symbol.for('petto.dmOrigin.done'); // on a payload: it already went through `decorate`
const HOOK = Symbol.for('petto.dmOrigin.hook');

const PREFIX = Object.freeze({ info: 'dminfo', delete: 'dmdel', report: 'dmrep' });
const MODAL_PREFIX = 'dmrepm';
const TEAM_PREFIX = 'dmteam';

/** Why a message was sent, short; `info` says it in words (`dm.kind.<kind>`). Anything else is `notice`. */
const KINDS = Object.freeze([
  'welcome', 'sanction', 'appeal', 'form', 'ticket', 'giveaway', 'verify', 'level', 'suggestion', 'report', 'confession', 'setup', 'security',
  'backup', 'embed', 'custom', 'team', 'notice',
]);

const LIMITS = Object.freeze({ rows: 5, components: 40, text: 4000, content: 2000, name: 60 });
const ROW_COMPONENTS = 4; // the row and its three buttons count against the 40 of a message

const kindOf = (value) => (KINDS.includes(value) ? value : 'notice');
const guildIdOf = (guild) => (/^[1-9]\d{0,24}$/.test(String(guild?.id ?? '')) ? String(guild.id) : null);

/** The name of a server as it can be written in a line: one line, clipped, markdown and mentions made harmless, never a link. */
function safeName(name, fallback = '') {
  const flat = String(name ?? '').replace(/\s+/g, ' ').trim();
  const clipped = [...flat].slice(0, LIMITS.name).join('').trim();
  if (!clipped) return fallback;
  return clipped
    .replace(/[\\*_~|`[\]()]/g, (char) => `\\${char}`)
    .replace(/@/g, '@​')
    .replace(/</g, '<​')
    .replace(/:\/\//g, ':​//')
    .replace(/\b(discord)\.(gg|com)\b/gi, '$1​.$2');
}

/** `-# From <server>` (grey and small), or `-# From Petto` when the message does not come from a server. */
function originText(guild, lang) {
  const name = safeName(guild?.name);
  return `-# ${guildIdOf(guild) && name ? t(lang, 'dm.origin.from', { server: name }) : t(lang, 'dm.origin.petto')}`;
}

/** `dminfo:<guildId>:<kind>`: the server is only used to look up what is public about it, never to decide who may do something. */
function customId(action, guild, kind) {
  return `${PREFIX[action]}:${guildIdOf(guild) ?? '0'}:${kindOf(kind)}`;
}

function parseCustomId(id) {
  const match = /^(dminfo|dmdel|dmrep):(\d{1,25}):([a-z_]{1,16})$/.exec(String(id ?? ''));
  if (!match) return null;
  const action = Object.keys(PREFIX).find((key) => PREFIX[key] === match[1]);
  return { action, guildId: match[2] === '0' ? null : match[2], kind: kindOf(match[3]) };
}

/** The row with the three small buttons, no text, in the colors of the secondary buttons. */
function buttonRow(guild, kind) {
  const button = (action, emoji) => new ButtonBuilder().setCustomId(customId(action, guild, kind)).setStyle(ButtonStyle.Secondary).setEmoji(emoji);
  return new ActionRowBuilder().addComponents(button('info', EMOJI.INFO), button('delete', EMOJI.DELETE), button('report', EMOJI.REPORT));
}

const json = (component) => (typeof component?.toJSON === 'function' ? component.toJSON() : component);

/** How many components (every nested one counts) and characters of text a list of components holds. */
function measure(components = []) {
  let count = 0;
  let text = 0;
  const walk = (node) => {
    const data = json(node);
    if (!data || typeof data !== 'object') return;
    count += 1;
    if (data.type === 10 && typeof data.content === 'string') text += data.content.length;
    for (const child of data.components ?? []) walk(child);
    if (data.accessory) walk(data.accessory);
  };
  for (const component of components) walk(component);
  return { count, text };
}

function isV2(body) {
  try {
    if (Number(typeof body.flags === 'object' && body.flags !== null && 'bitfield' in body.flags ? body.flags.bitfield : body.flags) & MessageFlags.IsComponentsV2) return true;
    if (Array.isArray(body.flags) && body.flags.includes('IsComponentsV2')) return true;
  } catch { /* an odd flags value: read as not V2 */ }
  return false;
}

/** Whether a message already has the buttons (it was decorated before, or it is a copy of one). */
function hasRow(components = []) {
  return components.some((row) => (json(row)?.components ?? []).some((item) => String(json(item)?.custom_id ?? '').startsWith(`${PREFIX.info}:`)));
}

/** A payload with the origin steps taken out of it (the marks are not for Discord). */
function clean(body) {
  const { [ORIGIN]: ignored, [DONE]: alsoIgnored, ...rest } = body;
  void ignored; void alsoIgnored;
  return rest;
}

/** Tells the step that sends the message where it comes from: `{ guild, kind, lang, plain }`. The payload is copied. */
function withOrigin(payload, origin) {
  const body = typeof payload === 'string' ? { content: payload } : { ...payload };
  body[ORIGIN] = { ...(body[ORIGIN] ?? {}), ...origin };
  return body;
}

/**
 * The message with the line and the buttons. `guild` null (or without id) means Petto itself. Nothing is changed in the payload that was given.
 * `plain: true` returns the message as it is.
 */
function decorate(payload, options = {}) {
  const tag = (typeof payload === 'object' && payload !== null ? payload[ORIGIN] : null) ?? {};
  const body = typeof payload === 'string' ? { content: payload } : clean({ ...payload });
  const plain = options.plain ?? tag.plain ?? false;
  if (plain || (typeof payload === 'object' && payload?.[DONE]) || hasRow(body.components)) return { ...body, [DONE]: true };

  const guild = 'guild' in options ? options.guild : tag.guild ?? null;
  const kind = kindOf(options.kind ?? tag.kind);
  const lang = options.lang ?? tag.lang ?? (guildIdOf(guild) ? peekGuildLanguage(guild.id) : 'en');
  const line = originText(guild, lang);
  const components = Array.isArray(body.components) ? body.components : [];
  const v2 = isV2(body);
  const { count, text } = measure(components);
  const content = typeof body.content === 'string' ? body.content : '';

  // Both, then only the line, then only the buttons, then neither: the message itself always goes.
  const fits = (withLine, withRow) => {
    if (v2) return count + (withLine ? 1 : 0) + (withRow ? ROW_COMPONENTS : 0) <= LIMITS.components && text + (withLine ? line.length : 0) <= LIMITS.text;
    if (withRow && components.length >= LIMITS.rows) return false;
    return !withLine || content.length + line.length + (content ? 1 : 0) <= LIMITS.content;
  };
  const choice = [[true, true], [true, false], [false, true], [false, false]].find(([withLine, withRow]) => fits(withLine, withRow)) ?? [false, false];
  const [withLine, withRow] = choice;

  const out = { ...body, [DONE]: true };
  if (withRow) out.components = v2 ? [...(withLine ? [new TextDisplayBuilder().setContent(line)] : []), ...components, buttonRow(guild, kind)] : [...components, buttonRow(guild, kind)];
  else if (withLine && v2) out.components = [new TextDisplayBuilder().setContent(line), ...components];
  if (withLine && !v2) out.content = content ? `${line}\n${content}` : line;
  return out;
}

/** The server a send to `target` is on behalf of, when the target says it (a member does). */
const guildOfTarget = (target) => target?.guild ?? null;

/**
 * Sends `payload` as a direct message to a user, a member or a direct-message channel, with the line and the buttons.
 * `guild`: the server it is on behalf of (a member's own server when not given; null for Petto). `kind`: why it is sent (KINDS).
 * Returns what `send` returns; with no target it returns null. A failure of the decoration only means the message goes as it was.
 */
async function sendDm(target, payload, options = {}) {
  if (!target || typeof target.send !== 'function') return null;
  let body;
  try {
    const tag = (typeof payload === 'object' && payload !== null ? payload[ORIGIN] : null) ?? {};
    const guild = 'guild' in options ? options.guild : 'guild' in tag ? tag.guild : guildOfTarget(target);
    body = decorate(payload, { ...options, guild });
  } catch (error) {
    logger.warn({ action: 'dm-origin' }, `The origin of a direct message could not be added: ${error.message}`);
    try { body = typeof payload === 'string' ? { content: payload } : clean({ ...payload }); } catch { body = payload; } // as it was written, whatever it is
  }
  return target.send(body);
}

/** The net: `User#send` and `GuildMember#send` go through the same step. A message already decorated by `sendDm` is left alone. */
function installDmOrigin(classes = require('discord.js')) {
  for (const Structure of [classes.User, classes.GuildMember]) {
    const proto = Structure?.prototype;
    if (!proto || typeof proto.send !== 'function' || proto.send[HOOK]) continue;
    const original = proto.send;
    const hooked = function sendWithOrigin(options) {
      let next = options;
      try {
        if (options && typeof options === 'object' && options.constructor?.name === 'MessagePayload') next = options; // already built: left as it is
        else if (!(options && typeof options === 'object' && options[DONE])) next = decorate(options, { guild: options?.[ORIGIN] && 'guild' in options[ORIGIN] ? options[ORIGIN].guild : guildOfTarget(this) });
      } catch (error) {
        logger.warn({ action: 'dm-origin' }, `The origin of a direct message could not be added: ${error.message}`);
      }
      return original.call(this, next);
    };
    hooked[HOOK] = true;
    Object.defineProperty(proto, 'send', { value: hooked, writable: true, configurable: true, enumerable: false });
  }
}

module.exports = {
  ORIGIN, DONE, PREFIX, MODAL_PREFIX, TEAM_PREFIX, KINDS, LIMITS,
  kindOf, guildIdOf, safeName, originText, customId, parseCustomId, buttonRow, measure, withOrigin, decorate, sendDm, installDmOrigin,
};

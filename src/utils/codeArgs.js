// Reads what is typed after a command that takes an embed code, such as `!autoresponder add hi, {embed}$v{...} --reply`.
// The usual option reader splits the text on spaces and drops quotes and line breaks, which would change the code, so
// these commands read the raw text instead.

/** The text with its first `count` words (or quoted words) removed. */
function dropTokens(text, count) {
  let rest = String(text ?? '');
  for (let i = 0; i < count; i++) rest = rest.replace(/^\s*(?:"[^"]*"|'[^']*'|\S+)/, '');
  return rest.trim();
}

/**
 * Takes the `--flags` out of a text. Only the ones outside of braces count, so a `--word` inside an embed code stays.
 * `valued` lists the flags that take the next word as their value (`--mode exact`), the rest are on or off.
 */
function takeFlags(text, valued = []) {
  let source = String(text ?? '');
  const flags = {};
  // The flags at the very end count even when a block of the code lost its closing brace.
  const valuedNames = valued.join('|');
  for (;;) {
    const tail = (valuedNames ? new RegExp(`(?:^|\\s)--(${valuedNames})\\s+(\\S+)\\s*$`, 'i').exec(source) : null) ?? /(?:^|\s)--([a-z][a-z_-]*)\s*$/i.exec(source);
    if (!tail) break;
    const name = tail[1].toLowerCase().replace(/-/g, '_');
    if (!(name in flags)) flags[name] = tail[2] ?? true;
    source = source.slice(0, tail.index);
  }
  let kept = '';
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '{') depth++;
    else if (char === '}' && depth > 0) depth--;
    const at = /\s/.test(source[i - 1] ?? ' ');
    const match = depth === 0 && char === '-' && at ? /^--([a-z][a-z_-]*)(?=\s|$)/i.exec(source.slice(i)) : null;
    if (!match) { kept += char; i++; continue; }
    const name = match[1].toLowerCase().replace(/-/g, '_');
    i += match[0].length;
    if (valued.includes(name)) {
      const value = /^\s+(\S+)/.exec(source.slice(i));
      if (value) { flags[name] = value[1]; i += value[0].length; } else flags[name] = true;
    } else {
      flags[name] = true;
    }
  }
  return { text: kept.replace(/[ \t]+$/g, '').trim(), flags };
}

/**
 * Splits `trigger, reply` or `"trigger" reply` or `trigger reply`. With a comma the trigger can have spaces, as long as
 * the comma comes before any block of the code. Without it the trigger is the first word.
 */
function splitTrigger(text) {
  const value = String(text ?? '').trim();
  const quoted = /^(?:"([^"]+)"|'([^']+)')\s*,?\s*([\s\S]*)$/.exec(value);
  if (quoted) return { trigger: (quoted[1] ?? quoted[2]).trim(), reply: quoted[3].trim() };
  const brace = value.indexOf('{');
  const comma = value.search(/,(?=\s|$)/);
  if (comma > 0 && (brace === -1 || comma < brace)) return { trigger: value.slice(0, comma).trim(), reply: value.slice(comma + 1).trim() };
  const first = /^(\S+)\s*([\s\S]*)$/.exec(value);
  return first ? { trigger: first[1], reply: first[2].trim() } : { trigger: '', reply: '' };
}

const FLAG_VALUES = ['mode', 'embed_template'];
const FLAG_MODES = new Set(['contains', 'startsWith', 'endsWith', 'exact', 'regex']);

/** The options of `autoresponder add` or `edit` from the raw text. Flags: --reply --delete --ping --previous --strict --not_strict --mode x --embed_template x */
function autoresponderFlags(flags) {
  const values = {};
  if (flags.reply) values.reply_to_message = true;
  if (flags.delete) values.delete_trigger = true;
  if (flags.ping) values.ping_user = true;
  if (flags.previous) values.delete_previous = true;
  if (flags.strict) values.mode = 'exact';
  if (flags.not_strict) values.mode = 'contains';
  const mode = typeof flags.mode === 'string' ? [...FLAG_MODES].find((each) => each.toLowerCase() === flags.mode.toLowerCase()) : null;
  if (mode) values.mode = mode;
  if (typeof flags.embed_template === 'string') values.embed_template = flags.embed_template;
  return values;
}

function autoresponderAdd(text) {
  const { text: body, flags } = takeFlags(text, FLAG_VALUES);
  const { trigger, reply } = splitTrigger(body);
  const values = autoresponderFlags(flags);
  if (trigger) values.trigger = trigger;
  if (reply) values.reply = reply;
  return values;
}

function autoresponderEdit(text) {
  const { text: body, flags } = takeFlags(text, FLAG_VALUES);
  const match = /^(\S+)\s*,?\s*([\s\S]*)$/.exec(body);
  const values = autoresponderFlags(flags);
  if (match) {
    values.id = match[1];
    if (match[2].trim()) values.reply = match[2].trim();
  }
  return values;
}

const MESSAGE_LINK = /^https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d+|@me)\/(\d+)\/(\d+)\/?$/i;

/**
 * The message an edit points at, from `https://discord.com/channels/guild/channel/message`, `channel/message`, `#channel message`
 * or a message id, and the code that follows it. `target` is empty when the command is a reply to the message.
 */
function messageTarget(token) {
  const value = String(token ?? '').trim();
  const link = MESSAGE_LINK.exec(value);
  if (link) return { guildId: link[1], channelId: link[2], messageId: link[3] };
  const pair = /^(?:<#)?(\d{15,25})>?[\/\s](\d{15,25})$/.exec(value);
  if (pair) return { guildId: null, channelId: pair[1], messageId: pair[2] };
  if (/^\d{15,25}$/.test(value)) return { guildId: null, channelId: null, messageId: value };
  return null;
}

function editMessage(text) {
  const body = String(text ?? '').trim();
  const channel = /^<#(\d{15,25})>\s+(\d{15,25})(?:\s+|$)/.exec(body);
  if (channel) return { message: `${channel[1]}/${channel[2]}`, code: body.slice(channel[0].length).trim() };
  const first = /^(\S+)(?:\s+|$)/.exec(body);
  if (first && messageTarget(first[1])) return { message: first[1], code: body.slice(first[0].length).trim() };
  return { code: body };
}

const CHANNEL_LINK = /^https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/\d+\/(\d{15,25})\/?$/i;
/** A name as people write it: lower case, without accents, emojis or the signs servers put around names (`📢・anuncios` is `anuncios`). */
const looseName = (name) => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The channel of the server named `name` (exactly, or the same letters without the emojis and signs around them), or null. */
function channelByName(guild, name) {
  const channels = guild?.channels?.cache;
  if (!channels || !name) return null;
  const wanted = String(name).toLowerCase();
  const loose = looseName(name);
  const usable = [...channels.values()].filter((channel) => channel?.isTextBased?.() && !channel.isDMBased?.());
  return usable.find((channel) => String(channel.name).toLowerCase() === wanted) ?? (loose ? usable.find((channel) => looseName(channel.name) === loose) : null) ?? null;
}

/**
 * The channel a word points at: `<#id>`, an id, a link to the channel, `#name` or a name. A mention, an id, a link or `#name` is always taken
 * as a channel (`resolved` false when the server has none of that); a bare word only when the server has a channel of that name.
 */
function channelWord(word, guild) {
  const value = String(word ?? '').trim();
  const id = /^<#(\d{15,25})>$/.exec(value)?.[1] ?? /^(\d{15,25})$/.exec(value)?.[1] ?? CHANNEL_LINK.exec(value)?.[1];
  if (id) return { id, explicit: true };
  if (/^#[^\s#]{1,100}$/.test(value)) {
    const found = channelByName(guild, value.slice(1));
    return { id: found?.id ?? null, explicit: true };
  }
  const found = /^[^\s{}<>@]{1,100}$/.test(value) ? channelByName(guild, value) : null;
  return found ? { id: found.id, explicit: false } : null;
}

/**
 * `!send [#channel] the message` (and `!send the message #channel`, the order the help of the command showed): the channel and the message
 * with its line breaks. The channel is a mention, an id, a link, `#name` or the name of a channel of the server (`message` is the Discord
 * message, to find the names). A channel that was written but does not exist comes back as `channel_missing`, so the command says so
 * instead of sending to the channel it was typed in.
 */
function sendMessage(text, message = null) {
  const body = String(text ?? '').trim();
  const guild = message?.guild ?? null;
  const first = /^(\S+)(?:\s+|$)/.exec(body);
  const leading = first ? channelWord(first[1], guild) : null;
  // A bare word that is the name of a channel only counts when something follows it (or files go with it): `!send hola` is a message.
  if (leading && (leading.explicit || body.slice(first[0].length).trim() || message?.attachments?.size)) {
    const rest = body.slice(first[0].length).trim();
    return leading.id ? { channel: leading.id, message: rest } : { channel_missing: first[1], message: rest };
  }
  // The channel at the end, outside of an embed code: a mention, a link or `#name`.
  const last = /\s(\S+)$/.exec(body);
  if (last && !/[{}]/.test(body.slice(last.index))) {
    const trailing = channelWord(last[1], guild);
    if (trailing?.explicit && trailing.id && !/^\d+$/.test(last[1])) return { channel: trailing.id, message: body.slice(0, last.index).trim() };
  }
  return { message: body };
}

/** `action rest of the text`, keeping the line breaks of the rest (for `quests method text ...` and `quests thread name ...`). */
function actionAndText(text) {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(String(text ?? '').trim());
  if (!match) return {};
  return match[2]?.trim() ? { action: match[1], value: match[2].trim() } : { action: match[1] };
}

module.exports = { actionAndText, dropTokens, takeFlags, splitTrigger, autoresponderAdd, autoresponderEdit, messageTarget, editMessage, sendMessage, channelWord, channelByName };

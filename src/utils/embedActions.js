// The buttons of an embed code that do something when they are clicked: give, take or toggle a role, and answer with
// a saved embed (privately, in the channel or in the DMs of who clicked). The code writes them as
//   {button: green && Get the role && role:@Members}
//   {button: blurple && Rules && embed:rules:ephemeral && addrole:@Verified}
// A button keeps what it does in its custom id (`eb:t123;er-rules#0`), so nothing is stored apart from the message.
const { ButtonStyle } = require('discord.js');

const PREFIX = 'eb:';
const MAX_ID = 100;
const MAX_ACTIONS = 4;
const MODES = { ephemeral: 'e', private: 'e', public: 'p', channel: 'p', dm: 'd' };
const MODE_NAMES = { e: 'ephemeral', p: 'public', d: 'dm' };
const ACTION_RE = /^(role|addrole|removerole|embed)\s*:\s*(.+)$/i;
const TEMPLATE_NAME_RE = /^[a-z0-9_-]{1,32}$/;
const STYLES = {
  blurple: ButtonStyle.Primary, primary: ButtonStyle.Primary,
  green: ButtonStyle.Success, success: ButtonStyle.Success,
  grey: ButtonStyle.Secondary, gray: ButtonStyle.Secondary, secondary: ButtonStyle.Secondary,
  red: ButtonStyle.Danger, danger: ButtonStyle.Danger,
};
const ROLE_LETTER = { role: 't', addrole: 'a', removerole: 'r' };
const LETTER_ROLE = { t: 'role', a: 'addrole', r: 'removerole' };

/** `role:@Members` or `embed:rules:dm` as `{ type, ref, mode }`, or null when the text is not an action. */
function parseAction(text) {
  const found = ACTION_RE.exec(String(text ?? '').trim());
  if (!found) return null;
  const type = found[1].toLowerCase();
  const value = found[2].trim();
  if (type !== 'embed') return { type, ref: value, mode: null };
  const [name, mode = 'ephemeral'] = value.split(':').map((part) => part.trim().toLowerCase());
  if (!TEMPLATE_NAME_RE.test(name ?? '') || !MODES[mode]) return null;
  return { type, ref: name, mode: MODE_NAMES[MODES[mode]] };
}

/** A role from what an embed code or the dashboard gives: a mention, an id or the name. */
function resolveRole(guild, ref) {
  const text = String(ref ?? '').trim();
  const id = /^<@&(\d{15,25})>$/.exec(text)?.[1] ?? (/^\d{15,25}$/.test(text) ? text : null);
  if (id) return guild.roles.cache.get(id) ?? null;
  const name = text.replace(/^@/, '').toLowerCase();
  if (!name) return null;
  return guild.roles.cache.find((role) => role.id !== guild.id && role.name.toLowerCase() === name) ?? null;
}

/** The custom id for the actions of a button, or null when there is nothing valid to keep (a role that is gone, an id too long). */
function encodeActions(actions, guild, index = 0) {
  if (!guild || !Array.isArray(actions)) return null;
  const segments = [];
  let hasEmbed = false;
  for (const action of actions.slice(0, MAX_ACTIONS)) {
    if (!action || typeof action !== 'object') continue;
    if (action.type === 'embed') {
      const name = String(action.ref ?? '').toLowerCase();
      const mode = MODES[String(action.mode ?? 'ephemeral').toLowerCase()] ?? 'e';
      if (hasEmbed || !TEMPLATE_NAME_RE.test(name)) continue;
      hasEmbed = true;
      segments.push(`e${mode}${name}`);
    } else if (ROLE_LETTER[action.type]) {
      const role = resolveRole(guild, action.ref);
      if (role) segments.push(`${ROLE_LETTER[action.type]}${role.id}`);
    }
  }
  if (!segments.length) return null;
  const id = `${PREFIX}${segments.join(';')}#${index.toString(36)}`;
  return id.length <= MAX_ID ? id : null;
}

/** What a custom id asks for: the roles to toggle, give and take, and the saved embed to answer with. Null when it is not one of these. */
function decodeCustomId(customId) {
  if (!String(customId ?? '').startsWith(PREFIX)) return null;
  const body = customId.slice(PREFIX.length).replace(/#[0-9a-z]+$/, '');
  const out = { toggle: [], add: [], remove: [], embed: null };
  for (const segment of body.split(';')) {
    const letter = segment[0];
    if (letter === 'e') {
      const mode = MODE_NAMES[segment[1]];
      const name = segment.slice(2);
      if (mode && TEMPLATE_NAME_RE.test(name)) out.embed = { mode, name };
    } else if (LETTER_ROLE[letter] && /^\d{15,25}$/.test(segment.slice(1))) {
      out[{ t: 'toggle', a: 'add', r: 'remove' }[letter]].push(segment.slice(1));
    }
  }
  return out;
}

/** The roles an embed code asks to give or take, so that a sender can check it may. */
function roleRefsOf(buttons) {
  const refs = [];
  for (const row of buttons ?? []) {
    for (const button of Array.isArray(row) ? row : [row]) {
      for (const action of button?.actions ?? []) if (ROLE_LETTER[action?.type]) refs.push(action.ref);
    }
  }
  return refs;
}

module.exports = { PREFIX, MAX_ACTIONS, STYLES, parseAction, resolveRole, encodeActions, decodeCustomId, roleRefsOf };

// i18n-ignore-file: the syntax of a silent mention, not text for people.
// Silent mentions: a `!` right before a mention (`!@everyone`, `!@here`, `!@Moderators`, `!<@&id>`, `!<@id>`) makes it show as the
// normal blue pill and notify nobody. The `!` is taken out of what is sent and the mention is left out of the message's
// `allowedMentions`, which is what Discord uses to decide who is notified.
//
// This module is pure: `applySilentMentions(payload, guild)` takes the options of a send (the object given to `channel.send`,
// `message.edit`, `interaction.editReply`, `webhook.send`...) and gives back the payload to send. It runs as the LAST step, on the
// final text, so a variable (`!{user.mention}`) has already been expanded. utils/silentMentionsHook.js puts it where every send of
// the library meets.
//
//   `!` + `@everyone` | `@here` | `<@&id>` | `<@id>` | `<@!id>` | `@Role` | `@"Role with spaces"`  -> silent mention
//   `!` + `<#id>`                                                                                    -> only the `!` is removed
//   `\!` + any of them                                                                               -> `!` and the mention as plain text
//
// The `!` counts only at the start of the text or after a space, a line break or punctuation (`hello!@here` is not silent), and never
// inside inline code or a code block (Discord does not make a mention there either).
const ZWSP = '​';
const WORD = /[\p{L}\p{N}_]/u;
const WORD_END = /[\p{L}\p{N}_]$/u;
const CODE = /(```[\s\S]*?```|`[^`]+`)/;
const TAIL = /[.,;:!?)\]}>*_~|"'`]$/;

const SILENT = /(\\)?!(@everyone(?![\p{L}\p{N}_])|@here(?![\p{L}\p{N}_])|<@&(\d{15,22})>|<@!?(\d{15,22})>|<#\d{15,22}>|@"([^"\n]{1,100})"|@(\S+))/gu;
const NORMAL_ROLE = /<@&(\d{15,22})>/g;
const NORMAL_USER = /<@!?(\d{15,22})>/g;
const NORMAL_EVERYONE = /@(?:everyone|here)(?![\p{L}\p{N}_])/u;

const roleList = (guild) => { const roles = guild?.roles?.cache; return roles && typeof roles.values === 'function' ? [...roles.values()] : []; };

/** The role of the server called `name` (any case), the highest one when two share the name. The `@everyone` role is not found by name. */
function findRole(guild, name) {
  const wanted = String(name).toLowerCase();
  let best = null;
  for (const role of roleList(guild)) {
    if (role.id === guild.id || String(role.name).toLowerCase() !== wanted) continue;
    if (!best || (role.position ?? 0) > (best.position ?? 0)) best = role;
  }
  return best;
}

/** `@Name` written without quotes: the whole word first, then without the punctuation that can follow it (`!@Moderators,`). */
function findRoleInWord(guild, word) {
  let candidate = word;
  while (candidate) {
    const role = findRole(guild, candidate);
    if (role) return { role, rest: word.slice(candidate.length) };
    if (!TAIL.test(candidate)) return null;
    candidate = candidate.slice(0, -1);
  }
  return null;
}

/**
 * What one `!` + mention turns into: `{ out }` (the text that replaces it, or null to leave it as it was) and `silent`, the mention
 * that must stay out of the notifications. `escaped` is a `\!` in front: the text is shown, not a mention.
 */
function decide(match, escaped, token, roleId, userId, quoted, word, offset, text, guild) {
  if (escaped) {
    // The `!` stays and the mention is cut with an invisible character, so it is plain text even when another mention of the message notifies.
    if (token.startsWith('@')) return { out: `!@${ZWSP}${token.slice(1)}`, kind: 'escaped' };
    return { out: `!<${ZWSP}${token.slice(1)}`, kind: 'escaped' };
  }
  if (offset > 0 && WORD_END.test(text.slice(Math.max(0, offset - 2), offset))) return { out: null, kind: 'keep' };
  if (token === '@everyone' || token === '@here') return { out: token, kind: 'silent', everyone: true };
  if (roleId) return { out: token, kind: 'silent', role: roleId };
  if (userId) return { out: token, kind: 'silent', user: userId };
  if (token.startsWith('<#')) return { out: token, kind: 'channel' };
  if (quoted !== undefined) {
    const role = findRole(guild, quoted);
    return role ? { out: `<@&${role.id}>`, kind: 'silent', role: role.id } : { out: null, kind: 'keep' };
  }
  const found = word !== undefined ? findRoleInWord(guild, word) : null;
  return found ? { out: `<@&${found.role.id}>${found.rest}`, kind: 'silent', role: found.role.id } : { out: null, kind: 'keep' };
}

/**
 * Rewrites one piece of text (outside of code). `acc.silent` collects the mentions that became silent. Returns `{ text, masked }`:
 * the new text, and the text with the silent and escaped mentions blanked out, to find the mentions that do notify.
 */
function rewrite(part, guild, acc, notifies) {
  const run = (collect) => part.replace(SILENT, (match, escaped, token, roleId, userId, quoted, word, offset, text) => {
    const result = decide(match, escaped, token, roleId, userId, quoted, word, offset, text, guild);
    if (result.kind === 'keep') return match;
    if (!collect) return ' ';
    if (!notifies) return result.out; // an embed never notifies: nothing is collected
    if (result.everyone) acc.silent.everyone = true;
    if (result.role) acc.silent.roles.add(result.role);
    if (result.user) acc.silent.users.add(result.user);
    return result.out;
  });
  const text = run(true);
  return { text, masked: run(false) };
}

/** Applies the rewrite to the text that is not code; `notifies` says whether the text can notify (a message, not an embed). */
function fixText(value, guild, acc, notifies) {
  if (typeof value !== 'string' || !value) return value;
  const pieces = value.includes('!') ? value.split(CODE) : null;
  if (!pieces) {
    if (notifies) acc.texts.push(value);
    return value;
  }
  let changed = false;
  const outs = pieces.map((piece, index) => {
    if (index % 2 === 1) return piece; // code
    const { text, masked } = rewrite(piece, guild, acc, notifies);
    if (text !== piece) changed = true;
    if (notifies) acc.texts.push(masked);
    return text;
  });
  return changed ? outs.join('') : value;
}

const isBuilder = (node) => node && typeof node.toJSON === 'function';
const json = (node) => (isBuilder(node) ? node.toJSON() : node);

function fixEmbed(embed, guild, acc) {
  if (!embed || typeof embed !== 'object') return embed;
  const raw = isBuilder(embed) ? (embed.data ?? embed.toJSON()) : embed;
  const next = {};
  const simple = (key) => { const out = fixText(raw[key], guild, acc, false); if (out !== raw[key]) next[key] = out; };
  simple('title');
  simple('description');
  if (Array.isArray(raw.fields)) {
    const fields = raw.fields.map((field) => {
      const name = fixText(field?.name, guild, acc, false);
      const value = fixText(field?.value, guild, acc, false);
      return name === field?.name && value === field?.value ? field : { ...field, name, value };
    });
    if (fields.some((field, index) => field !== raw.fields[index])) next.fields = fields;
  }
  if (raw.footer?.text) { const text = fixText(raw.footer.text, guild, acc, false); if (text !== raw.footer.text) next.footer = { ...raw.footer, text }; }
  if (raw.author?.name) { const name = fixText(raw.author.name, guild, acc, false); if (name !== raw.author.name) next.author = { ...raw.author, name }; }
  if (!Object.keys(next).length) return embed;
  return { ...(isBuilder(embed) ? embed.toJSON() : embed), ...next };
}

const TEXT_DISPLAY = 10;
const SECTION = 9;
const CONTAINER = 17;

/** A Components V2 node: the text of text displays, in sections and in containers (at any depth). Other components are not touched. */
function fixComponent(node, guild, acc) {
  if (!node || typeof node !== 'object') return node;
  const type = node.type ?? node.data?.type;
  if (type === TEXT_DISPLAY) {
    const content = node.content ?? node.data?.content;
    const out = fixText(content, guild, acc, true);
    return out === content ? node : { ...json(node), content: out };
  }
  if (type === SECTION || type === CONTAINER) {
    const children = node.components;
    if (!Array.isArray(children)) return node;
    const mapped = children.map((child) => fixComponent(child, guild, acc));
    if (!mapped.some((child, index) => child !== children[index])) return node;
    return { ...json(node), components: mapped.map(json) };
  }
  return node;
}

/** The mentions of the text that notify, read from the text that was left after the silent ones were blanked. */
function readNormal(texts) {
  const normal = { everyone: false, roles: new Set(), users: new Set() };
  for (const text of texts) {
    for (const match of text.matchAll(NORMAL_ROLE)) normal.roles.add(match[1]);
    for (const match of text.matchAll(NORMAL_USER)) normal.users.add(match[1]);
    if (NORMAL_EVERYONE.test(text)) normal.everyone = true;
  }
  return normal;
}

/**
 * The `allowedMentions` for a message with silent mentions, from the policy it had (`current`: the payload's own, or the default of the client).
 * It only ever takes notifications away. A message with a normal `@everyone` or `@here` and a silent one notifies: Discord decides that
 * for the whole message, so the silent one cannot be told apart.
 */
function reduceAllowed(current, silent, normal) {
  if (current === undefined || current === null) {
    // Nothing was said, so Discord would notify everything: only what is mentioned normally stays.
    return { parse: normal.everyone ? ['everyone'] : [], roles: [...normal.roles], users: [...normal.users] };
  }
  const out = { ...current };
  const parse = Array.isArray(current.parse) ? [...current.parse] : [];
  const drop = (kind) => { const at = parse.indexOf(kind); if (at >= 0) parse.splice(at, 1); };
  for (const [kind, hushed, loud] of [['users', silent.users, normal.users], ['roles', silent.roles, normal.roles]]) {
    if (!hushed.size) continue;
    if (parse.includes(kind)) {
      drop(kind);
      out[kind] = [...loud];
    } else if (Array.isArray(current[kind])) {
      out[kind] = current[kind].filter((id) => !hushed.has(String(id)) || loud.has(String(id)));
    }
  }
  if (silent.everyone && !normal.everyone) drop('everyone');
  if (current.parse !== undefined || parse.length) out.parse = parse;
  return out;
}

/**
 * The payload to send for `payload`, with its silent mentions applied: the `!` taken out, role names written as `@Name` turned into
 * mentions, and `allowedMentions` without the silent ones. A payload with no `!` mention comes back as the very same object. `guild`
 * is where role names are looked up (it can be null: the other forms still work). `options.defaults` is the `allowedMentions` the
 * client uses when the payload has none (`client.options.allowedMentions`); a payload that has none and a default that already
 * notifies nobody is left as it is, because silent mentions never add a notification.
 */
function applySilentMentions(payload, guild, options = {}) {
  if (typeof payload === 'string') {
    const result = applySilentMentions({ content: payload }, guild, options);
    return result.content === payload && result.allowedMentions === undefined ? payload : result;
  }
  if (!payload || typeof payload !== 'object') return payload;
  const acc = { silent: { everyone: false, roles: new Set(), users: new Set() }, texts: [] };
  const next = {};

  const content = fixText(payload.content, guild, acc, true);
  if (content !== payload.content) next.content = content;
  if (Array.isArray(payload.embeds)) {
    const embeds = payload.embeds.map((embed) => fixEmbed(embed, guild, acc));
    if (embeds.some((embed, index) => embed !== payload.embeds[index])) next.embeds = embeds;
  }
  if (Array.isArray(payload.components)) {
    const components = payload.components.map((component) => fixComponent(component, guild, acc));
    if (components.some((component, index) => component !== payload.components[index])) next.components = components;
  }
  if (!Object.keys(next).length) return payload;

  const result = { ...payload, ...next };
  const { silent } = acc;
  if (silent.everyone || silent.roles.size || silent.users.size) {
    const hadOwn = payload.allowedMentions !== undefined && payload.allowedMentions !== null;
    const current = hadOwn ? payload.allowedMentions : options.defaults;
    const allowed = reduceAllowed(current, silent, readNormal(acc.texts));
    if (hadOwn || JSON.stringify(allowed) !== JSON.stringify(current ?? null)) result.allowedMentions = allowed;
  }
  return result;
}

module.exports = { applySilentMentions, reduceAllowed, findRole, ZWSP };

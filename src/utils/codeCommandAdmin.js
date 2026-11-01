// Saving and checking custom commands written in code, for the command `!customcommand` and for the dashboard, so both follow
// the same rules and say the same things.
const { ensureGuild } = require('../db/guilds');
const { isHiddenWordFor } = require('./hiddenCommands');
const ccDb = require('../db/customCommands');
const { check, parse, closestName, functionNames, MAX_SOURCE_LENGTH } = require('../scripting');
const { dataFields } = require('./codeCommands');
const { getGuildPremium, getGuildLimits, PREMIUM_LIMITS } = require('../db/premium');
const { validateTrigger, invalidateTriggers, triggersFor, MAX_TRIGGERS_PER_GUILD } = require('./codeTriggers');
const { t, tn, currentLanguage } = require('../i18n');

const MAX_PER_GUILD = PREMIUM_LIMITS.customCommands; // the most any server can have (Premium); a Free server has less, see commandLimit
const NAME_SHAPE = /^[a-z0-9_-]{1,32}$/;

/** How many custom commands a server can have: Free 125, Premium 250 (db/premium.js). */
async function commandLimit(guildId) {
  const premium = await getGuildPremium(guildId).catch(() => ({ active: false }));
  return { limit: getGuildLimits(premium).customCommands, premium: Boolean(premium?.active) };
}

/** What to say when a server is full of custom commands. */
const fullMessage = ({ limit, premium }, lang = currentLanguage()) => t(lang, premium ? 'customcommands.full' : 'customcommands.fullFree', { limit, premium: PREMIUM_LIMITS.customCommands });

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The mistake in some code as a sentence, or null when the code is fine. */
function codeProblem(code, lang = currentLanguage()) {
  if (!code) return t(lang, 'customcommands.problem.noCode');
  if (code.length > MAX_SOURCE_LENGTH) return t(lang, 'customcommands.problem.tooLong', { count: code.length, max: MAX_SOURCE_LENGTH });
  const problem = check(code, lang);
  if (!problem) return null;
  return problem.line ? t(lang, 'customcommands.problem.mistakeAt', { message: problem.message, line: problem.line, column: problem.column }) : t(lang, 'customcommands.problem.mistake', { message: problem.message });
}

/** What an action of some code would do, as one line. */
function describeEffect(effect, lang = currentLanguage()) {
  const what = (e) => [e.content ? `"${clip(e.content.replace(/\s+/g, ' '), 80)}"` : null, e.embed ? t(lang, 'customcommands.effect.anEmbed') : null, e.components?.length ? t(lang, 'customcommands.effect.components') : null].filter(Boolean).join(` ${t(lang, 'common.and')} `);
  const hasData = effect.data !== null && effect.data !== undefined;
  switch (effect.type) {
    case 'message': return t(lang, effect.channelId ? 'customcommands.effect.messageTo' : 'customcommands.effect.messageHere', { what: what(effect), channel: `<#${effect.channelId}>` })
      + (effect.reply ? ` ${t(lang, 'customcommands.effect.asReply')}` : '') + (effect.silent ? ` ${t(lang, 'customcommands.effect.silent')}` : '');
    case 'dm': return t(lang, 'customcommands.effect.dm', { what: what(effect) });
    case 'addRole': return t(lang, 'customcommands.effect.addRole', { role: `<@&${effect.roleId}>` });
    case 'removeRole': return t(lang, 'customcommands.effect.removeRole', { role: `<@&${effect.roleId}>` });
    case 'reaction': return t(lang, 'customcommands.effect.reaction', { emoji: effect.emoji });
    case 'deleteTrigger': return effect.delay ? t(lang, 'customcommands.effect.deleteTriggerLater', { seconds: effect.delay }) : t(lang, 'customcommands.effect.deleteTrigger');
    case 'deleteResponse': return t(lang, 'customcommands.effect.deleteResponse', { seconds: effect.delay });
    case 'removeReaction': return t(lang, 'customcommands.effect.removeReaction');
    case 'modal': return t(lang, 'customcommands.effect.modal', { title: effect.modal.title });
    case 'respond': return t(lang, effect.ephemeral ? 'customcommands.effect.respondPrivate' : 'customcommands.effect.respond', { what: what(effect) });
    case 'update': return t(lang, 'customcommands.effect.update', { what: what(effect) });
    case 'execCC': {
      const key = effect.delay ? (hasData ? 'execLaterData' : 'execLater') : (hasData ? 'execData' : 'exec');
      return t(lang, `customcommands.effect.${key}`, { name: effect.name, seconds: effect.delay });
    }
    default: return effect.type;
  }
}

const snippet = (value, max) => clip(String(value ?? '').replace(/\s+/g, ' ').trim(), max);

/** The buttons and menus of a message as short lines: `Buttons: Yes, No` and `Menu: Pick one (3 options)`. */
function componentLines(rows, lang = currentLanguage()) {
  const lines = [];
  for (const row of rows ?? []) {
    const buttons = row.items.filter((item) => item.type !== 'select');
    if (buttons.length) lines.push(t(lang, 'customcommands.effect.buttons', { buttons: buttons.map((item) => `[${[item.emoji, item.label].filter(Boolean).join(' ')}]${item.url ? ` ${t(lang, 'customcommands.effect.link')}` : ''}`).join(' ') }));
    for (const menu of row.items.filter((item) => item.type === 'select')) {
      const placeholder = menu.placeholder ? `"${snippet(menu.placeholder, 60)}"` : t(lang, 'customcommands.effect.noPlaceholder');
      lines.push(tn(lang, 'customcommands.effect.menu', menu.options.length, { count: menu.options.length, placeholder, options: clip(menu.options.map((option) => option.label).join(', '), 120) }));
    }
  }
  return lines;
}

/**
 * What a message of some code would look like, as short lines for a test: the text, the embed (title, the start of the
 * description, fields, footer), the buttons and menus, and the reactions. A form says its title and its fields.
 */
function effectDetails(effect, lang = currentLanguage()) {
  if (effect.type === 'modal') return [t(lang, 'customcommands.effect.fields', { fields: effect.modal.fields.map((field) => `"${snippet(field.label, 45)}"${field.required ? '' : ` ${t(lang, 'customcommands.effect.optional')}`}`).join(', ') })];
  // A test never runs the other command: it only says what it would get in .ExecData.
  if (effect.type === 'execCC') return effect.data !== null && effect.data !== undefined ? [t(lang, 'customcommands.effect.data', { data: snippet(JSON.stringify(effect.data), 200) })] : [];
  if (!['message', 'dm', 'respond', 'update'].includes(effect.type)) return [];
  const lines = [];
  if (effect.content) lines.push(t(lang, 'customcommands.effect.text', { text: snippet(effect.content, 200) }));
  const embed = effect.embed;
  if (embed) {
    const parts = [
      embed.author?.name ? t(lang, 'customcommands.effect.embedAuthor', { name: snippet(embed.author.name, 40) }) : null,
      embed.title ? `**${snippet(embed.title, 80)}**` : null,
      embed.description ? `"${snippet(embed.description, 120)}"` : null,
      embed.fields?.length ? tn(lang, 'customcommands.effect.embedFields', embed.fields.length, { count: embed.fields.length }) : null,
      embed.image ? t(lang, 'customcommands.effect.embedImage') : null,
      embed.thumbnail ? t(lang, 'customcommands.effect.embedThumbnail') : null,
      embed.footer?.text ? t(lang, 'customcommands.effect.embedFooter', { text: snippet(embed.footer.text, 40) }) : null,
    ].filter(Boolean);
    lines.push(t(lang, 'customcommands.effect.embed', { parts: parts.length ? parts.join(' · ') : t(lang, 'customcommands.effect.embedEmpty') }));
  }
  lines.push(...componentLines(effect.components, lang));
  if (effect.reactions?.length) lines.push(t(lang, 'customcommands.effect.reactions', { emojis: effect.reactions.join(' ') }));
  return lines;
}

// ── Reading the code without running it ─────────────────────────────────────

/**
 * Walks the tree of some code and calls `visit(operand, rootDot)` for each operand. `rootDot` is true while the dot is still
 * the data: inside a `with` or a `range` the dot is something else.
 */
function walkOperands(nodes, visit, rootDot = true) {
  const pipeline = (commands, isRoot) => {
    for (const operands of commands ?? []) {
      for (const [index, operand] of operands.entries()) {
        visit(operand, isRoot, index === 0);
        if (operand.kind === 'paren') pipeline(operand.pipeline, isRoot);
      }
    }
  };
  for (const node of nodes ?? []) {
    if (node.type === 'Print' || node.type === 'Assign') pipeline(node.pipeline, rootDot);
    else if (node.type === 'If') {
      for (const branch of node.branches) { pipeline(branch.condition, rootDot); walkOperands(branch.body, visit, rootDot); }
      walkOperands(node.otherwise, visit, rootDot);
    } else if (node.type === 'With' || node.type === 'Range') {
      pipeline(node.pipeline, rootDot);
      walkOperands(node.body, visit, false);
      walkOperands(node.otherwise, visit, rootDot);
    }
  }
}

const parsed = (code) => { try { return parse(String(code ?? '')); } catch { return null; } };

/**
 * Names in some code that are most likely mistakes, found without running it: functions that do not exist and names that
 * are not in the data (`.User.Usrname`). Reading a name that is not there still gives nothing when the code runs; these are
 * only hints. Each one is { kind: 'function' | 'field', name, text }. Code with a mistake in how it is written gives none.
 */
function codeHintList(code, lang = currentLanguage()) {
  const tree = parsed(code);
  if (!tree) return [];
  const known = new Set(functionNames());
  const fields = dataFields();
  const hints = new Map();
  walkOperands(tree.nodes, (operand, rootDot) => {
    if (operand.kind === 'ident' && !known.has(operand.name) && !hints.has(`f:${operand.name}`)) {
      const meant = closestName(operand.name, known);
      hints.set(`f:${operand.name}`, { kind: 'function', name: operand.name, text: meant ? t(lang, 'customcommands.hintText.functionMeant', { name: operand.name, meant }) : t(lang, 'customcommands.hintText.function', { name: operand.name }) });
    }
    const fromData = (operand.kind === 'dot' && rootDot) || (operand.kind === 'variable' && operand.name === '$');
    if (!fromData || !operand.fields?.length) return;
    const [top, inner] = operand.fields;
    let path = null;
    let meant = null;
    if (!fields.top.includes(top)) {
      path = `.${top}`;
      meant = closestName(top, fields.top);
      meant = meant ? `.${meant}` : null;
    } else if (inner !== undefined && fields.maps[top] && !fields.maps[top].includes(inner)) {
      path = `.${top}.${inner}`;
      const close = closestName(inner, fields.maps[top]);
      const elsewhere = Object.keys(fields.maps).find((map) => map !== top && fields.maps[map].includes(inner));
      meant = close ? `.${top}.${close}` : elsewhere ? `.${elsewhere}.${inner}` : null;
    }
    if (!path || hints.has(`d:${path}`)) return;
    const last = path.split('.').length - 1 === operand.fields.length; // the end of the path gives nothing; a name after it stops the code
    const key = `customcommands.hintText.field${last ? 'Empty' : ''}${meant ? 'Meant' : ''}`;
    hints.set(`d:${path}`, { kind: 'field', name: path, text: t(lang, key, { path, meant }) });
  });
  return [...hints.values()].slice(0, 10);
}

/** The hints of some code as sentences (see codeHintList). */
const codeHints = (code, lang = currentLanguage()) => codeHintList(code, lang).map((hint) => hint.text);

const STORE_FUNCTIONS = /^db[A-Z]/;
const LOOKUP_FUNCTIONS = new Set(['getMember', 'getRole', 'getChannel', 'targetHasRole']);

/**
 * What some code uses, read without running it: the functions it calls (sorted) and whether it uses stored data, buttons or
 * menus, reactions, forms, roles, direct messages, reads members, roles and channels, or runs other commands. Null when the code has a mistake.
 */
function codeSummary(code) {
  const tree = parsed(code);
  if (!tree) return null;
  const known = new Set(functionNames());
  const used = new Set();
  let reactionWords = false;
  walkOperands(tree.nodes, (operand) => {
    if (operand.kind === 'ident' && known.has(operand.name)) used.add(operand.name);
    if (operand.kind === 'literal' && typeof operand.value === 'string' && ['reactions', 'reaction'].includes(operand.value.toLowerCase())) reactionWords = true;
    if ((operand.kind === 'dot' || operand.kind === 'variable') && operand.fields?.[0] === 'Reaction') reactionWords = true;
  });
  const has = (...names) => names.some((name) => used.has(name));
  return {
    functions: [...used].sort((a, b) => a.localeCompare(b)),
    storedData: [...used].some((name) => STORE_FUNCTIONS.test(name)),
    buttons: has('cbutton'),
    menus: has('cselect'),
    reactions: has('addReaction', 'addReactions', 'removeReaction') || reactionWords,
    forms: has('cmodal', 'showModal', 'ctext'),
    roles: has('addRole', 'removeRole'),
    directMessages: has('sendDM'),
    lookups: [...used].some((name) => LOOKUP_FUNCTIONS.has(name)),
    otherCommands: has('execCC'),
  };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The prefix that the first comment of some code says the command is used with: a comment such as "req: .req <what you ask>" says `.`
 * for the word `req`. Returns { prefix, word } or null, so a command saved without that prefix can be warned about.
 */
function prefixHint(name, code) {
  const comment = /^\s*\{\{-?\s*\/\*([\s\S]*?)\*\/\s*-?\}\}/.exec(String(code ?? ''));
  if (!comment) return null;
  for (const word of new Set([name, name.replace(/\d+$/, '')].filter(Boolean))) {
    const found = new RegExp(`(?:^|[\\s(])([^\\w\\s{}()\\[\\]<>*/"'\`:,;]{1,5})${escapeRegExp(word)}(?![\\w-])`).exec(comment[1]);
    if (found) return { prefix: found[1], word };
  }
  return null;
}

const isRealCommand = (client, name, userId = null) => !isHiddenWordFor(client, name, userId) && (client.commands.has(name) || client.commandAliases.has(name) || Boolean(client.commandRoutes?.has(name) && !client.commandRoutes.get(name).short)); // a short alias (`!is`) gives way to a word the server chose

/**
 * Saves the code of a command after checking everything. Returns { ok: true, created } or { ok: false, message, field? }.
 * The person who asked must already have been allowed to write code.
 */
async function saveCodeCommand({ guild, client, userId, name, code, lang = currentLanguage() }) {
  if (isRealCommand(client, name, userId)) return { ok: false, field: 'name', message: t(lang, 'customcommands.realCommand', { name }) };
  if (!NAME_SHAPE.test(name)) return { ok: false, field: 'name', message: t(lang, 'customcommands.nameShape') };
  const problem = codeProblem(code, lang);
  if (problem) return { ok: false, field: 'code', message: problem };
  await ensureGuild(guild.id);
  const existing = await ccDb.getCommand(guild.id, name);
  if (!existing) {
    const current = await ccDb.listCommands(guild.id);
    const allowed = await commandLimit(guild.id);
    if (current.length >= allowed.limit) return { ok: false, field: 'name', message: fullMessage(allowed, lang) };
  }
  await ccDb.upsertCommand(guild.id, name, { response: null, embedTemplate: null, code, createdBy: userId });
  return { ok: true, created: !existing };
}

/** Changes what starts a command. Returns { ok: true, type, text } or { ok: false, message }. */
async function setCommandTrigger({ guild, client, name, type, text, lang = currentLanguage() }) {
  const row = await ccDb.getCommand(guild.id, name);
  if (!row) return { ok: false, message: t(lang, 'customcommands.notExist', { name }) };
  const checked = validateTrigger(type, text, lang);
  if (checked.error) return { ok: false, message: checked.error };
  if (type !== 'command') {
    const current = await triggersFor(guild.id);
    if (!current.some((entry) => entry.name === name) && current.length >= MAX_TRIGGERS_PER_GUILD) {
      return { ok: false, message: t(lang, 'customcommands.trigger.tooMany', { max: MAX_TRIGGERS_PER_GUILD }) };
    }
    if (type === 'prefix' && (client.commands.has(`${checked.text}${name}`) || client.commandAliases.has(`${checked.text}${name}`))) {
      return { ok: false, message: t(lang, 'customcommands.trigger.realCommand') };
    }
  }
  await ccDb.setTrigger(guild.id, name, type, checked.text);
  invalidateTriggers(guild.id);
  return { ok: true, type, text: checked.text };
}

module.exports = { MAX_PER_GUILD, commandLimit, fullMessage, NAME_SHAPE, codeProblem, describeEffect, effectDetails, codeHints, codeHintList, codeSummary, saveCodeCommand, setCommandTrigger, isRealCommand, prefixHint };

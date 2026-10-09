// Saving and checking custom commands written in code, for the command `!customcommand` and for the dashboard, so both follow
// the same rules and say the same things.
const { ensureGuild } = require('../db/guilds');
const ccDb = require('../db/customCommands');
const { check, parse, closestName, functionNames, MAX_SOURCE_LENGTH } = require('../scripting');
const { dataFields } = require('./codeCommands');
const { getGuildPremium, getGuildLimits } = require('../db/premium');
const { validateTrigger, invalidateTriggers, triggersFor, MAX_TRIGGERS_PER_GUILD } = require('./codeTriggers');

const MAX_PER_GUILD = 100; // the most any server can have (Premium); a Free server has less, see commandLimit
const NAME_SHAPE = /^[a-z0-9_-]{1,32}$/;

/** How many custom commands a server can have: Free 50, Premium 100. */
async function commandLimit(guildId) {
  const premium = await getGuildPremium(guildId).catch(() => ({ active: false }));
  return { limit: getGuildLimits(premium).customCommands, premium: Boolean(premium?.active) };
}

/** What to say when a server is full of custom commands. */
const fullMessage = ({ limit, premium }) => `This server already has the maximum of ${limit} custom commands.${premium ? '' : ' Premium raises it to 100.'}`;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The mistake in some code as a sentence, or null when the code is fine. */
function codeProblem(code) {
  if (!code) return 'There is no code. Write it after the name, inside a code block if it has several lines.';
  if (code.length > MAX_SOURCE_LENGTH) return `The code is too long (${code.length} of ${MAX_SOURCE_LENGTH} characters).`;
  const problem = check(code);
  return problem ? `The code has a mistake: ${problem.message}${problem.line ? ` (line ${problem.line}, column ${problem.column})` : ''}` : null;
}

/** What an action of some code would do, as one line. */
function describeEffect(effect) {
  const what = (e) => [e.content ? `"${clip(e.content.replace(/\s+/g, ' '), 80)}"` : null, e.embed ? 'an embed' : null, e.components?.length ? 'buttons or menus' : null].filter(Boolean).join(' and ');
  switch (effect.type) {
    case 'message': return `send ${what(effect)} ${effect.channelId ? `to <#${effect.channelId}>` : 'here'}${effect.reply ? ' as a reply' : ''}${effect.silent ? ' without a notification' : ''}`;
    case 'dm': return `send ${what(effect)} in a direct message`;
    case 'addRole': return `give the role <@&${effect.roleId}>`;
    case 'removeRole': return `take the role <@&${effect.roleId}>`;
    case 'reaction': return `react with ${effect.emoji}`;
    case 'deleteTrigger': return `delete the message that used the command${effect.delay ? ` after ${effect.delay} seconds` : ''}`;
    case 'deleteResponse': return `delete the answer of the command after ${effect.delay} seconds`;
    case 'removeReaction': return 'take the reaction away';
    case 'modal': return `show the form "${effect.modal.title}"`;
    case 'respond': return `answer the click with ${what(effect)}${effect.ephemeral ? ' (only for who clicked)' : ''}`;
    case 'update': return `change the message the button is on to ${what(effect)}`;
    default: return effect.type;
  }
}

const snippet = (value, max) => clip(String(value ?? '').replace(/\s+/g, ' ').trim(), max);

/** The buttons and menus of a message as short lines: `Buttons: Yes, No` and `Menu: Pick one (3 options)`. */
function componentLines(rows) {
  const lines = [];
  for (const row of rows ?? []) {
    const buttons = row.items.filter((item) => item.type !== 'select');
    if (buttons.length) lines.push(`Buttons: ${buttons.map((item) => `[${[item.emoji, item.label].filter(Boolean).join(' ')}]${item.url ? ' (link)' : ''}`).join(' ')}`);
    for (const menu of row.items.filter((item) => item.type === 'select')) {
      lines.push(`Menu: ${menu.placeholder ? `"${snippet(menu.placeholder, 60)}"` : 'no placeholder'} (${menu.options.length} option${menu.options.length === 1 ? '' : 's'}: ${clip(menu.options.map((option) => option.label).join(', '), 120)})`);
    }
  }
  return lines;
}

/**
 * What a message of some code would look like, as short lines for a test: the text, the embed (title, the start of the
 * description, fields, footer), the buttons and menus, and the reactions. A form says its title and its fields.
 */
function effectDetails(effect) {
  if (effect.type === 'modal') return [`Fields: ${effect.modal.fields.map((field) => `"${snippet(field.label, 45)}"${field.required ? '' : ' (optional)'}`).join(', ')}`];
  if (!['message', 'dm', 'respond', 'update'].includes(effect.type)) return [];
  const lines = [];
  if (effect.content) lines.push(`Text: ${snippet(effect.content, 200)}`);
  const embed = effect.embed;
  if (embed) {
    const parts = [
      embed.author?.name ? `by ${snippet(embed.author.name, 40)}` : null,
      embed.title ? `**${snippet(embed.title, 80)}**` : null,
      embed.description ? `"${snippet(embed.description, 120)}"` : null,
      embed.fields?.length ? `${embed.fields.length} field${embed.fields.length === 1 ? '' : 's'}` : null,
      embed.image ? 'an image' : null,
      embed.thumbnail ? 'a thumbnail' : null,
      embed.footer?.text ? `footer "${snippet(embed.footer.text, 40)}"` : null,
    ].filter(Boolean);
    lines.push(`Embed: ${parts.length ? parts.join(' · ') : 'empty'}`);
  }
  lines.push(...componentLines(effect.components));
  if (effect.reactions?.length) lines.push(`Reactions: ${effect.reactions.join(' ')} (reacting runs the command)`);
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
function codeHintList(code) {
  const tree = parsed(code);
  if (!tree) return [];
  const known = new Set(functionNames());
  const fields = dataFields();
  const hints = new Map();
  walkOperands(tree.nodes, (operand, rootDot) => {
    if (operand.kind === 'ident' && !known.has(operand.name) && !hints.has(`f:${operand.name}`)) {
      const meant = closestName(operand.name, known);
      hints.set(`f:${operand.name}`, { kind: 'function', name: operand.name, text: `There is no function called "${operand.name}"${meant ? `. Did you mean ${meant}?` : '.'}` });
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
    hints.set(`d:${path}`, { kind: 'field', name: path, text: `${path} is not in the data${last ? ', so it gives nothing' : ''}${meant ? `. Did you mean ${meant}?` : '.'}` });
  });
  return [...hints.values()].slice(0, 10);
}

/** The hints of some code as sentences (see codeHintList). */
const codeHints = (code) => codeHintList(code).map((hint) => hint.text);

const STORE_FUNCTIONS = /^db[A-Z]/;
const LOOKUP_FUNCTIONS = new Set(['getMember', 'getRole', 'getChannel', 'targetHasRole']);

/**
 * What some code uses, read without running it: the functions it calls (sorted) and whether it uses stored data, buttons or
 * menus, reactions, forms, roles, direct messages, or reads members, roles and channels. Null when the code has a mistake.
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

const isRealCommand = (client, name) => client.commands.has(name) || client.commandAliases.has(name) || Boolean(client.commandRoutes?.has(name));

/**
 * Saves the code of a command after checking everything. Returns { ok: true, created } or { ok: false, message, field? }.
 * The person who asked must already have been allowed to write code.
 */
async function saveCodeCommand({ guild, client, userId, name, code }) {
  if (isRealCommand(client, name)) return { ok: false, field: 'name', message: `\`${name}\` is already a real command, pick a different name.` };
  if (!NAME_SHAPE.test(name)) return { ok: false, field: 'name', message: 'A name has 1 to 32 letters, numbers, - or _.' };
  const problem = codeProblem(code);
  if (problem) return { ok: false, field: 'code', message: problem };
  await ensureGuild(guild.id);
  const existing = await ccDb.getCommand(guild.id, name);
  if (!existing) {
    const current = await ccDb.listCommands(guild.id);
    const allowed = await commandLimit(guild.id);
    if (current.length >= allowed.limit) return { ok: false, field: 'name', message: fullMessage(allowed) };
  }
  await ccDb.upsertCommand(guild.id, name, { response: null, embedTemplate: null, code, createdBy: userId });
  return { ok: true, created: !existing };
}

/** Changes what starts a command. Returns { ok: true, type, text } or { ok: false, message }. */
async function setCommandTrigger({ guild, client, name, type, text }) {
  const row = await ccDb.getCommand(guild.id, name);
  if (!row) return { ok: false, message: `\`${name}\` does not exist.` };
  const checked = validateTrigger(type, text);
  if (checked.error) return { ok: false, message: checked.error };
  if (type !== 'command') {
    const current = await triggersFor(guild.id);
    if (!current.some((entry) => entry.name === name) && current.length >= MAX_TRIGGERS_PER_GUILD) {
      return { ok: false, message: `This server already has ${MAX_TRIGGERS_PER_GUILD} commands with a trigger of their own, the most it can.` };
    }
    if (type === 'prefix' && (client.commands.has(`${checked.text}${name}`) || client.commandAliases.has(`${checked.text}${name}`))) {
      return { ok: false, message: 'That would be the name of a real command.' };
    }
  }
  await ccDb.setTrigger(guild.id, name, type, checked.text);
  invalidateTriggers(guild.id);
  return { ok: true, type, text: checked.text };
}

module.exports = { MAX_PER_GUILD, commandLimit, fullMessage, NAME_SHAPE, codeProblem, describeEffect, effectDetails, codeHints, codeHintList, codeSummary, saveCodeCommand, setCommandTrigger, isRealCommand, prefixHint };

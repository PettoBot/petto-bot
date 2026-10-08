// Saving and checking custom commands written in code, for the command `!customcommand` and for the dashboard, so both follow
// the same rules and say the same things.
const { ensureGuild } = require('../db/guilds');
const ccDb = require('../db/customCommands');
const { check, MAX_SOURCE_LENGTH } = require('../scripting');
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

module.exports = { MAX_PER_GUILD, commandLimit, fullMessage, NAME_SHAPE, codeProblem, describeEffect, saveCodeCommand, setCommandTrigger, isRealCommand };

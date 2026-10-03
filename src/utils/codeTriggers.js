// Custom commands that start on something other than the prefix of Petto: their own prefix (`?hello`), a message that
// starts with some words, is exactly some words, or has them inside. The commands with a trigger of each server are kept
// for a minute, so a message in a server without any costs nothing.
const customCommandsDb = require('../db/customCommands');

const TRIGGER_TYPES = ['command', 'prefix', 'startswith', 'exact', 'contains'];
const MAX_TRIGGERS_PER_GUILD = 25;
const CACHE_MS = 60_000;
const cache = new Map(); // guildId -> { at, rows }

async function triggersFor(guildId) {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rows;
  const rows = (await customCommandsDb.listTriggers(guildId).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name));
  cache.set(guildId, { at: Date.now(), rows });
  if (cache.size > 2000) for (const [key, value] of cache) if (Date.now() - value.at > CACHE_MS) cache.delete(key);
  return rows;
}

/** Forget what is kept for a server, after one of its commands changed. */
function invalidateTriggers(guildId) { cache.delete(guildId); }

const isWordChar = (char) => char !== undefined && /[\p{L}\p{N}_]/u.test(char);

/** The trigger text a person may set for a type, or the reason it is not valid. */
function validateTrigger(type, text) {
  if (!TRIGGER_TYPES.includes(type)) return { error: `The trigger is one of: ${TRIGGER_TYPES.join(', ')}.` };
  if (type === 'command') return { text: null };
  const value = String(text ?? '').trim();
  if (!value) return { error: 'Write the text of the trigger after its type.' };
  if (value.length > 50) return { error: 'The text of a trigger has at most 50 characters.' };
  if (type === 'prefix' && (/\s/.test(value) || value.length > 5)) return { error: 'A prefix has at most 5 characters and no spaces, for example `?` or `>>`.' };
  if (/<@|@everyone|@here/i.test(value)) return { error: 'A trigger cannot hold a mention.' };
  return { text: value };
}

/**
 * Whether a message sets off a command, and the arguments it gives: the rest of the message after the trigger (all of it for
 * "contains"). The comparison ignores the case.
 */
function matchTrigger(row, content) {
  const type = row.trigger_type;
  const trigger = String(row.trigger_text ?? '');
  const message = String(content ?? '').trim();
  if (!message || type === 'command') return null;
  const lowMessage = message.toLowerCase();
  const lowTrigger = trigger.toLowerCase();
  if (type === 'exact') return lowTrigger && lowMessage === lowTrigger ? { args: '', prefix: '' } : null;
  if (type === 'prefix') {
    const start = `${lowTrigger}${row.name}`;
    if (!lowMessage.startsWith(start) || isWordChar(lowMessage[start.length])) return null;
    return { args: message.slice(start.length).trim(), prefix: trigger };
  }
  if (type === 'startswith') {
    if (!lowTrigger || !lowMessage.startsWith(lowTrigger)) return null;
    if (isWordChar(lowTrigger.at(-1)) && isWordChar(lowMessage[lowTrigger.length])) return null;
    return { args: message.slice(trigger.length).trim(), prefix: '' };
  }
  if (type === 'contains') {
    if (!lowTrigger) return null;
    for (let at = lowMessage.indexOf(lowTrigger); at !== -1; at = lowMessage.indexOf(lowTrigger, at + 1)) {
      const before = lowMessage[at - 1];
      const after = lowMessage[at + lowTrigger.length];
      if ((isWordChar(lowTrigger[0]) && isWordChar(before)) || (isWordChar(lowTrigger.at(-1)) && isWordChar(after))) continue;
      return { args: message, prefix: '' };
    }
  }
  return null;
}

/** The command a message sets off in a server, with its arguments, or null. */
async function findTrigger(guildId, content) {
  const rows = await triggersFor(guildId);
  for (const row of rows) {
    const match = matchTrigger(row, content);
    if (match) return { row, ...match };
  }
  return null;
}

module.exports = { TRIGGER_TYPES, MAX_TRIGGERS_PER_GUILD, triggersFor, invalidateTriggers, validateTrigger, matchTrigger, findTrigger };

// Checks that a message that is a command for the bot does not set off an autoresponder, while ordinary chat still does.
// The database and the other modules are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
for (const file of ['src/utils/cooldown.js', 'src/db/disabledCommands.js', 'src/db/permissions.js', 'src/db/customCommands.js', 'src/db/embedTemplates.js', 'src/utils/embedBuilder.js', 'src/utils/embedVariables.js', 'src/utils/messageFlags.js', 'src/utils/caseCard.js', 'src/utils/emojis.js', 'src/utils/moderationPermissions.js', 'src/utils/autoModControl.js', 'src/handlers/prefixInteraction.js']) stub(file, {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/codeCommands.js', { runCodeCommand: async () => true });
stub('src/logging/extraLog.js', { logCommandUse() {} });
stub('src/utils/messageFlags.js', { extractReactReplies: (text) => ({ text, emojis: [] }), extractReactRepliesFromTemplate: (data) => data, applyReactReplies: async () => {} });
stub('src/utils/embedVariables.js', { resolve: async (text) => text.replaceAll('{user}', 'Liam') });
stub('src/handlers/prefixInteraction.js', { tokenize: (text) => text.split(/\s+/).filter(Boolean), buildInteractionFromMessage: async () => null });
stub('src/db/guilds.js', { ensureGuild: async () => ({ prefix: '!' }) });
const serverAliases = new Map([['hola', { command: 'ping' }]]);
stub('src/db/commandAliases.js', { get: async (guildId, name) => serverAliases.get(name) ?? null });
const responders = [{ ar_id: 1, trigger: 'hi', match_mode: 'contains', channel_ids: [], reply: 'Hi {user}', reply_type: 'text' }];
stub('src/db/autoResponders.js', { listForGuildCached: async () => responders });

const commandsEvent = require('../src/events/messageCreateCommands');
const autoresponder = require('../src/events/messageCreateAutoresponder');

const client = { user: { id: '123' }, commands: new Map([['embed', {}]]), commandAliases: new Map([['emb', 'embed']]), commandRoutes: new Map() };
function message(content) {
  const sent = [];
  return {
    sent,
    content,
    author: { bot: false, id: '1' },
    guild: { id: '9' },
    member: { roles: { cache: { has: () => false } } },
    channel: { id: '5', send: async (payload) => { sent.push(payload); return {}; } },
    client,
    reply: async (payload) => { sent.push(payload); return {}; },
  };
}

(async () => {
  assert.equal(await commandsEvent.isCommandMessage(message('!embed create test {description: hi there}')), true);
  assert.equal(await commandsEvent.isCommandMessage(message('!EMB send test')), true, 'an alias counts, in any case');
  assert.equal(await commandsEvent.isCommandMessage(message('!hola')), true, 'a server alias counts');
  assert.equal(await commandsEvent.isCommandMessage(message('<@123> embed create x hi')), true, 'an @mention prefix counts');
  assert.equal(await commandsEvent.isCommandMessage(message('!nothing here')), false, 'an unknown word after the prefix is just chat');
  assert.equal(await commandsEvent.isCommandMessage(message('hi everyone')), false);
  assert.equal(await commandsEvent.isCommandMessage(message('embed hi')), false, 'without the prefix it is chat');

  let m = message('!embed create test {description: hi there}');
  await autoresponder.execute(m);
  assert.equal(m.sent.length, 0, 'a command does not set off the autoresponder');
  m = message('hi everyone');
  await autoresponder.execute(m);
  assert.equal(m.sent.length, 1, 'ordinary chat still does');
  console.log('Checked that commands do not set off autoresponders.');
})().catch((error) => { console.error(error); process.exit(1); });

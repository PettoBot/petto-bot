// Checks that the AI assistant of the tickets is gone for good: its code is not in the bot, nothing is created for it any more, and the start of the bot
// deletes its tables and its function (schema.sql runs on every start). /ask, which only shared its Groq client, stays.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
for (const file of ['src/events/messageCreateTicketAi.js', 'src/interactions/ticketAi.js', 'src/db/ticketAi.js', 'src/utils/ticketAi.js', 'src/utils/ticketAiFlow.js', 'src/utils/ticketAiGreeting.js', 'src/utils/ticketAiPrompt.js', 'src/utils/ticketAiContext.js']) {
  assert.ok(!fs.existsSync(path.join(root, file)), `${file} is gone`);
}
assert.ok(fs.existsSync(path.join(root, 'src/utils/groqChat.js')), '/ask keeps the Groq client');

const schema = read('src/db/schema.sql');
assert.ok(!/create\s+(or\s+replace\s+)?(table|function)[^;]*ticket_ai/i.test(schema), 'nothing is created for the assistant');
assert.ok(/drop function if exists public\.ticket_ai_count_reply\(text\);/.test(schema), 'the function is dropped on start');
assert.ok(/drop table if exists public\.ticket_ai_usage;/.test(schema) && /drop table if exists public\.ticket_ai_settings;/.test(schema), 'the tables are dropped on start');
assert.ok(!/ticket_ai/.test(read('src/db/postgres.js')), 'the list of RPCs does not know it');
console.log('Ticket AI is gone: no code, nothing created, its tables are dropped on start, /ask keeps its client.');

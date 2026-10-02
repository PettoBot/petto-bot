// Checks that the commands that choose a saved embed can be typed with the prefix: `!sanctionmessage set ban dm card`,
// `!starboard message card`, `!giveaway message-template winner card`, `!verify template prompt card` and
// `!bumpreminder template thankyou card`. The prefix reads the options by position.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { verifyBaseUrl: null });
for (const file of ['src/db/guilds.js', 'src/db/embedTemplates.js', 'src/db/sanctionTemplates.js', 'src/db/starboard.js', 'src/db/giveaways.js', 'src/db/giveawayPresets.js', 'src/db/giveawayTemplates.js', 'src/db/giveawayConfig.js', 'src/db/bumpReminders.js', 'src/db/verificationConfig.js', 'src/utils/giveawayEngine.js', 'src/utils/duration.js', 'src/utils/caseCard.js', 'src/utils/commandRef.js', 'src/utils/verifyRole.js', 'src/utils/verifyToken.js', 'src/utils/verifyMessage.js', 'src/utils/logger.js']) {
  try { stub(file, new Proxy({ TYPES: ['default', 'ban', 'kick', 'warn'] }, { get: (t, k) => (k in t ? t[k] : () => {}) })); } catch { /* the file is not in this version */ }
}
stub('src/utils/emojis.js', { EMOJI: {} });
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const load = (file) => require(path.join('..', 'src', 'commands', file));

const message = {
  guild: { id: '1', channels: { cache: new Collection() }, roles: { cache: new Collection() }, members: { cache: new Collection() } },
  author: { id: '2' }, member: { id: '2' }, channel: { id: '3' }, client: {}, content: '',
};
const parse = (command, text) => buildInteractionFromMessage(message, command, text);

(async () => {
  let i = await parse(load('moderation/sanctionmessage.js'), 'set ban dm card');
  assert.deepEqual([i.options.getSubcommand(), i.options.getString('type'), i.options.getString('slot'), i.options.getString('template')], ['set', 'ban', 'dm', 'card']);
  i = await parse(load('moderation/sanctionmessage.js'), 'clear default');
  assert.deepEqual([i.options.getSubcommand(), i.options.getString('type'), i.options.getString('slot')], ['clear', 'default', null]);

  i = await parse(load('automation/starboard.js'), 'message card');
  assert.deepEqual([i.options.getSubcommand(), i.options.getString('template')], ['message', 'card']);

  i = await parse(load('giveaways/giveaway.js'), 'message-template claim_time_over card');
  assert.deepEqual([i.options.getSubcommand(), i.options.getString('message'), i.options.getString('template')], ['message-template', 'claim_time_over', 'card']);

  i = await parse(load('config/verify.js'), 'template prompt card');
  assert.deepEqual([i.options.getSubcommand(), i.options.getString('which'), i.options.getString('template')], ['template', 'prompt', 'card']);

  i = await parse(load('config/bumpreminder.js'), 'template thankyou card');
  assert.deepEqual([i.options.getSubcommand(), i.options.getString('which'), i.options.getString('template')], ['template', 'thankyou', 'card']);

  console.log('Checked that the commands that choose a saved embed work with the prefix.');
})().catch((error) => { console.error(error); process.exit(1); });

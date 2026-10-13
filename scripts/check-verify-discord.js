// Checks the letters check inside Discord: the button of the DM, the picture, the form, wrong and right answers, and what happens after.
// The database, the roles and the DM are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const configPath = require.resolve(path.join(__dirname, '..', 'src/config.js'));
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { verifyTokenSecret: 'secret-for-the-test' } };
let settings = { enabled: true, method: 'discord', unverified_role_id: 'role-un', verified_role_id: 'role-ok' };
let everVerified = false;
const applied = [];
stub('src/db/verificationConfig.js', { getConfig: async () => settings });
stub('src/db/verificationRedemptions.js', { hasEverVerified: async () => everVerified });
stub('src/utils/verifyApply.js', { applyVerification: async (options) => { applied.push(options.jti); return { ok: true }; } });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const captcha = require('../src/utils/verifyCaptcha');
const verifyLetters = require('../src/interactions/verifyLetters');
const { methodOf, inDiscord, usesLink } = require('../src/utils/verifyMethod');

const GUILD = '111111111111111111';
const USER = '222222222222222222';
const guild = { id: GUILD, name: 'Petto HQ' };
const member = { id: USER, roles: { cache: new Map([['role-un', {}]]) }, user: { id: USER } };
const client = { guilds: { cache: new Map([[GUILD, { ...guild, members: { fetch: async () => member } }]]) } };

const replies = [];
const interaction = (customId, fields = {}) => ({
  customId, client, user: { id: USER }, replies,
  reply: async (payload) => { replies.push(payload); },
  showModal: async (modal) => { replies.push({ modal: modal.toJSON() }); },
  fields: { getTextInputValue: (name) => fields[name] },
});
const text = (payload) => JSON.stringify(payload.components?.map((component) => component.toJSON?.() ?? component));

(async () => {
  assert.deepEqual([methodOf({ method: 'discord' }), inDiscord('discord'), inDiscord('letters'), usesLink('discord')], ['discord', true, true, false]);

  // The button of the DM starts a picture: a PNG with the buttons to type or to ask for another.
  const button = verifyLetters.startButton(GUILD).toJSON();
  assert.equal(button.custom_id, `vfy:start:${GUILD}`);
  assert.ok(button.custom_id.length <= 100);
  await verifyLetters.handleButton(interaction(button.custom_id));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].files[0].name, 'verify.png');
  assert.ok(text(replies[0]).includes(`vfy:type:${GUILD}`) && text(replies[0]).includes(`vfy:again:${GUILD}`), 'the picture comes with its buttons');
  await verifyLetters.handleButton(interaction(`vfy:type:${GUILD}`));
  assert.equal(replies[1].modal.custom_id, `vfy:answer:${GUILD}`, 'the button opens the form');

  // New picture changes the picture of the same message, it does not send another one.
  const updates = [];
  const pressed = { ...interaction(`vfy:again:${GUILD}`), isButton: () => true, update: async (payload) => { updates.push(payload); } };
  const before = replies.length;
  await verifyLetters.handleButton(pressed);
  assert.equal(replies.length, before, 'no new message');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].files[0].name, 'verify.png');
  assert.deepEqual(updates[0].attachments, [], 'the old picture is taken out');

  // We do not know the letters of the picture the bot drew, so the ticket is replaced by one we know.
  const original = captcha.createChallenge;
  const known = (jti, answer = 'AB7K2') => original(jti, { text: answer });
  captcha.createChallenge = (id) => known(id);
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  captcha.createChallenge = original;

  await verifyLetters.handleModal(interaction(`vfy:answer:${GUILD}`, { letters: 'WRONG' }));
  assert.ok(text(replies.at(-1)).includes('not right'), 'a wrong answer says so and asks for a new picture');
  assert.equal(applied.length, 0);
  await verifyLetters.handleModal(interaction(`vfy:answer:${GUILD}`, { letters: 'AB7K2' }));
  assert.ok(text(replies.at(-1)).includes('expired'), 'a wrong answer used the picture up: a new one is needed');

  captcha.createChallenge = (id) => known(id);
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  captcha.createChallenge = original;
  await verifyLetters.handleModal(interaction(`vfy:answer:${GUILD}`, { letters: ' ab7k2 ' }));
  assert.ok(text(replies.at(-1)).includes("You're verified"), 'the right letters let the member in');
  assert.equal(applied.length, 1);
  assert.ok(applied[0].startsWith('dc'), 'a single-use pass is claimed');

  // After a right answer the picture that was answered keeps its picture but its buttons are off.
  captcha.createChallenge = (id) => known(id);
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  captcha.createChallenge = original;
  const locked = [];
  const answered = { ...interaction(`vfy:answer:${GUILD}`, { letters: 'AB7K2' }), replied: false, isFromMessage: () => true, message: { components: [{ toJSON: () => ({ type: 17, components: [{ type: 10, content: 'x' }, { type: 1, components: [{ type: 2, custom_id: `vfy:type:${GUILD}` }, { type: 2, custom_id: `vfy:again:${GUILD}` }] }] }) }] } };
  answered.update = async (payload) => { locked.push(payload); answered.replied = true; };
  answered.followUp = async (payload) => { replies.push(payload); };
  await verifyLetters.handleModal(answered);
  assert.equal(locked.length, 1, 'the picture message is updated once');
  const buttons = JSON.stringify(locked[0].components).match(/"disabled":true/g) ?? [];
  assert.equal(buttons.length, 2, 'both buttons are off');
  assert.ok(text(replies.at(-1)).includes("You're verified") || JSON.stringify(replies.at(-1)).includes("You're verified"), 'and the member is told they are in');

  // A server that does not use the check in Discord, or a member who is already in.
  settings = { ...settings, method: 'turnstile' };
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  assert.ok(text(replies.at(-1)).includes('does not ask'), 'the Cloudflare-only servers have no such button');
  settings = { ...settings, method: 'letters' };
  member.roles.cache.delete('role-un');
  everVerified = true;
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  assert.ok(text(replies.at(-1)).includes('already verified'));
  await verifyLetters.handleButton(interaction('vfy:start:not-a-server'));
  // The panel of a channel and its ephemeral answers.
  const panel = verifyLetters.buildPanel({ guild, method: 'letters' }).components[0].toJSON();
  const customIds = JSON.stringify(panel).match(/vfy:[a-z]+:\d+/g);
  assert.deepEqual(customIds, [`vfy:link:${GUILD}`, `vfy:start:${GUILD}`]);
  assert.equal(JSON.stringify(verifyLetters.buildPanel({ guild, method: 'discord' }).components[0].toJSON()).includes('vfy:link'), false);
  settings = { enabled: true, method: 'letters', unverified_role_id: 'role-un', verified_role_id: 'role-ok' };
  const inChannel = { ...interaction(`vfy:start:${GUILD}`), inGuild: () => true };
  await verifyLetters.handleButton(inChannel);
  assert.ok(replies.at(-1).flags & 64, 'answers in a channel are ephemeral');
  console.log('verify panel checks passed');
  console.log('Checked the letters check inside Discord: the button, the picture, the form and the pass.');
})().catch((error) => { console.error(error); process.exit(1); });

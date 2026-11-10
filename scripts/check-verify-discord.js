// Checks the letters check inside Discord: the button of the DM, the picture, the form, wrong and right answers, and what happens after.
// The database, the roles and the DM are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const configPath = require.resolve(path.join(__dirname, '..', 'src/config.js'));
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { verifyTokenSecret: 'secret-for-the-test', verifyBaseUrl: 'https://verify.example.com' } };
let settings = { enabled: true, method: 'discord', unverified_role_id: 'role-un', verified_role_id: 'role-ok' };
let everVerified = false;
let lastPass = null; // when the member passed (a Date), for "verified in this stay"
const restored = [];
const applied = [];
stub('src/db/verificationConfig.js', { getConfig: async () => settings });
stub('src/db/verificationRedemptions.js', { hasEverVerified: async () => everVerified, lastVerifiedAt: async () => lastPass });
let applyBehaviour = async () => ({ ok: true });
stub('src/utils/verifyApply.js', { applyVerification: async (options) => { applied.push(options.jti); return applyBehaviour(options); }, applyVerificationRoles: async (options) => { restored.push(options.member.id); options.member.roles.cache.delete('role-un'); return { noRole: false }; } });
const errors = [];
stub('src/utils/logger.js', { info() {}, warn() {}, error: (...args) => errors.push(args) });
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
  // The icon of the button is Petto's own (the shield), not the letters emoji that Android draws as "abc".
  assert.equal(`<:${button.emoji.name}:${button.emoji.id}>`, require('../src/utils/emojis').EMOJI.SAFETY, 'the button has the shield of Petto');
  assert.ok(!JSON.stringify(verifyLetters.buildPanel({ guild, method: 'letters' }).components[0].toJSON()).includes('🔤'), 'and the panel does not have the letters emoji either');
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

  // The extra checks of the server (utils/verifyChecks.js): Tor, alt accounts and the email need the page, so with a link the letters inside Discord are not a way around them.
  const keep = { settings, user: member.user };
  settings = { ...settings, method: 'letters', checks: { tor: 'block' } };
  const asked = replies.length;
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  assert.ok(text(replies.at(-1)).includes('asks for more checks than the letters') && replies.length === asked + 1, 'a server that checks Tor sends the member to the link');
  settings = { ...settings, checks: { email: { required: true } } };
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  assert.ok(text(replies.at(-1)).includes('asks for more checks than the letters'), 'and one that asks for the email too');
  // With no link (letters inside Discord only) the checks of the Discord account still run: a new account is stopped before anything is given.
  member.user = { id: USER, username: 'newbie', avatar: 'av', createdTimestamp: Date.now() - 86_400_000, fetchFlags: async () => null };
  settings = { ...settings, method: 'discord', checks: { account: { mode: 'block', min_age_days: 7 } } };
  captcha.createChallenge = (id) => known(id);
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  captcha.createChallenge = original;
  const doneBefore = applied.length;
  await verifyLetters.handleModal(interaction(`vfy:answer:${GUILD}`, { letters: 'AB7K2' }));
  assert.ok(text(replies.at(-1)).includes('too new for this server') && text(replies.at(-1)).includes('7 days'), 'the new account is told why');
  assert.equal(applied.length, doneBefore, 'and nothing was given');
  settings = { ...settings, checks: { account: { mode: 'warn', min_age_days: 7 } } };
  captcha.createChallenge = (id) => known(id);
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  captcha.createChallenge = original;
  await verifyLetters.handleModal(interaction(`vfy:answer:${GUILD}`, { letters: 'AB7K2' }));
  assert.equal(applied.length, doneBefore + 1, 'warn: the member is let in (the staff is told)');
  settings = keep.settings; member.user = keep.user;

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

  // The member solved the picture but there is no role to give (it was deleted and cannot be made again): told in a friendly way, not "contact a moderator".
  captcha.createChallenge = (id) => known(id);
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  captcha.createChallenge = original;
  applyBehaviour = async () => ({ ok: true, noRole: true });
  await verifyLetters.handleModal(interaction(`vfy:answer:${GUILD}`, { letters: 'AB7K2' }));
  assert.ok(text(replies.at(-1)).includes('no role set up for verified members yet') && !text(replies.at(-1)).includes('Contact a moderator'), 'verified, with no role: said kindly');
  // Any other failure of the roles is still the old message, and the error says WHICH server (the interaction of a DM has none of its own).
  captcha.createChallenge = (id) => known(id);
  await verifyLetters.handleButton(interaction(`vfy:start:${GUILD}`));
  captcha.createChallenge = original;
  applyBehaviour = async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); };
  await verifyLetters.handleModal(interaction(`vfy:answer:${GUILD}`, { letters: 'AB7K2' }));
  assert.ok(text(replies.at(-1)).includes('Contact a moderator'), 'a permission problem is still reported to the member');
  assert.equal(errors.length, 1);
  assert.deepEqual([errors[0][0].guildId, errors[0][0].userId, errors[0][0].command, errors[0][0].source], [GUILD, USER, 'verify', 'interactionCreate'], 'the error carries the server being verified for');
  assert.match(errors[0][1], /Failed to apply verification roles \(letters in Discord\)/);
  applyBehaviour = async () => ({ ok: true });

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
  // A member who passed in this stay and was given the gate role by mistake gets the roles back with no new check (the letters and the link buttons).
  member.joinedTimestamp = Date.now() - 3_600_000;
  lastPass = new Date(Date.now() - 600_000);
  for (const button of ['start', 'link']) {
    member.roles.cache.set('role-un', {}); restored.length = 0;
    await verifyLetters.handleButton({ ...interaction(`vfy:${button}:${GUILD}`), inGuild: () => true });
    assert.deepEqual([restored, text(replies.at(-1)).includes('no new check')], [[USER], true], `${button}: the roles come back with no new check`);
  }
  // A pass of an earlier stay (before they joined again) does not count, and neither does a member who is not gated.
  member.roles.cache.set('role-un', {}); restored.length = 0;
  lastPass = new Date(Date.now() - 7_200_000);
  await verifyLetters.handleButton({ ...interaction(`vfy:start:${GUILD}`), inGuild: () => true });
  assert.ok(restored.length === 0 && !text(replies.at(-1)).includes('no new check'), 'a pass of an earlier stay does not count: the member is asked again');
  lastPass = null; member.joinedTimestamp = undefined; everVerified = false;
  const state = require('../src/utils/verifyState');
  assert.equal(await state.verifiedThisStay(GUILD, { id: USER, joinedTimestamp: 1_000_000 }, async () => new Date(1_000_000 - 30_000)), true, 'a little slack for the clocks');
  assert.equal(await state.verifiedThisStay(GUILD, { id: USER, joinedTimestamp: 1_000_000 }, async () => new Date(1_000_000 - 120_000)), false);
  assert.equal(await state.verifiedThisStay(GUILD, { id: USER, joinedTimestamp: 1_000_000 }, async () => { throw new Error('db'); }), false, 'when it cannot be known, the member is not taken for verified');
  assert.equal(await state.restoreVerified({ client, guild, member: { id: USER, joinedTimestamp: 1, roles: { cache: new Map() } }, settings, lang: 'en' }), null, 'a member without the gate role has nothing to give back');
  member.roles.cache.set('role-un', {});
  // The panel of a channel and its ephemeral answers.
  const panel = verifyLetters.buildPanel({ guild, method: 'letters' }).components[0].toJSON();
  const customIds = JSON.stringify(panel).match(/vfy:[a-z]+:\d+/g);
  assert.deepEqual(customIds, [`vfy:link:${GUILD}`, `vfy:start:${GUILD}`]);
  assert.equal(JSON.stringify(verifyLetters.buildPanel({ guild, method: 'discord' }).components[0].toJSON()).includes('vfy:link'), false);
  settings = { enabled: true, method: 'letters', unverified_role_id: 'role-un', verified_role_id: 'role-ok' };
  const inChannel = { ...interaction(`vfy:start:${GUILD}`), inGuild: () => true };
  await verifyLetters.handleButton(inChannel);
  assert.ok(replies.at(-1).flags & 64, 'answers in a channel are ephemeral');
  // A button pressed in a DM has no server: it answers in the language of the server of the customId, not in the member's.
  const i18n = require('../src/i18n');
  i18n.setCachedGuildLanguage(GUILD, 'es');
  member.roles.cache.set('role-un', {});
  everVerified = false;
  await verifyLetters.handleButton({ ...interaction(`vfy:start:${GUILD}`), locale: 'pt-BR' });
  assert.ok(text(replies.at(-1)).includes('Verificación para Petto HQ') && text(replies.at(-1)).includes('Escribir las letras'), 'the picture in Spanish');
  await verifyLetters.handleModal({ ...interaction(`vfy:answer:${GUILD}`, { letters: 'WRONG' }), locale: 'pt-BR' });
  assert.ok(text(replies.at(-1)).includes('Esas letras no son correctas'), 'a wrong answer in Spanish');
  assert.ok(JSON.stringify(verifyLetters.buildPanel({ guild, method: 'letters', lang: 'pt-BR' }).components[0].toJSON()).includes('Verificar aqui no Discord'), 'the panel in Portuguese');
  i18n.setCachedGuildLanguage(GUILD, 'en');

  // The panel: the server's name, the steps and the buttons with an emoji.
  const look = JSON.stringify(verifyLetters.buildPanel({ guild, method: 'turnstile' }).components[0].toJSON());
  assert.ok(look.includes('Welcome to **Petto HQ**') && look.includes('**1** Pick a way') && look.includes('With a link') && look.includes('pe_Link') && !look.includes('🔗'), 'the panel has the server, the steps and the emojis of the bot');
  assert.ok(look.includes('verify.example.com/assets/favicon.png'), 'with no avatar to read, the icon of the website');
  const withAvatar = JSON.stringify(verifyLetters.buildPanel({ guild: { ...guild, iconURL: () => 'https://cdn.discordapp.com/icons/1/a.png', client: { user: { displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/9/b.png' } } }, method: 'turnstile' }).components[0].toJSON());
  assert.ok(withAvatar.includes('cdn.discordapp.com/avatars/9/b.png') && !withAvatar.includes('icons/1/a.png'), 'the picture is the avatar Petto uses now, not the icon of the server')

  // The link: a card with a link button to the page, when it expires and the address written out.
  const config = require('../src/config');
  settings = { enabled: true, method: 'turnstile', unverified_role_id: 'role-un', verified_role_id: 'role-ok' };
  await verifyLetters.handleButton({ ...interaction(`vfy:link:${GUILD}`), inGuild: () => true });
  const answer = replies.at(-1).components[0].toJSON();
  const linkButton = JSON.stringify(answer).match(/"url":"(https:\/\/verify\.example\.com\/verify\/[^"]+)"/);
  assert.ok(linkButton && JSON.stringify(answer).includes('"style":5'), 'a link button with the address');
  assert.ok(JSON.stringify(answer).includes(`copy this link: ${linkButton[1]}`.replace('copy', 'Copy')), 'and the address written out');
  assert.ok(/Open verification/.test(JSON.stringify(answer)) && /<t:\d+:R>/.test(JSON.stringify(answer)), 'the button and when it expires');
  assert.ok(replies.at(-1).flags & 64, 'only for the member');
  assert.match(linkButton[1], /\?lang=en$/, 'the link carries the language of the server, so the page opens in the language of the message');
  {
    const i18n = require('../src/i18n');
    i18n.setCachedGuildLanguage(GUILD, 'pt-BR');
    await verifyLetters.handleButton({ ...interaction(`vfy:link:${GUILD}`), inGuild: () => true });
    assert.match(JSON.stringify(replies.at(-1).components[0].toJSON()), /\/verify\/[^"?]+\?lang=pt-BR"/, 'a server in Portuguese: a link in Portuguese');
    i18n.setCachedGuildLanguage(GUILD, 'en');
  }
  // A base address with a slash at the end or without its scheme still makes a good link.
  config.verifyBaseUrl = 'verify.example.com/';
  await verifyLetters.handleButton({ ...interaction(`vfy:link:${GUILD}`), inGuild: () => true });
  assert.ok(JSON.stringify(replies.at(-1).components[0].toJSON()).includes('"https://verify.example.com/verify/'), 'cleaned address');

  // The DM a member gets when they join: the server, a row for each way with its button on its side, and the note; the DM of the pass has a button to the server.
  stub('src/utils/templatedMessage.js', { templatePayload: async () => null });
  stub('src/utils/dmOrigin.js', { sendDm: async () => {} });
  const messages = require('../src/utils/verifyMessage');
  // The addresses of the link buttons of a card, to compare them whole (not as a piece of a text).
  const urlsOf = (card) => { const out = []; const walk = (node) => { if (!node || typeof node !== 'object') return; if (typeof node.url === 'string' && node.style === 5) out.push(node.url); Object.values(node).forEach(walk); }; walk(typeof card === 'string' ? JSON.parse(card) : card); return out; };
  const dmBoth = JSON.stringify(messages.buildVerifyDM({ guild, link: 'https://verify.example.com/verify/abc', discordButton: true, lang: 'en' }).toJSON());
  assert.ok(dmBoth.includes('Welcome to Petto HQ!') && dmBoth.includes('With a link') && dmBoth.includes('Right here in Discord') && urlsOf(dmBoth).includes('https://verify.example.com/verify/abc') && dmBoth.includes(`vfy:start:${GUILD}`) && dmBoth.includes('only for you'), 'the DM has the server, both ways with their buttons and the note');
  const dmLetters = JSON.stringify(messages.buildVerifyDM({ guild, link: null, discordButton: true, lang: 'es' }).toJSON());
  assert.ok(!dmLetters.includes('With a link') && !dmLetters.includes('Con un enlace') && dmLetters.includes(`vfy:start:${GUILD}`) && dmLetters.includes('Bienvenido a Petto HQ'), 'a server that verifies only in Discord has the letters row only, in its language');
  const dmDone = messages.buildVerifiedDM({ guild, lang: 'pt-BR' }).toJSON();
  assert.ok(JSON.stringify(dmDone).includes('Você está verificado') && urlsOf(dmDone).includes(`https://discord.com/channels/${GUILD}`) && dmDone.accent_color === undefined, 'the DM of the pass: no color, in its language, with the button to the server');

  // No address that opens: the panel and the button give the letters inside Discord instead, and the letters work for a Cloudflare server.
  config.verifyBaseUrl = 'http://localhost:3000';
  const fallbackPanel = JSON.stringify(verifyLetters.buildPanel({ guild, method: 'turnstile' }).components[0].toJSON());
  assert.ok(fallbackPanel.includes(`vfy:start:${GUILD}`) && !fallbackPanel.includes(`vfy:link:${GUILD}`), 'the panel offers the letters');
  await verifyLetters.handleButton({ ...interaction(`vfy:link:${GUILD}`), inGuild: () => true });
  assert.ok(text(replies.at(-1)).includes('not available right now') && text(replies.at(-1)).includes(`vfy:start:${GUILD}`), 'an old panel button says so and offers the letters');
  await verifyLetters.handleButton({ ...interaction(`vfy:start:${GUILD}`), inGuild: () => true });
  assert.ok(replies.at(-1).files?.length, 'and the letters picture comes');
  // Without the secret either, the member is told it is not set up.
  config.verifyTokenSecret = null;
  await verifyLetters.handleButton({ ...interaction(`vfy:link:${GUILD}`), inGuild: () => true });
  assert.ok(text(replies.at(-1)).includes('not set up'));
  config.verifyTokenSecret = 'secret-for-the-test';
  config.verifyBaseUrl = 'https://verify.example.com';

  // A panel message of this server is found among the messages of the channel (to delete a second copy).
  assert.equal(verifyLetters.isPanelMessage({ components: verifyLetters.buildPanel({ guild, method: 'both' }).components }, GUILD), true);
  assert.equal(verifyLetters.isPanelMessage({ components: [] }, GUILD), false);
  assert.equal(verifyLetters.isPanelMessage({ components: verifyLetters.buildPanel({ guild: { ...guild, id: '333333333333333333' }, method: 'both' }).components }, GUILD), false);
  // A picture for the panel: a media gallery on top; with none (or a link Petto does not show) the panel is exactly what it was.
  const plain = verifyLetters.buildPanel({ guild, method: 'letters' }).components[0].toJSON();
  const withImage = verifyLetters.buildPanel({ guild, method: 'letters', imageUrl: 'https://cdn.example.com/banner.png?size=2' }).components[0].toJSON();
  assert.deepEqual(withImage.components[0], { type: 12, items: [{ media: { url: 'https://cdn.example.com/banner.png?size=2' } }] }, 'the picture is the first part of the panel');
  assert.deepEqual(withImage.components.slice(1), plain.components, 'and the rest of the panel is the same');
  assert.equal(plain.components.some((part) => part.type === 12), false, 'no picture, no gallery');
  for (const bad of ['http://cdn.example.com/a.png', 'javascript:alert(1)', 'https://user:pass@example.com/a.png', 'nonsense', '   ', `https://example.com/${'a'.repeat(500)}.png`]) {
    assert.deepEqual(verifyLetters.buildPanel({ guild, method: 'letters', imageUrl: bad }).components[0].toJSON(), plain, `${bad.slice(0, 40)} is not shown`);
  }
  assert.equal(verifyLetters.isPanelMessage({ components: verifyLetters.buildPanel({ guild, method: 'both', imageUrl: 'https://cdn.example.com/banner.png' }).components }, GUILD), true, 'a panel with a picture is still found as the panel');
  // The panel posted from the settings of the server carries its picture, and an edit of the panel that stands brings it in place.
  stub('src/utils/verifyRole.js', { ensureUnverifiedRole: async () => ({ id: 'role-un' }) });
  const posted = [];
  const channel = {
    id: 'c1', isTextBased: () => true, permissionsFor: () => ({ has: () => true }),
    permissionOverwrites: { cache: new Map([['role-un', { allow: { has: () => true }, deny: { has: () => true } }]]) },
    messages: { fetch: async () => null },
    send: async (payload) => { posted.push(payload); return { id: 'm1' }; },
  };
  const fakeGuild = { id: GUILD, name: 'Petto HQ', members: { me: { id: '99' } }, client: { user: { id: '99' } }, channels: { fetch: async () => null } };
  settings = { enabled: true, method: 'letters', unverified_role_id: 'role-un', panel_image_url: 'https://cdn.example.com/banner.png' };
  stub('src/db/verificationConfig.js', { getConfig: async () => settings, upsertConfig: async () => ({}) });
  delete require.cache[require.resolve('../src/utils/verifyPanel')];
  await require('../src/utils/verifyPanel').postPanel(fakeGuild, settings, channel);
  assert.equal(posted[0].components[0].toJSON().components[0].type, 12, 'the panel that is posted has the picture of the server on top');
  console.log('verify panel checks passed');
  console.log('Checked the letters check inside Discord: the button, the picture, the form and the pass.');
})().catch((error) => { console.error(error); process.exit(1); });

// Confessions: the usual look, posting through a webhook, the check of the staff, anonymous replies, the cooldown and the blocks.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', {});
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

let config = {};
const rows = new Map();
const blocked = new Set();
const sent = [];
let when = Date.now();
let ownAvatar = false;
let webhookAttachments = null; // what the webhook answers as the files of the message it sent: a plain list (a channel that is not in memory), or none
stub('src/db/confessions.js', {
  DEFAULTS: {},
  getConfig: async () => config,
  nextNumber: async () => rows.size + 1,
  create: async (row) => { const made = { status: 'pending', created_at: new Date(when).toISOString(), ...row }; rows.set(row.id, made); return made; },
  getById: async (id) => rows.get(id) ?? null,
  update: async (id, patch) => { const made = { ...rows.get(id), ...patch }; rows.set(id, made); return made; },
  remove: async (guildId, id) => { const had = rows.get(id); rows.delete(id); return had ?? null; },
  lastBy: async (guildId, userId) => { const mine = [...rows.values()].filter((row) => row.author_id === userId); return mine.length ? new Date(mine[mine.length - 1].created_at) : null; },
  isBlocked: async (guildId, userId) => blocked.has(userId),
  updateConfig: async (guildId, patch) => { config = { ...config, ...patch }; return config; },
});
stub('src/utils/senderIdentity.js', {
  webhookFor: async () => ({ send: async (options) => { sent.push({ via: 'webhook', ...options }); return { id: `m${sent.length}`, ...(webhookAttachments ? { attachments: webhookAttachments } : {}) }; } }),
});
stub('src/db/embedTemplates.js', { getTemplate: async () => null });

// The picture of a confession is copied from a link: here the copy is replaced, so a test decides if the picture can be had.
const suggestionsModule = require('../src/utils/suggestions');
let pictureReachable = false;
const staleLinks = new Set(); // links that no longer open (Discord changes the signature of a link with time)
suggestionsModule.copyPicture = async (url) => (pictureReachable && !staleLinks.has(url) ? { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), name: 'suggestion.jpg' } : null);
const confessions = require('../src/utils/confessions');
const empty = () => ({ cache: new Map() });
const makeChannel = (id) => ({
  id, isTextBased: () => true, isThread: () => false, client: {}, permissionsFor: () => ({ has: () => true }),
  send: async (payload) => { sent.push({ via: 'bot', channel: id, ...payload }); return { id: `m${sent.length}`, attachments: { first: () => null } }; },
  messages: { fetch: async () => ({ id: 'm1', startThread: async () => ({ ...makeChannel('thread1'), isThread: () => true, guild }) }) },
});
const deleted = [];
const channels = { c1: makeChannel('c1'), review: makeChannel('review'), log: makeChannel('log') };
channels.c1.messages = { fetch: async (id) => (id === 'panel1' ? { id, delete: async () => { deleted.push(id); } } : { id: 'm1', startThread: async () => ({ ...makeChannel('thread1'), isThread: () => true, guild }) }) };
const guild = {
  client: { user: { displayAvatarURL: () => 'https://cdn.example/petto.png' } },
  id: '111111111111111111', name: 'G', members: { ...empty(), me: { avatarURL: () => (ownAvatar ? 'https://cdn.example/petto-server.png' : null) } }, roles: empty(), emojis: empty(), stickers: empty(), memberCount: 1, premiumTier: 0,
  iconURL: () => null, bannerURL: () => null, splashURL: () => null, discoverySplashURL: () => null,
  channels: { ...empty(), fetch: async (id) => channels[id] ?? null },
};
for (const channel of Object.values(channels)) channel.guild = guild;
const user = (id) => ({ id });
const base = { enabled: true, channel_id: 'c1', review_channel_id: 'review', require_review: false, allow_images: true, allow_replies: true, keep_author: true, use_webhook: true, webhook_name: 'Anonymous', webhook_avatar: null, title: 'Anonymous confession #{confession.number}', footer: 'Confession ID: {confession.id}', color: 0xa5ea7a, reply_label: 'Reply anonymously', cooldown_seconds: 60 };

(async () => {
  assert.equal(confessions.BUTTON_PREFIX, 'cfs');
  assert.match(confessions.makeId(), /^[a-z0-9]{5}-[a-z0-9]{5}$/);

  // The usual look: the color of the server, the confession and the ID under it, a reply button under that.
  config = { ...base };
  let result = await confessions.submit({ guild, user: user('u1'), text: 'I ate the last cookie' });
  assert.ok(!result.error, result.error);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].via, 'webhook', 'it goes through the webhook');
  assert.equal(sent[0].username, 'Anonymous');
  const json = JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c));
  assert.ok(json.includes('I ate the last cookie') && json.includes('Anonymous confession #1'), 'the text and the title are there');
  assert.ok(json.includes('cfs:reply:'), 'the reply button is there');
  assert.ok(json.includes(String(0xa5ea7a)), 'the color is the one of the server');
  assert.equal(rows.get(result.row.id).status, 'posted');

  // The cooldown and the blocks.
  result = await confessions.submit({ guild, user: user('u1'), text: 'again' });
  assert.match(result.error, /Wait \d+ second/);
  blocked.add('u2');
  result = await confessions.submit({ guild, user: user('u2'), text: 'hello' });
  assert.match(result.error, /cannot make confessions/);

  // Without a webhook it goes as the bot.
  config = { ...base, use_webhook: false, cooldown_seconds: 0 };
  sent.length = 0;
  result = await confessions.submit({ guild, user: user('u3'), text: 'as the bot' });
  assert.equal(sent[0].via, 'bot');

  // Not keeping the author: nothing to reveal.
  config = { ...base, keep_author: false, cooldown_seconds: 0 };
  result = await confessions.submit({ guild, user: user('u4'), text: 'no trace' });
  assert.equal(rows.get(result.row.id).author_id, null);

  // The staff checks first: it waits in the review channel and shows only when approved.
  config = { ...base, require_review: true, cooldown_seconds: 0 };
  sent.length = 0;
  result = await confessions.submit({ guild, user: user('u5'), text: 'check me' });
  assert.ok(result.review);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].username, 'Confessions review', 'the card of the staff is sent through the webhook');
  assert.ok(JSON.stringify(sent[0].components).includes('cfs:ok:'), 'the staff gets the approve button');
  const waiting = result.row;
  let decided = await confessions.decide({ guild, member: { permissions: { has: () => false }, roles: empty() }, id: waiting.id, approve: true });
  assert.match(decided.error, /Only the staff/);
  const staff = { permissions: { has: () => true }, roles: empty() };
  sent.length = 0;
  decided = await confessions.decide({ guild, member: staff, id: waiting.id, approve: true });
  assert.ok(!decided.error, decided.error);
  assert.equal(sent[0].via, 'webhook', 'it shows after the approval');
  decided = await confessions.decide({ guild, member: staff, id: waiting.id, approve: false });
  assert.match(decided.error, /already/);
  result = await confessions.submit({ guild, user: user('u6'), text: 'reject me' });
  decided = await confessions.decide({ guild, member: staff, id: result.row.id, approve: false });
  assert.equal(decided.row.status, 'rejected');

  // An anonymous reply goes in a thread.
  config = { ...base, cooldown_seconds: 0 };
  const posted = (await confessions.submit({ guild, user: user('u7'), text: 'a secret' })).row;
  sent.length = 0;
  const answer = await confessions.reply({ guild, user: user('u8'), id: posted.id, text: 'me too' });
  assert.ok(!answer.error, answer.error);
  assert.equal(sent[0].via, 'webhook');
  assert.ok(JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c)).includes('Anonymous reply'));
  config = { ...base, allow_replies: false };
  assert.match((await confessions.reply({ guild, user: user('u8'), id: posted.id, text: 'x' })).error, /not turned on/);

  // The picture it shows: the one of the server, else Petto's own in that server, else the usual one of Petto.
  assert.equal(confessions.avatarFor(guild, { webhook_avatar: 'https://cdn.example/chosen.png' }), 'https://cdn.example/chosen.png');
  assert.equal(confessions.avatarFor(guild, { webhook_avatar: null }), 'https://cdn.example/petto.png', 'the usual picture of Petto');
  ownAvatar = true;
  assert.equal(confessions.avatarFor(guild, { webhook_avatar: null }), 'https://cdn.example/petto-server.png', 'the picture Petto has in that server');
  config = { ...base, cooldown_seconds: 0, webhook_avatar: null };
  sent.length = 0;
  await confessions.submit({ guild, user: user('u9'), text: 'with the avatar' });
  assert.equal(sent[0].avatarURL, 'https://cdn.example/petto-server.png');
  sent.length = 0;
  await confessions.reply({ guild, user: user('u9'), id: posted.id, text: 'reply with the avatar' });
  assert.equal(sent[0].avatarURL, 'https://cdn.example/petto-server.png', 'the replies show it too');
  ownAvatar = false;

  // The review card goes through the webhook too.
  config = { ...base, require_review: true, cooldown_seconds: 0 };
  sent.length = 0;
  await confessions.submit({ guild, user: user('u10'), text: 'review look' });
  assert.equal(sent[0].via, 'webhook');
  assert.equal(sent[0].username, 'Confessions review');

  // The panel goes back to the bottom after a confession, and the staff actions are logged.
  config = { ...base, cooldown_seconds: 0, panel_channel_id: 'c1', panel_message_id: 'panel1', log_channel_id: 'log' };
  sent.length = 0;
  await confessions.submit({ guild, user: user('u11'), text: 'panel goes down' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(deleted, ['panel1'], 'the old panel is deleted');
  assert.ok(sent.some((entry) => entry.via === 'bot' && JSON.stringify(entry.components).includes('cfs:new')), 'the panel is sent again, as the last message');
  assert.notEqual(config.panel_message_id, 'panel1', 'the new panel is remembered');
  sent.length = 0;
  await confessions.logAction(guild, config, 'someone did something');
  assert.equal(sent[0].username, 'Confessions log');
  assert.ok(JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c)).includes('someone did something'));

  // In a server that speaks Spanish the texts nobody changed are in Spanish; what the server wrote stays as it is.
  require('../src/i18n').setCachedGuildLanguage(guild.id, 'es');
  config = { ...base, cooldown_seconds: 0 };
  sent.length = 0;
  await confessions.submit({ guild, user: user('u12'), text: 'en español' });
  const spanish = JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c));
  assert.ok(spanish.includes('Confesión anónima #') && spanish.includes('Responder en anónimo'), 'the usual title and button in Spanish');
  assert.equal(sent[0].username, 'Anónimo');
  config = { ...base, cooldown_seconds: 0, title: 'Secretos #{confession.number}' };
  sent.length = 0;
  await confessions.submit({ guild, user: user('u13'), text: 'own title' });
  assert.ok(JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c)).includes('Secretos #'), 'a title the server wrote is kept');
  config = { ...base, cooldown_seconds: 60 };
  assert.match((await confessions.submit({ guild, user: user('u13'), text: 'again' })).error, /^Espera \d+ segundos? antes/);
  require('../src/i18n').setCachedGuildLanguage(guild.id, 'en');

  // The face of silence at the right side of a confession (not of a reply), the staff sees the author, and the log says who wrote what.
  config = { ...base, cooldown_seconds: 0, log_channel_id: 'log' };
  sent.length = 0;
  result = await confessions.submit({ guild, user: user('u20'), text: 'shh' });
  const shown = JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c));
  assert.ok(/"type":9/.test(shown) && shown.includes('"accessory"') && shown.includes('attachment://shh.png'), 'a section with the picture of silence as its side picture');
  assert.ok(sent[0].files.some((file) => file.name === 'shh.png'), 'and the picture goes with the message');
  const logged = sent.find((entry) => entry.channel === 'log' || entry.username === 'Confessions log');
  assert.ok(logged && JSON.stringify(logged.components.map((c) => c.toJSON?.() ?? c)).includes('<@u20>'), 'the log of the staff says who wrote the confession that was posted');
  sent.length = 0;
  const own = await confessions.reply({ guild, user: user('u21'), id: result.row.id, text: 'a reply' });
  assert.ok(!own.error, own.error);
  const replyShown = JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c));
  assert.ok(!replyShown.includes('attachment://shh.png'), 'a reply has no side picture');
  assert.ok(JSON.stringify(sent.map((entry) => entry.components.map((c) => c.toJSON?.() ?? c))).includes('<@u21>'), 'the log says who wrote the reply');
  config = { ...base, cooldown_seconds: 0, keep_author: false, log_channel_id: 'log' };
  sent.length = 0;
  await confessions.submit({ guild, user: user('u22'), text: 'nobody keeps me' });
  assert.ok(!JSON.stringify(sent.map((entry) => entry.components.map((c) => c.toJSON?.() ?? c))).includes('u22'), 'with no author kept, the log has nobody to name');
  config = { ...base, require_review: true, cooldown_seconds: 0 };
  sent.length = 0;
  await confessions.submit({ guild, user: user('u23'), text: 'check this one' });
  assert.ok(JSON.stringify(sent[0].components).includes('<@u23>'), 'the card of the staff shows who wrote it');

  // The form of the panel: the text, and (when the server allows pictures) the file upload of a form for one picture, not a box for a link. The form of a reply has no picture.
  {
    const handlers = require('../src/interactions/confessions');
    const modals = [];
    const open = (customId, custom = {}) => handlers.handleButton({ customId, guild, guildId: guild.id, user: user('u30'), showModal: async (modal) => { modals.push(modal.toJSON()); }, reply: async () => {}, ...custom });
    const parts = (modal) => modal.components.map((label) => ({ label: label.label, description: label.description, id: label.component.custom_id, type: label.component.type }));
    config = { ...base, allow_images: true, cooldown_seconds: 0 };
    await open('cfs:new');
    assert.deepEqual(parts(modals[0]).map((part) => [part.id, part.type]), [['text', 4], ['image', 19]], 'a text and a file upload (type 19)');
    const upload = modals[0].components[1].component;
    assert.equal(upload.min_values, 0); assert.equal(upload.max_values, 1); assert.equal(upload.required, false, 'one picture, optional');
    assert.ok(parts(modals[0])[1].label.length <= 45 && parts(modals[0])[1].description.length <= 100, 'the label and its description fit what Discord allows');
    config = { ...base, allow_images: false };
    await open('cfs:new');
    assert.deepEqual(parts(modals[1]).map((part) => part.id), ['text'], 'no picture when the server does not allow them');
    config = { ...base, allow_images: true, allow_replies: true };
    await open('cfs:reply:abc');
    assert.deepEqual(parts(modals[2]).map((part) => part.id), ['text'], 'a reply has no picture');

    // Sent: the picture that was dropped goes with the confession; a file that is not a picture is refused; the old text box for a link still works.
    const replies = [];
    const submitted = (fields, files) => ({
      customId: 'cfs:form', guild, guildId: guild.id, user: user('u31'),
      deferReply: async () => {}, editReply: async (payload) => { replies.push(JSON.stringify(payload.components.map((c) => c.toJSON?.() ?? c))); },
      fields: {
        getTextInputValue: (id) => { if (!(id in fields)) throw new Error('no such field'); return fields[id]; },
        getUploadedFiles: (id) => { if (!files) throw new Error('not a file upload'); return new Map(files.map((file, index) => [String(index), file])); },
      },
    });
    config = { ...base, allow_images: true, cooldown_seconds: 0 };
    sent.length = 0;
    await handlers.handleModal(submitted({ text: 'with a dropped picture' }, [{ id: '1', url: 'https://cdn.invalid/a.png', name: 'a.png', contentType: 'image/png' }]));
    assert.equal(sent.length, 1, 'a confession with a dropped picture is posted (the picture is left out here: the link cannot be reached)');
    sent.length = 0;
    await handlers.handleModal(submitted({ text: 'with a document' }, [{ id: '2', url: 'https://cdn.invalid/a.pdf', name: 'a.pdf', contentType: 'application/pdf' }]));
    assert.equal(sent.length, 0, 'a file that is not a picture is not posted');
    assert.ok(replies.at(-1).includes('Only a picture can go with a confession'), 'and the person is told');
    sent.length = 0;
    await handlers.handleModal(submitted({ text: 'no file at all' }, []));
    assert.equal(sent.length, 1, 'no file: just the text');
    sent.length = 0;
    replies.length = 0;
    await handlers.handleModal(submitted({ text: 'a picture that cannot be copied' }, [{ id: '3', url: 'https://cdn.invalid/b.png', name: 'b.png', contentType: 'image/png' }]));
    assert.ok(replies.at(-1).includes('could not be copied'), 'the person is told that the picture could not be copied');
    sent.length = 0;
    await handlers.handleModal(submitted({ text: 'old form', image: 'https://cdn.invalid/old.png' }, null));
    assert.equal(sent.length, 1, 'a form that was open before this change (a text box for a link) still works');
  }

  // A confession with a picture that waits for the staff: the card they get carries the file, and when they approve it the picture goes out with the confession.
  // (It failed with "the referenced attachment (attachment://suggestion.jpg) was not found": the card was sent through a webhook that answered with a plain list of files,
  // the link of the file was not kept, and at the approval the confession pointed to a file it did not carry.)
  {
    const reviewChannel = channels.review;
    const realFetch = reviewChannel.messages.fetch;
    config = { ...base, require_review: true, cooldown_seconds: 0 };

    // The link is kept when the webhook answers with a plain list of files.
    pictureReachable = true; webhookAttachments = [{ url: 'https://cdn.example/raw-list.jpg' }];
    let waitingWithPicture = (await confessions.submit({ guild, user: user('u50'), text: 'raw list', imageUrl: 'https://cdn.example/x.png' })).row;
    assert.equal(rows.get(waitingWithPicture.id).image_url, 'https://cdn.example/raw-list.jpg', 'the link of the file is kept from a plain list');

    // The webhook did not say where the file is (the case that failed): the card is asked for it, and the picture goes out with the confession.
    webhookAttachments = null;
    waitingWithPicture = (await confessions.submit({ guild, user: user('u51'), text: 'asked later', imageUrl: 'https://cdn.example/x.png' })).row;
    assert.equal(rows.get(waitingWithPicture.id).image_url, 'attachment://suggestion.jpg', 'only the name of the file was kept');
    reviewChannel.messages.fetch = async () => ({ id: 'mr', attachments: { first: () => ({ url: 'https://cdn.example/from-the-card.jpg' }) } });
    sent.length = 0;
    let approved = await confessions.decide({ guild, member: staff, id: waitingWithPicture.id, approve: true });
    assert.ok(!approved.error, approved.error);
    assert.equal(sent.length, 1, 'it is posted');
    assert.ok(sent[0].files.some((file) => file.name === 'suggestion.jpg'), 'with the file of the picture');
    assert.ok(JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c)).includes('attachment://suggestion.jpg'), 'and it points to that file');

    // The link that was kept when the card was sent does not open any more (they expire): the card is asked first, and its link is the fresh one.
    webhookAttachments = [{ url: 'https://cdn.example/old-link.jpg' }];
    waitingWithPicture = (await confessions.submit({ guild, user: user('u54'), text: 'old link', imageUrl: 'https://cdn.example/x.png' })).row;
    assert.equal(rows.get(waitingWithPicture.id).image_url, 'https://cdn.example/old-link.jpg');
    staleLinks.add('https://cdn.example/old-link.jpg');
    reviewChannel.messages.fetch = async () => ({ id: 'mr', attachments: { first: () => ({ url: 'https://cdn.example/fresh-link.jpg' }) } });
    sent.length = 0;
    approved = await confessions.decide({ guild, member: staff, id: waitingWithPicture.id, approve: true });
    assert.ok(!approved.error, approved.error);
    assert.ok(sent[0].files.some((file) => file.name === 'suggestion.jpg'), 'the picture goes out although the kept link expired');
    // And when the card cannot be read, the kept link is still tried.
    reviewChannel.messages.fetch = async () => null;
    staleLinks.clear();
    webhookAttachments = [{ url: 'https://cdn.example/kept-link.jpg' }];
    waitingWithPicture = (await confessions.submit({ guild, user: user('u55'), text: 'kept link', imageUrl: 'https://cdn.example/x.png' })).row;
    sent.length = 0;
    approved = await confessions.decide({ guild, member: staff, id: waitingWithPicture.id, approve: true });
    assert.ok(!approved.error && sent[0].files.some((file) => file.name === 'suggestion.jpg'), 'the kept link is used when the card cannot be read');
    webhookAttachments = null;

    // The card cannot be read any more: the confession goes out without the picture instead of failing.
    waitingWithPicture = (await confessions.submit({ guild, user: user('u52'), text: 'lost picture', imageUrl: 'https://cdn.example/x.png' })).row;
    reviewChannel.messages.fetch = async () => null;
    pictureReachable = false;
    sent.length = 0;
    approved = await confessions.decide({ guild, member: staff, id: waitingWithPicture.id, approve: true });
    assert.ok(!approved.error, approved.error);
    assert.equal(sent.length, 1, 'it is posted anyway');
    assert.ok(!(sent[0].files ?? []).some((file) => file.name === 'suggestion.jpg'), 'with no file');
    assert.ok(!JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c)).includes('attachment://suggestion.jpg'), 'and pointing to no file (Discord refuses that)');
    assert.equal(rows.get(waitingWithPicture.id).image_url, null, 'the picture is not kept as a name with no file');
    reviewChannel.messages.fetch = realFetch;
    pictureReachable = false; webhookAttachments = null;

    // The person is told when the picture they asked for could not be copied (the confession still goes); nothing is said when no picture was asked for.
    config = { ...base, require_review: false, cooldown_seconds: 0 };
    const lost = await confessions.submit({ guild, user: user('u56'), text: 'a picture that cannot be had', imageUrl: 'https://cdn.example/x.png' });
    assert.ok(!lost.error && lost.pictureLost === true, 'the confession is posted and says the picture was lost');
    assert.equal((await confessions.submit({ guild, user: user('u57'), text: 'no picture asked' })).pictureLost, false, 'no picture asked, nothing lost');
    pictureReachable = true;
    assert.equal((await confessions.submit({ guild, user: user('u58'), text: 'with a picture', imageUrl: 'https://cdn.example/x.png' })).pictureLost, false, 'a picture that was copied is not lost');
    pictureReachable = false;
  }

  // A confession with a picture link: the picture is copied with `copyPicture` of the suggestions, which has to be exported (it was not, and every
  // confession with a picture failed with "copyPicture is not a function"). A picture that cannot be had (here the link is not reachable) is only left out.
  assert.equal(typeof require('../src/utils/suggestions').copyPicture, 'function', 'suggestions exports copyPicture, which confessions uses');
  config = { ...base, cooldown_seconds: 0, allow_images: true };
  sent.length = 0;
  result = await confessions.submit({ guild, user: user('u24'), text: 'with a picture', imageUrl: 'https://cdn.invalid/picture.png' });
  assert.ok(!result.error && result.row, 'a confession with a picture link is posted (the picture is left out when it cannot be copied)');

  console.log('confessions ok');
})().catch((error) => { console.error(error); process.exit(1); });

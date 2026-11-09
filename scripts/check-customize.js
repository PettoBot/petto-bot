// Checks /customize: the nickname is free, the avatar, banner, description and name style need Premium, what is sent to Discord (the profile of the bot in the
// server) and what is saved, the picture limits and the texts in three languages. Discord, the database and Premium are replaced.
process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

const stub = (relative, exports) => { const resolved = require.resolve(path.join(__dirname, '..', relative)); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };
const saved = [];
let premium = false;
stub('src/db/database.js', { from: () => ({ upsert: async (row) => { saved.push(row); return { error: null }; }, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { bot_nickname: 'Pet', bot_avatar_url: 'discord', bot_description: null } }) }) }) }) });
stub('src/db/guilds.js', { ensureGuild: async () => ({}) });
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: premium }) });
const command = require('../src/commands/utility/customize.js');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), Buffer.from([0, 0, 0, 8, 0, 0, 0, 8]), Buffer.alloc(8)]);

(async () => {
  // The command: in each server, with the permission to manage it, every subcommand named with whole words.
  const json = command.data.toJSON();
  assert.equal(command.guildScoped, true); assert.equal(command.registerSlash, true);
  assert.deepEqual(json.options.map((option) => option.name), ['nickname', 'avatar', 'banner', 'description', 'namestyle', 'reset', 'view']);
  assert.equal(json.default_member_permissions, '32', 'Manage Server');

  // What is sent to Discord and what is saved.
  assert.deepEqual(command.planFor('nickname', 'Pet').discord, { nick: 'Pet' });
  assert.deepEqual(command.planFor('nickname', '').discord, { nick: null }, 'an empty nickname goes back to the default');
  assert.deepEqual(command.planFor('description', 'hi').columns, { bot_description: 'hi' });
  assert.deepEqual(command.planFor('avatar', null).discord, { avatar: null });
  assert.deepEqual(command.planFor('namestyle', { fontId: 11, effectId: 2, colors: [1, 2] }).discord, { display_name_font_id: 11, display_name_effect_id: 2, display_name_colors: [1, 2] });
  assert.deepEqual(command.planFor('namestyle', null).discord, { display_name_font_id: 0, display_name_effect_id: 0, display_name_colors: [] }, 'no style clears the ids');

  // Pictures: a PNG, JPG, GIF or WebP of at most 8 MB; anything else is refused.
  assert.match(await command.attachmentToDataUri({ url: 'https://cdn.example/a.png' }, async () => png), /^data:image\/png;base64,/);
  await assert.rejects(command.attachmentToDataUri({ url: 'https://cdn.example/a.txt' }, async () => Buffer.from('hello, this is text, not a picture at all')), /bad/);
  await assert.rejects(command.attachmentToDataUri({ url: 'https://cdn.example/a.png' }, async () => { throw new Error('too big'); }), /bad/);
  await assert.rejects(command.attachmentToDataUri(null), /bad/);

  // The commands, with a fake Discord.
  const patches = [];
  const answers = [];
  const run = async (sub, options = {}, lang = 'en') => {
    answers.length = 0;
    await command.execute({
      pettoLang: lang, guild: { id: '1' }, client: { rest: { patch: async (route, request) => { patches.push({ route, body: request.body }); } } },
      options: { getSubcommand: () => sub, getString: (name) => options[name] ?? null, getAttachment: () => options.image ?? null },
      deferReply: async () => {}, editReply: async (payload) => { answers.push(JSON.stringify(payload)); },
    });
    return answers.at(-1);
  };

  // The nickname is free.
  let text = await run('nickname', { name: '  Mochi  ' });
  assert.deepEqual(patches.at(-1), { route: '/guilds/1/members/@me', body: { nick: 'Mochi' } });
  assert.equal(saved.at(-1).bot_nickname, 'Mochi'); assert.match(text, /Nickname changed/);
  text = await run('nickname');
  assert.deepEqual(patches.at(-1).body, { nick: null }); assert.match(text, /Nickname is back to the default/);

  // The rest needs Premium, also to reset it; nothing is sent or saved without it.
  const before = patches.length;
  for (const [sub, options] of [['description', { text: 'x' }], ['namestyle', { effect: '2', color: '#ff91c2', 'second-color': '#8399ff' }], ['reset', { field: 'avatar' }], ['reset', { field: 'all' }]]) {
    text = await run(sub, options);
    assert.match(text, /needs Premium/, `${sub} needs Premium`);
  }
  assert.equal(patches.length, before, 'nothing is sent to Discord without Premium');
  assert.match(await run('description', { text: 'x' }, 'es'), /requiere Premium/);
  assert.match(await run('description', { text: 'x' }, 'pt-BR'), /exige Premium/);

  premium = true;
  text = await run('description', { text: 'My bot' });
  assert.deepEqual(patches.at(-1).body, { bio: 'My bot' }); assert.equal(saved.at(-1).bot_description, 'My bot'); assert.match(text, /Description changed/);
  text = await run('namestyle', { effect: '2', color: '#ff91c2', 'second-color': '#8399ff', font: '3' });
  assert.deepEqual(patches.at(-1).body, { display_name_font_id: 3, display_name_effect_id: 2, display_name_colors: [0xff91c2, 0x8399ff] });
  assert.deepEqual(saved.at(-1).bot_name_style, { fontId: 3, effectId: 2, colors: [0xff91c2, 0x8399ff] });
  const patched = patches.length;
  text = await run('namestyle', { effect: '2', color: '#ff91c2' });
  assert.match(text, /needed for this effect/, 'Gradient needs two colors'); assert.equal(patches.length, patched, 'a bad color sends nothing');
  text = await run('namestyle', { effect: '1', color: 'pink' });
  assert.match(text, /Write the color/);
  text = await run('namestyle', { effect: '1', color: 'ff91c2' });
  assert.deepEqual(patches.at(-1).body.display_name_colors, [0xff91c2], 'one color for the other effects, the # is optional');
  await run('reset', { field: 'all' });
  assert.equal(patches.length - patched - 1, 5, 'everything is reset one thing at a time');
  assert.match(await run('avatar', { image: { url: 'https://cdn.example/x.png' } }), /not a PNG|Avatar changed/, 'a picture that cannot be loaded is answered, not thrown');

  // View: what is changed and what is default.
  text = await run('view');
  assert.match(text, /How Petto looks in this server/); assert.match(text, /\*\*Pet\*\*/); assert.match(text, /Avatar: changed/); assert.match(text, /Banner: default/);

  console.log('check-customize: ok');
})().catch((error) => { console.error(error); process.exit(1); });

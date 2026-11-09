// Checks /premium add, remove, servers and info: who can give a slot to which server, every refusal, the list of servers of the option and the texts in three languages.
// Discord and the database are replaced.
process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');
const { PermissionFlagsBits, Collection } = require('discord.js');

const stub = (relative, exports) => { const resolved = require.resolve(path.join(__dirname, '..', relative)); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };
let premium = { active: true, assignments: [], slotsUsed: 0, slotsTotal: 2 };
let assignResult = { ok: true, assignment: {} };
let unassignResult = { ok: true, assignments: [{}] };
const calls = [];
stub('src/db/premium.js', {
  getUserPremium: async () => premium,
  assignPremiumSlot: async (user, guild) => { calls.push(['assign', user, guild]); return assignResult; },
  unassignPremiumSlot: async (user, guild) => { calls.push(['unassign', user, guild]); return unassignResult; },
});
const command = require('../src/commands/info/premium.js');
const servers = require('../src/utils/premiumServers.js');

const ME = '111111111111111111';
const member = (perms) => ({ id: ME, permissions: { has: (bits) => (perms & bits) !== 0n } });
const guildOf = (id, name, { owner = '999999999999999999', perms = null } = {}) => ({ id, name, ownerId: owner, members: { cache: new Collection(perms === null ? [] : [[ME, member(perms)]]), fetch: async () => (perms === null ? null : member(perms)) } });
const A = guildOf('200000000000000001', 'Alpha Server', { perms: PermissionFlagsBits.Administrator });
const B = guildOf('200000000000000002', 'Beta Server', { perms: PermissionFlagsBits.ManageGuild });
const C = guildOf('200000000000000003', 'Gamma Server', { perms: PermissionFlagsBits.SendMessages });
const D = guildOf('200000000000000004', 'Delta Server', { owner: ME, perms: 0n });
const E = guildOf('200000000000000005', 'Echo Server');
const client = { guilds: { cache: new Collection([A, B, C, D, E].map((guild) => [guild.id, guild])) } };

(async () => {
  // Who can manage a server.
  assert.equal(servers.canManageMember(A, member(PermissionFlagsBits.Administrator)), true);
  assert.equal(servers.canManageMember(B, member(PermissionFlagsBits.ManageGuild)), true);
  assert.equal(servers.canManageMember(C, member(PermissionFlagsBits.SendMessages)), false);
  assert.equal(servers.canManageMember(D, member(0n)), true, 'the owner');
  assert.equal(servers.canManageMember(E, null), false);
  assert.deepEqual((await servers.manageableGuilds(client, ME)).map((guild) => guild.name), ['Alpha Server', 'Beta Server', 'Delta Server'], 'only the servers of an administrator, by name');
  assert.deepEqual((await servers.manageableGuilds(client, ME, 'bet')).map((guild) => guild.name), ['Beta Server'], 'what was typed');
  assert.equal(servers.findGuild(client, A.id), A); assert.equal(servers.findGuild(client, 'beta server'), B); assert.equal(servers.findGuild(client, 'nothing'), null);

  // The command: the slash menu, global, with the autocomplete on `server`.
  const json = command.data.toJSON();
  assert.deepEqual(json.options.map((option) => option.name), ['status', 'add', 'remove', 'servers', 'info']);
  assert.ok(!command.prefixOnly, '/premium is a slash command');
  assert.ok(!command.guildScoped, 'and a global one');
  assert.equal(json.options.find((option) => option.name === 'add').options[0].autocomplete, true);

  // The answers.
  const answers = [];
  const run = async (sub, { server = null, lang = 'en', guild = A } = {}) => {
    answers.length = 0;
    await command.execute({
      pettoLang: lang, guild, user: { id: ME }, client,
      options: { getSubcommand: () => sub, getString: () => server, getUser: () => null },
      reply: async (payload) => { answers.push(JSON.stringify(payload)); },
    });
    return answers.at(-1);
  };
  premium = { active: true, assignments: [], slotsUsed: 1, slotsTotal: 2 };
  let text = await run('add');
  assert.deepEqual(calls.at(-1), ['assign', ME, A.id], 'this server by default'); assert.match(text, /Premium is now active in \*\*Alpha Server\*\*/); assert.match(text, /1 \/ 2/);
  text = await run('add', { server: B.id });
  assert.deepEqual(calls.at(-1), ['assign', ME, B.id], 'the server of the option');
  const before = calls.length;
  text = await run('add', { server: C.id }); assert.match(text, /Administrator or Manage Server/); assert.equal(calls.length, before, 'a server where they are not an administrator is not touched');
  text = await run('add', { server: 'nowhere' }); assert.match(text, /not in that server/);
  premium = { ...premium, active: false };
  text = await run('add'); assert.match(text, /do not have an active Premium/); assert.match(text, /petto\.sbs\/premium/); assert.equal(calls.length, before);
  premium = { ...premium, active: true };
  assignResult = { ok: false, code: 'server_taken' }; assert.match(await run('add'), /already has Premium from another person/);
  assignResult = { ok: false, code: 'no_slots', used: 2, limit: 2 }; assert.match(await run('add'), /used all your Premium slots \(2 \/ 2\)/);
  assignResult = { ok: true, already: true }; assert.match(await run('add'), /already has your Premium/);
  assert.match(await run('add', { lang: 'es' }), /ya tiene tu Premium/); assert.match(await run('add', { lang: 'pt-BR' }), /já tem o seu Premium/);

  text = await run('remove'); assert.deepEqual(calls.at(-1), ['unassign', ME, A.id]); assert.match(text, /Premium left \*\*Alpha Server\*\*/);
  unassignResult = { ok: false, code: 'no_assignment' }; assert.match(await run('remove'), /does not have a slot of yours/);

  premium = { active: true, assignments: [{ guild_id: A.id }, { guild_id: '300000000000000009' }], slotsUsed: 2, slotsTotal: 3 };
  text = await run('servers'); assert.match(text, /Your Premium servers \(2 \/ 3\)/); assert.match(text, /Alpha Server/);
  premium = { active: true, assignments: [], slotsUsed: 0, slotsTotal: 3 };
  assert.match(await run('servers'), /No servers assigned/);
  assert.match(await run('info'), /\/premium add/);

  // The list of the option.
  const choices = [];
  const complete = async (sub, typed) => { await command.autocomplete({ user: { id: ME }, client, options: { getFocused: () => ({ name: 'server', value: typed }), getSubcommand: () => sub }, respond: async (list) => { choices.length = 0; choices.push(...list); } }); return choices.map((choice) => choice.name); };
  premium = { active: true, assignments: [{ guild_id: B.id }], slotsUsed: 1, slotsTotal: 2 };
  assert.deepEqual(await complete('add', ''), ['Alpha Server', '★ Beta Server', 'Delta Server'], 'the servers they manage, the ones that have their slot marked');
  assert.equal(choices[0].value, A.id);
  assert.deepEqual(await complete('remove', ''), ['★ Beta Server'], 'to remove, the servers that hold their slot');
  assert.deepEqual(await complete('add', 'del'), ['Delta Server']);

  // The status of your own: the buttons and the menus under the card.
  {
    premium = { active: true, assignments: [{ guild_id: B.id }], slotsUsed: 1, slotsTotal: 2, status: 'active', entitlement: {}, activeEntitlements: [{ plan_key: 'premium-1' }] };
    let collect = null;
    const edits = [];
    const message = { createMessageComponentCollector: () => ({ on: (event, fn) => { if (event === 'collect') collect = fn; } }), edit: async () => {} };
    const rowsOf = (payload) => JSON.parse(JSON.stringify(payload.components[0])).components.filter((node) => node.type === 1);
    const ids = (payload) => rowsOf(payload).map((row) => row.components.map((component) => component.custom_id ?? 'link'));
    let first = null;
    await command.execute({
      pettoLang: 'en', guild: A, user: { id: ME, displayAvatarURL: () => 'https://x/a.png' }, client,
      options: { getSubcommand: () => 'status', getUser: () => null },
      reply: async (payload) => { first = payload; return message; },
    });
    assert.deepEqual(ids(first), [['premium_add_here'], ['premium_add_pick'], ['premium_remove_pick'], ['link', 'link']], 'a button for this server, a menu to give, a menu to take back, and the links');
    const addMenu = rowsOf(first)[1].components[0]; const removeMenu = rowsOf(first)[2].components[0];
    assert.deepEqual(addMenu.options.map((option) => option.label), ['Alpha Server', 'Delta Server'], 'the menu to give lists the servers you manage that do not have your slot yet (Beta already has it)');
    assert.deepEqual(removeMenu.options.map((option) => option.label), ['Beta Server'], 'the menu to take back lists the servers that hold your slot');
    assert.equal(rowsOf(first)[0].components[0].disabled ?? false, false, 'the button is on: you manage this server and have a slot left');
    // Somebody else presses a button: told in private, nothing changes.
    const replies = [];
    const before = calls.length;
    await collect({ user: { id: 'other' }, customId: 'premium_add_here', reply: async (payload) => replies.push(payload) });
    assert.equal(calls.length, before); assert.match(JSON.stringify(replies), /for who asked/);
    // The owner picks a server in the menu: the slot is given and the card is drawn again with what happened.
    assignResult = { ok: true, assignment: {} };
    await collect({ user: { id: ME }, client, customId: 'premium_add_pick', values: [D.id], deferUpdate: async () => {}, editReply: async (payload) => edits.push(payload), followUp: async () => {} });
    assert.deepEqual(calls.at(-1), ['assign', ME, D.id]);
    assert.match(JSON.stringify(edits.at(-1)), /Premium is now active in \*\*Delta Server\*\*/);
    await collect({ user: { id: ME }, client, customId: 'premium_remove_pick', values: [B.id], deferUpdate: async () => {}, editReply: async (payload) => edits.push(payload), followUp: async () => {} });
    assert.deepEqual(calls.at(-1), ['unassign', ME, B.id]);
    // No slots left: no menu to give, and the button of a server without your slot is off.
    premium = { ...premium, slotsUsed: 2 };
    let full = null;
    await command.execute({ pettoLang: 'en', guild: A, user: { id: ME, displayAvatarURL: () => 'https://x/a.png' }, client, options: { getSubcommand: () => 'status', getUser: () => null }, reply: async (payload) => { full = payload; return message; } });
    assert.deepEqual(ids(full).map((row) => row[0]), ['premium_add_here', 'premium_remove_pick', 'link']);
    assert.equal(rowsOf(full)[0].components[0].disabled, true);
  }

  console.log('check-premium-slash: ok');
})().catch((error) => { console.error(error); process.exit(1); });

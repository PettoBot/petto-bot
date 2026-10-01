// Runs every info command against fake guilds, members and channels and checks that each reply is a valid
// Components V2 card: at most 40 components, 4000 characters of text, 5 buttons and no empty text blocks.
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const { ChannelType, PermissionsBitField, Collection } = require('discord.js');
function stub(rel, exports) { const r = require.resolve(path.join(root, rel)); require.cache[r] = { id: r, filename: r, loaded: true, exports }; }
stub('src/db/inviteTracking.js', {
  getStats: async () => ({ joins: 12, leaves: 4 }),
  getLeaderboard: async () => Array.from({ length: 10 }, (_, i) => ({ inviter_id: '30000000000000000' + i, joins: 50 - i, leaves: i })),
});

let checked = 0;
function check(name, payload) {
  const problems = [];
  const json = payload.components.map((c) => c.toJSON());
  let count = 0, chars = 0, buttons = 0;
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.type === 'number') count++;
    if (o.type === 10) { chars += o.content.length; if (!o.content.trim()) problems.push('empty text'); }
    if (o.type === 2) buttons++;
    Object.values(o).forEach(walk);
  })(json);
  if (count > 40) problems.push('components ' + count);
  if (chars > 4000) problems.push('chars ' + chars);
  if (buttons > 5) problems.push('buttons ' + buttons);
  if (payload.flags !== 32768) problems.push('flags ' + payload.flags);
  if (!payload.allowedMentions || payload.allowedMentions.parse.length) problems.push('mentions');
  assert.equal(problems.length, 0, `${name}: ${problems.join(', ')}`);
  checked += 1;
  return payload;
}

const now = Date.now();
const avatar = (n) => `https://cdn.discordapp.com/avatars/1/${n}.png`;
const mkRole = (i, extra = {}) => ({ id: '4000000000000' + String(i).padStart(4, '0'), name: 'Role ' + i, position: i, color: 0xff91c2, hexColor: '#ff91c2', members: { size: i }, mentionable: true, hoist: false, managed: false, createdTimestamp: now - 1e9, permissions: new PermissionsBitField(['Administrator', 'BanMembers']), iconURL: () => null, ...extra });
const user = (over = {}) => ({ id: '293504726505357312', username: 'liam', globalName: 'Liam', bot: false, createdTimestamp: now - 9e10, accentColor: 0xff91c2, banner: 'abc', flags: { toArray: () => ['ActiveDeveloper', 'HypeSquadOnlineHouse1'] }, displayAvatarURL: () => avatar('g'), bannerURL: () => 'https://cdn.discordapp.com/banners/1/b.png', ...over });
const roles = (n) => { const c = new Collection(); c.set('1', mkRole(0, { id: '1' })); for (let i = 1; i <= n; i++) { const r = mkRole(i); c.set(r.id, r); } return c; };
function member(u, nRoles, over = {}) { return { id: u.id, user: u, displayName: 'Liam ~ the very long display name', nickname: 'nick', displayColor: 0xff91c2, joinedTimestamp: now - 5e9, premiumSinceTimestamp: now - 1e9, premiumSince: new Date(), communicationDisabledUntilTimestamp: now + 3600e3, avatar: 'sv', displayAvatarURL: () => avatar('s'), avatarURL: () => avatar('s'), roles: { cache: roles(nRoles) }, ...over }; }
function guild(nRoles, complete = true) {
  const members = new Collection(); const u = user(); const m = member(u, 3);
  for (let i = 0; i < 5; i++) members.set('m' + i, { ...m, id: 'm' + i, user: { bot: i % 2 === 0 } });
  members.set(u.id, m);
  const channels = new Collection();
  [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildForum].forEach((t, i) => channels.set('c' + i, { id: 'c' + i, type: t }));
  return { id: '1414452131850879080', name: 'Petto Test Server', description: 'x'.repeat(500), memberCount: complete ? members.size : 9999, createdTimestamp: now - 1e11, shardId: 0, premiumTier: 2, premiumSubscriptionCount: 14, verificationLevel: 2, preferredLocale: 'en-US',
    fetchOwner: async () => ({ id: u.id, user: u }), iconURL: () => 'https://cdn.discordapp.com/icons/1/i.png', bannerURL: () => 'https://cdn.discordapp.com/banners/1/b.png', splashURL: () => null,
    members: { cache: members, fetch: async () => m }, channels: { cache: channels }, roles: { cache: roles(nRoles) }, emojis: { cache: new Collection([['a', 1]]) }, stickers: { cache: new Collection() } };
}
function fake(g, options = {}, extra = {}) {
  const out = { payload: null };
  const u = user();
  return { out, interaction: { guild: g, user: u, member: member(u, 3), channel: { id: 'c0', name: 'general', type: ChannelType.GuildText, createdTimestamp: now - 1e9, topic: 'x'.repeat(900), nsfw: false, rateLimitPerUser: 3600, parent: { id: 'p', name: 'Cat' }, permissionsFor: () => new PermissionsBitField(['ViewChannel', 'SendMessages', 'Connect', 'ManageMessages', 'UseApplicationCommands']) },
    client: { user: { id: '9', username: 'Petto', displayAvatarURL: () => avatar('b') }, guilds: { cache: new Map([['1', {}]]) }, uptime: 3.6e7, ws: { ping: 42, shards: new Map([[0, {}]]) }, users: { fetch: async () => user() }, fetchInvite: async (c) => c === 'bad' ? Promise.reject(new Error('x')) : ({ code: c, url: 'https://discord.gg/' + c, memberCount: 1000, presenceCount: 80, expiresTimestamp: now + 1e8, inviter: { username: 'inv' }, channel: { name: 'welcome' }, guild: { id: '5', name: 'Cool Place', description: 'desc', iconURL: () => avatar('i') } }) },
    options: { getUser: () => options.user ?? null, getChannel: () => options.channel ?? null, getRole: () => options.role, getString: (n) => options[n], getSubcommand: () => options.sub ?? 'user' }, reply: async (p) => { out.payload = p; }, ...extra } };
}
async function run(file, label, g, options) {
  const cmd = require(`${root}/src/commands/info/${file}`);
  const { out, interaction } = fake(g, options);
  await cmd.execute(interaction);
  return check(`${file}${label ? ' (' + label + ')' : ''}`, out.payload);
}
(async () => {
  const g = guild(10);
  await run('serverinfo', 'complete cache', g);
  await run('serverinfo', 'partial cache', guild(10, false));
  await run('userinfo', 'in server', g);
  const hundreds = guild(250);
  const big = hundreds.members.cache.get('293504726505357312'); big.roles.cache = roles(250);
  await run('userinfo', '250 roles', hundreds);
  await run('userinfo', 'not in server', { ...g, members: { cache: new Collection(), fetch: async () => { throw new Error('no'); } }, memberCount: 0 });
  await run('botinfo', '', g);
  await run('channelinfo', 'text', g);
  await run('channelinfo', 'thread', g, { channel: { id: 't', name: 'a thread', type: ChannelType.PublicThread, createdTimestamp: now, isThread: () => true, parent: { id: 'c0' }, ownerId: '5', archived: false, locked: true, memberCount: 3 } });
  await run('channelinfo', 'voice', g, { channel: { id: 'v', name: 'Voice', type: ChannelType.GuildVoice, createdTimestamp: now, bitrate: 64000, userLimit: 5, parent: null } });
  await run('roleinfo', '', g, { role: mkRole(3, { iconURL: () => avatar('r') }) });
  await run('roleinfo', 'no perms', g, { role: mkRole(4, { color: 0, permissions: new PermissionsBitField(), members: undefined }) });
  await run('emojiinfo', 'static', g, { emoji: '<:petto_star:1527894282135146516>' });
  await run('emojiinfo', 'animated', g, { emoji: '<a:peto_load:1527894241290883152>' });
  await run('emojiinfo', 'not custom', g, { emoji: 'hi' });
  await run('inviteinfo', '', g, { code: 'https://discord.gg/abc' });
  await run('inviteinfo', 'invalid', g, { code: 'bad' });
  await run('avatar', 'server avatar', g, { user: user() });
  await run('banner', '', g);
  await run('banner', 'none', g, { user: user({ banner: null }) });
  await run('color', '', g, { hex: '#ff91c2' });
  await run('color', 'short hex', g, { hex: 'f' });
  await run('color', 'invalid', g, { hex: 'zzz' });
  await run('roles', '250 roles', hundreds);
  await run('roles', 'none', { ...g, roles: { cache: new Collection([['1', mkRole(0, { id: '1' })]]) } });
  await run('permissions', '', g);
  await run('invites', 'user', g, { sub: 'user' });
  await run('invites', 'top', g, { sub: 'top' });
  console.log(`Checked ${checked} info card layouts against Discord's component limits.`);
})().catch((e) => { console.error(e); process.exit(1); });

// Checks `!channel create`: only the owner and the developers, every kind of channel (media among them), the name,
// the category, the topic, and the answers when Discord says no.
const assert = require('node:assert/strict');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { ownerId: '1', developerIds: ['2'] });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const command = require('../src/commands/moderation/channel');

const created = [];
let failWith = null;
function run(userId, options, { canManage = true } = {}) {
  const sent = [];
  const guild = {
    id: '10',
    members: { me: { permissions: { has: (flag) => canManage && flag === PermissionFlagsBits.ManageChannels } } },
    channels: { create: async (data) => { if (failWith) throw failWith; created.push(data); return { id: '555' }; } },
  };
  const interaction = {
    guild, user: { id: userId, tag: 'someone' },
    options: {
      getSubcommand: () => 'create',
      getString: (name) => options[name] ?? null,
      getChannel: (name) => options[name] ?? null,
      getBoolean: (name) => (options[name] === undefined ? null : options[name]),
    },
    deferReply: async () => {}, editReply: async (payload) => sent.push(JSON.stringify(payload.components.map((c) => c.toJSON()))),
  };
  return command.execute(interaction).then(() => sent[0]);
}

(async () => {
  const data = command.data.toJSON();
  const sub = data.options.find((option) => option.name === 'create');
  assert.ok(sub, 'there is a create subcommand');
  assert.deepEqual(sub.options.find((option) => option.name === 'type').choices.map((choice) => choice.value), ['text', 'announcement', 'voice', 'stage', 'forum', 'media', 'category']);
  assert.equal(sub.options.find((option) => option.name === 'category').channel_types[0], ChannelType.GuildCategory);
  assert.equal(sub.options[0].required, true); assert.equal(data.options.length <= 25, true);

  // Only the team.
  assert.match(await run('99', { name: 'x' }), /only for Petto's team/);
  assert.equal(created.length, 0, 'nothing is created for anyone else');
  assert.match(await run('1', { name: 'x' }, { canManage: false }), /Manage Channels/);

  // A media channel, as the owner and as a developer.
  const category = { id: '777' };
  let answer = await run('1', { name: 'Fan  Art Gallery', type: 'media', category, topic: 'Share your art', nsfw: false });
  assert.match(answer, /Created the media channel <#555>/);
  assert.deepEqual(created[0], { name: 'fan-art-gallery', type: ChannelType.GuildMedia, parent: '777', topic: 'Share your art', nsfw: false, reason: 'Created by someone with the channel command' });
  answer = await run('2', { name: 'wallpapers', type: 'media' });
  assert.match(answer, /media channel/); assert.equal(created[1].type, ChannelType.GuildMedia); assert.equal('parent' in created[1], false); assert.equal('topic' in created[1], false);

  // The other kinds.
  await run('1', { name: 'General Voice', type: 'voice' }); assert.equal(created[2].name, 'General Voice', 'a voice channel keeps its name'); assert.equal(created[2].type, ChannelType.GuildVoice);
  await run('1', { name: 'Info', type: 'category', category, topic: 'ignored' });
  assert.equal(created[3].type, ChannelType.GuildCategory); assert.equal('parent' in created[3], false, 'a category is not inside a category'); assert.equal('topic' in created[3], false); assert.equal('nsfw' in created[3], false);
  await run('1', { name: 'rules', topic: 'Read them' }); assert.equal(created[4].type, ChannelType.GuildText, 'text is the default'); assert.equal(created[4].topic, 'Read them');
  await run('1', { name: 'voice-only', type: 'stage', topic: 'no topic here' }); assert.equal('topic' in created[5], false, 'a stage has no topic');
  await run('1', { name: 'help', type: 'forum' }); assert.equal(created[6].type, ChannelType.GuildForum);
  await run('1', { name: 'x'.repeat(150) }); assert.equal(created[7].name.length, 100, 'the name is cut at 100 characters');

  // Discord says no.
  failWith = Object.assign(new Error('Invalid Form Body type[CHANNEL_TYPE_INVALID]: Guild needs Community enabled'), { code: 50035 });
  assert.match(await run('1', { name: 'art', type: 'media' }), /Media channels need \*\*Community\*\* and \*\*monetization\*\*/);
  failWith = Object.assign(new Error('Guild needs Community enabled'), { code: 40000 });
  assert.match(await run('1', { name: 'help', type: 'forum' }), /Forum channels need \*\*Community\*\*/);
  failWith = Object.assign(new Error('Invalid Form Body type[CHANNEL_TYPE_INVALID]: Guild needs Community enabled'), { code: 50035 });
  failWith = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  assert.match(await run('1', { name: 'art' }), /do not have permission/);
  failWith = Object.assign(new Error('Maximum number of channels reached'), { code: 30013 });
  assert.match(await run('1', { name: 'art' }), /limit of channels/);
  failWith = new Error('boom');
  assert.match(await run('1', { name: 'art' }), /Discord did not create it: boom/);

  console.log('channel create ok');
})().catch((error) => { console.error(error); process.exit(1); });

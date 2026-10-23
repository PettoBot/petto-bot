// Checks the media channels: the rules (pictures, videos, links of some sites, captions), the names of the sites, and the event that deletes
// what does not fit and says why once in a while. No Discord and no database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const rules = require('../src/utils/mediaOnly');
const db = require('../src/db/mediaOnly');

const { evaluate, parseNetworks, networkOf, linksOf, attachmentKind } = rules;
const img = { contentType: 'image/png', name: 'a.png' };
const vid = { contentType: 'video/mp4', name: 'a.mp4' };
const aud = { contentType: 'audio/mpeg', name: 'a.mp3' };
const doc = { contentType: 'application/pdf', name: 'a.pdf' };
const base = { attachments_enabled: false, links_enabled: false, allow_images: true, allow_videos: true, allow_audio: false, allow_files: false, networks: [], allow_caption: true };

(async () => {
  // ---- the kind of an attachment
  assert.equal(attachmentKind(img), 'image'); assert.equal(attachmentKind(vid), 'video'); assert.equal(attachmentKind(aud), 'audio'); assert.equal(attachmentKind(doc), 'file');
  assert.equal(attachmentKind({ name: 'photo.JPG' }), 'image', 'by the end of the name when there is no type');
  assert.equal(attachmentKind({ name: 'clip.mov' }), 'video');

  // ---- the sites
  assert.equal(networkOf('www.youtube.com'), 'youtube'); assert.equal(networkOf('youtu.be'), 'youtube'); assert.equal(networkOf('m.youtube.com'), 'youtube');
  assert.equal(networkOf('x.com'), 'twitter'); assert.equal(networkOf('mobile.twitter.com'), 'twitter');
  assert.equal(networkOf('pinterest.com'), 'pinterest'); assert.equal(networkOf('es.pinterest.com'), 'pinterest'); assert.equal(networkOf('pinterest.co.uk'), 'pinterest'); assert.equal(networkOf('pin.it'), 'pinterest');
  assert.equal(networkOf('open.spotify.com'), 'spotify'); assert.equal(networkOf('evilyoutube.com'), 'other', 'a look-alike host is not the site'); assert.equal(networkOf('youtube.com.evil.io'), 'other');
  assert.deepEqual(parseNetworks('YouTube, x ig'), ['youtube', 'twitter', 'instagram']);
  assert.deepEqual(parseNetworks(''), []); assert.deepEqual(parseNetworks('any'), []); assert.deepEqual(parseNetworks('youtube any'), []);
  assert.equal(parseNetworks('youtube, nope'), null, 'an unknown site is refused');
  assert.equal(linksOf('see <https://youtu.be/abc> and https://x.com/a/status/1.').length, 2);
  assert.equal(linksOf('no links here').length, 0);

  // ---- pictures channel
  const picChannel = { ...base, attachments_enabled: true };
  assert.equal(evaluate({ content: '', attachments: [img] }, picChannel).ok, true, 'a picture');
  assert.equal(evaluate({ content: 'look!', attachments: [img, vid] }, picChannel).ok, true, 'a caption and a video');
  assert.equal(evaluate({ content: 'hello', attachments: [] }, picChannel).reason, 'empty_attach', 'only text');
  assert.equal(evaluate({ content: '', attachments: [aud] }, picChannel).reason, 'kind', 'audio is not allowed by default');
  assert.equal(evaluate({ content: '', attachments: [img, doc] }, picChannel).reason, 'kind', 'one bad file spoils the message');
  assert.equal(evaluate({ content: '', attachments: [aud] }, { ...picChannel, allow_audio: true }).ok, true);
  assert.equal(evaluate({ content: '', attachments: [vid] }, { ...picChannel, allow_videos: false }).reason, 'kind', 'videos can be turned off');
  assert.equal(evaluate({ content: 'hi', attachments: [img] }, { ...picChannel, allow_caption: false }).reason, 'caption', 'no text allowed');
  assert.equal(evaluate({ content: 'https://youtu.be/abc', attachments: [] }, picChannel).reason, 'empty_attach', 'a link is not an attachment in a pictures channel');

  // ---- links channel
  const linkChannel = { ...base, links_enabled: true };
  assert.equal(evaluate({ content: 'https://youtu.be/abc', attachments: [] }, linkChannel).ok, true, 'any link');
  assert.equal(evaluate({ content: 'cool https://youtu.be/abc', attachments: [] }, linkChannel).ok, true, 'a caption with the link');
  assert.equal(evaluate({ content: 'cool https://youtu.be/abc', attachments: [] }, { ...linkChannel, allow_caption: false }).reason, 'caption');
  assert.equal(evaluate({ content: 'https://youtu.be/abc', attachments: [] }, { ...linkChannel, allow_caption: false }).ok, true, 'the link alone with no text allowed');
  assert.equal(evaluate({ content: 'hello', attachments: [] }, linkChannel).reason, 'empty_link');
  assert.equal(evaluate({ content: '', attachments: [img] }, linkChannel).reason, 'empty_link', 'an attachment in a links channel');
  const yt = { ...linkChannel, networks: ['youtube', 'twitter'] };
  assert.equal(evaluate({ content: 'https://www.youtube.com/watch?v=1', attachments: [] }, yt).ok, true);
  assert.equal(evaluate({ content: 'https://x.com/a/status/1', attachments: [] }, yt).ok, true);
  assert.equal(evaluate({ content: 'https://instagram.com/p/1', attachments: [] }, yt).reason, 'network', 'a site that is not in the list');
  assert.equal(evaluate({ content: 'https://youtu.be/1 https://instagram.com/p/1', attachments: [] }, yt).reason, 'network', 'one bad link spoils the message');

  // ---- both
  const both = { ...base, attachments_enabled: true, links_enabled: true, networks: ['youtube'] };
  assert.equal(evaluate({ content: '', attachments: [img] }, both).ok, true); assert.equal(evaluate({ content: 'https://youtu.be/1', attachments: [] }, both).ok, true);
  assert.equal(evaluate({ content: 'hello', attachments: [] }, both).reason, 'empty_both');

  // ---- the event
  delete require.cache[require.resolve('../src/events/messageCreateMediaOnly')];
  const event = require('../src/events/messageCreateMediaOnly');
  let ruleMap = new Map([['chan', { ...base, attachments_enabled: true, notice: true, bypass_role_ids: ['vip'] }]]);
  db.getRules = async () => ruleMap;
  const make = ({ content = '', attachments = [], channelId = 'chan', perms = [], roles = [], bot = false, user = 'u1' } = {}) => {
    const sent = []; const state = { deleted: 0 };
    const message = {
      guild: { id: 'g' }, channelId, channel: { id: channelId, isThread: () => false, send: async (p) => { sent.push(p); return { delete: async () => {} }; } },
      author: { id: user, bot }, system: false, content,
      attachments: new Map(attachments.map((a, i) => [String(i), a])),
      member: { permissions: { has: (p) => perms.includes(p) }, roles: { cache: { has: (id) => roles.includes(id) } } },
      delete: async () => { state.deleted += 1; },
    };
    return { message, sent, state };
  };
  let m = make({ content: 'hello' }); await event.execute(m.message);
  assert.equal(m.state.deleted, 1, 'a text message is deleted'); assert.equal(m.sent.length, 1, 'and the person is told');
  m = make({ content: 'hello again' }); await event.execute(m.message);
  assert.equal(m.state.deleted, 1); assert.equal(m.sent.length, 0, 'the notice is not repeated at once for the same person');
  m = make({ content: 'hi', user: 'u2' }); await event.execute(m.message);
  assert.equal(m.sent.length, 1, 'another person gets their own notice');
  m = make({ attachments: [img], user: 'u3' }); await event.execute(m.message);
  assert.equal(m.state.deleted, 0, 'a picture stays');
  m = make({ content: 'hello', channelId: 'other', user: 'u4' }); await event.execute(m.message);
  assert.equal(m.state.deleted, 0, 'another channel is left alone');
  m = make({ content: 'hello', bot: true, user: 'u5' }); await event.execute(m.message);
  assert.equal(m.state.deleted, 0, 'bots are left alone');
  m = make({ content: 'hello', perms: [PermissionFlagsBits.ManageMessages], user: 'u6' }); await event.execute(m.message);
  assert.equal(m.state.deleted, 0, 'who has Manage Messages is left alone');
  m = make({ content: 'hello', roles: ['vip'], user: 'u7' }); await event.execute(m.message);
  assert.equal(m.state.deleted, 0, 'a bypass role is left alone');
  ruleMap = new Map([['chan', { ...base, attachments_enabled: true, notice: false }]]);
  m = make({ content: 'hello', user: 'u8' }); await event.execute(m.message);
  assert.equal(m.state.deleted, 1); assert.equal(m.sent.length, 0, 'no notice when the server turned it off');
  ruleMap = new Map();
  m = make({ content: 'hello', user: 'u9' }); await event.execute(m.message);
  assert.equal(m.state.deleted, 0, 'no media channels, nothing is checked');

  console.log('Checked the media channels: pictures, videos, links by site, captions, and what the channel event deletes and says.');
})().catch((error) => { console.error(error); process.exit(1); });

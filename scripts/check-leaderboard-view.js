// Checks the leaderboard embed with pictures (utils/leaderboardView.js): the podium picture of the first three, the lines of text, the position of
// whoever asked with the progress bar picture, avatars that fail, the caches (finished pictures, avatars, one render for identical requests, the limit
// of pictures drawn at once), and the plain embed that is still answered when a picture cannot be had. The database and the downloads are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');
const { loadImage, createCanvas } = require('@napi-rs/canvas');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const cfg = { curve_a: 1, curve_b: 50, curve_c: 100, difficulty: 2.5, rounding: 50, enabled: true };
const names = ['Mochi', 'Nube', 'Pixel', 'Luna', 'Kiwi', 'Bruma', 'Tofu', 'Rayo', 'Miel', 'Sol'];
let rowCount = 10;
let viewerRow = { xp: 5000, level: 4 };
const { totalXpForLevel } = require('../src/utils/levelCurve');
const rowsOf = (offset) => Array.from({ length: rowCount }, (_, i) => ({ user_id: String(1000 + offset + i), level: 83 - offset - i, xp: totalXpForLevel(83 - offset - i, cfg) + 300, voice_level: 5, voice_xp: 900 - i }));
stub('src/db/levelUsers.js', {
  getLeaderboardPage: async (_g, { offset }) => rowsOf(offset), getVoiceLeaderboardPage: async (_g, { offset }) => rowsOf(offset),
  getUser: async () => viewerRow, getRank: async () => 312, getVoiceRank: async () => 12,
});
let standing = { xp: 450, position: 9 };
let periodRows = [{ user_id: '1000', xp: 12_345 }, { user_id: '1001', xp: 900 }];
stub('src/db/levelPeriods.js', { boardPage: async () => periodRows, memberStanding: async () => standing });
// The podium drawing and the bar can be made to fail, to see the embed without them.
const realPodium = require('../src/imgutils/podiumImage');
let podiumFails = false;
stub('src/imgutils/podiumImage.js', { ...realPodium, drawPodium: (...args) => { if (podiumFails) throw new Error('no canvas'); return realPodium.drawPodium(...args); } });
const realBar = require('../src/utils/rankBar');
let barFails = false;
stub('src/utils/rankBar.js', { ...realBar, renderRankBar: async (options) => { if (barFails) throw new Error('no bar'); return realBar.renderRankBar(options); } });

const { buildLeaderboardReply, compact, displayName, memberLine, clearBoardImages, boardImageCacheSize } = require('../src/utils/leaderboardView');
const { avatarLink, setAvatarFetcher, clearAvatars, avatarCacheSize, loadAvatar } = require('../src/utils/avatarCache');
const { createPictureCache } = require('../src/utils/renderQueue');

const isWebp = (buffer) => buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
const members = new Collection(Array.from({ length: 30 }, (_, i) => [String(1000 + i), { id: String(1000 + i), displayName: names[i % 10] + (i >= 10 ? i : ''), displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${1000 + i}/hash${i}.png?size=256` }]));
const guild = { id: '9', name: 'Petto Server', iconURL: () => 'https://cdn.discordapp.com/icons/9/x.png', members: { cache: members } };
const avatarPng = (() => { const c = createCanvas(64, 64); c.getContext('2d').fillStyle = '#3366ff'; c.getContext('2d').fillRect(0, 0, 64, 64); return c.toBuffer('image/png'); })();
let fetches = [];
setAvatarFetcher(async (link) => { fetches.push(link); return avatarPng; });
const base = { guild, page: 1, totalPages: 7216, total: 72_159, config: cfg, lang: 'en' };

(async () => {
  // Links: only Discord's CDN, as a small WebP.
  assert.equal(avatarLink('https://cdn.discordapp.com/avatars/1/abc.png?size=256', 128), 'https://cdn.discordapp.com/avatars/1/abc.webp?size=128');
  assert.equal(avatarLink('https://media.discordapp.net/avatars/1/abc.jpg', 64), 'https://media.discordapp.net/avatars/1/abc.webp?size=64');
  for (const bad of ['http://cdn.discordapp.com/a.png', 'https://cdn.discordapp.com.evil.test/a.png', 'https://evil.test/cdn.discordapp.com/a.png', 'https://user@cdn.discordapp.com/a.png', 'https://cdn.discordapp.com:8443/a.png', 'not a link', '', null, undefined]) assert.equal(avatarLink(bad), null, `${bad} is not an avatar link`);
  assert.equal(await loadAvatar('https://evil.test/a.png'), null, 'nothing is fetched from another host');
  assert.equal(fetches.length, 0);

  // Small helpers.
  assert.equal(compact('en', 2_400_000), '2.4M'); assert.equal(compact('en', 710_300), '710K'); assert.equal(compact('en', 950), '950'); assert.equal(compact('en', 0), '0');
  assert.match(compact('es', 2_400_000), /^2[.,]4\s?M$/); assert.match(compact('pt-BR', 2_400_000), /^2,4\s?(mi|M)/);
  // The names in the lines: cut by letters with an ellipsis, Markdown and mentions escaped, isolated, whatever they are made of.
  const FSI = '\u2068', PDI = '\u2069';
  const bare = (name, width) => displayName(name, width).slice(1, -1);
  assert.equal(displayName('Mochi'), `${FSI}Mochi${PDI}`, 'a name is wrapped in isolates, so a right-to-left name cannot reorder its neighbours');
  assert.equal(bare('x'.repeat(18)), 'x'.repeat(18), 'eighteen columns fit'); assert.equal(bare('x'.repeat(19)), `${'x'.repeat(17)}\u2026`, 'one more is cut');
  const long = bare('Supercalifragilisticexpialidocious-Mochi-Ultra'); assert.ok(long.endsWith('\u2026') && Array.from(long).length <= 18, `a 45 character name is cut (${long})`);
  assert.equal(bare('\u{1F431}\u{1F525}\u2728'), '\u{1F431}\u{1F525}\u2728', 'a name of emoji only is kept, not turned into a question mark');
  const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'; assert.equal(bare(`${family}${'a'.repeat(30)}`).startsWith(family), true, 'an emoji made of several parts is one letter and is never split');
  assert.ok(Array.from(bare('\u{1F431}'.repeat(30))).length <= 9 && bare('\u{1F431}'.repeat(30)).endsWith('\u2026'), 'emoji count two columns');
  assert.equal(Array.from(bare('\u6f22'.repeat(30))).length, 9, 'wide letters count two columns');
  assert.equal(bare('**bold** _it_ ~~s~~ ||sp|| `c` > #h [a](b)', 80), '\\*\\*bold\\*\\* \\_it\\_ \\~\\~s\\~\\~ \\|\\|sp\\|\\| \\`c\\` \\> \\#h \\[a\\]\\(b\\)', 'Markdown is escaped');
  assert.equal(bare('<@123> @everyone', 80), '\\<\\@123\\> \\@everyone', 'mentions are escaped'); assert.equal(bare('https://x.test', 80), 'https\\://x.test', 'and a link is not made');
  assert.equal(bare('\u202eevil\u202c\u200b\u2066name'), 'evilname', 'bidirectional and zero-width controls are removed');
  const arabic = '\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645'; assert.equal(bare(arabic), arabic, 'a right-to-left name is kept');
  assert.equal(displayName('   '), '?'); assert.equal(displayName('\u200b\u200b'), '?'); assert.equal(bare('Line\nbreak\tname'), 'Line break name', 'no line breaks inside a name');
  const line = memberLine({ position: 4, name: 'Luna', level: 70, xp: 1_500_000 }, 2, 'en');
  assert.equal(line, `\`04\` **${FSI}Luna${PDI}**\u00a0\u00b7 Lv.\u00a070\u00a0\u00b7\u00a01.5M\u00a0XP`);
  assert.equal(memberLine({ position: 12, name: 'Luna', level: null, xp: 12_345 }, 3, 'en'), `\`012\` **${FSI}Luna${PDI}**\u00a0\u00b7 12K\u00a0XP`, 'a week or a month has no level');
  assert.equal(memberLine({ position: 4, name: 'Luna', level: 70, xp: 1_500_000 }, 2, 'es'), `\`04\` **${FSI}Luna${PDI}**\u00a0\u00b7 Nv.\u00a070\u00a0\u00b7\u00a0${compact('es', 1_500_000).replace(/ /g, '\u00a0')}\u00a0XP`);

  // Ten rows: the podium picture first, then the table of the other seven, then the viewer with the bar.
  const reply = await buildLeaderboardReply({ ...base, viewerId: '77' });
  assert.equal(reply.embeds.length, 2); assert.deepEqual(reply.attachments, []);
  assert.deepEqual(reply.files.map((file) => file.name), ['podium.webp', 'rank-bar.png']);
  assert.ok(isWebp(reply.files[0].attachment) && reply.files[1].attachment.subarray(1, 4).toString('latin1') === 'PNG', 'a real WebP podium and a real PNG bar');
  const podium = await loadImage(reply.files[0].attachment);
  assert.deepEqual([podium.width, podium.height], [900, 380]);
  assert.ok(reply.files[0].attachment.length < 40_000, `the podium is small (${reply.files[0].attachment.length} bytes)`);
  const [head, list] = reply.embeds.map((e) => e.toJSON());
  assert.equal(head.image.url, 'attachment://podium.webp'); assert.equal(head.author.name, 'Petto Server • Leaderboard'); assert.ok(head.author.icon_url);
  assert.equal(list.image.url, 'attachment://rank-bar.png');
  const lines = list.description.split('\n').filter((text) => text.startsWith('`'));
  assert.equal(lines.length, 7, 'the seven places after the podium, one line each'); assert.ok(!list.description.includes('```'), 'no code block');
  assert.match(lines[0], /^`04` \*\*\u2068Luna\u2069\*\*\u00a0· Lv\.\u00a080\u00a0·\u00a0/); assert.match(lines[6], /^`10` /);
  assert.match(list.description, /\*\*You\*\*.*#312.* of 72,159.*Level \*\*4\*\*/); assert.match(list.description, /-# .* XP/);
  assert.equal(list.footer.text, '72,159 member(s) · Page 1/7,216', 'the count is written with separators');
  assert.equal(JSON.stringify(reply.embeds.map((e) => e.toJSON().color)), '[4935513,4935513]', 'both embeds have the same color');

  // The second page has no podium: one embed with all ten rows.
  const second = await buildLeaderboardReply({ ...base, page: 2 });
  assert.equal(second.embeds.length, 1); assert.equal(second.files.length, 0, 'no viewer, no podium, no pictures');
  assert.equal(second.embeds[0].toJSON().description.split('\n').filter((text) => text.startsWith('`')).length, 10);
  assert.match(second.embeds[0].toJSON().description, /^`11` /, 'the second page starts at 11');

  // Few rows and none.
  rowCount = 3; let r = await buildLeaderboardReply({ ...base });
  assert.equal(r.embeds.length, 2); assert.equal(r.embeds[1].toJSON().description, undefined, 'three rows are all on the podium');
  rowCount = 1; r = await buildLeaderboardReply({ ...base });
  assert.equal(r.files.length, 1, 'one row is a podium with one place'); assert.ok(isWebp(r.files[0].attachment));
  rowCount = 0; r = await buildLeaderboardReply({ ...base });
  assert.equal(r.files.length, 0); assert.equal(r.embeds[0].toJSON().description, 'No data.');
  rowCount = 10;

  // Avatars that fail: the podium is drawn with initials, and a slow or hanging download does not hold the page.
  clearBoardImages(); clearAvatars();
  setAvatarFetcher(async () => { throw new Error('offline'); });
  let started = Date.now(); r = await buildLeaderboardReply({ ...base });
  assert.ok(r.files.length === 1 && isWebp(r.files[0].attachment), 'a podium with initials when every avatar fails'); assert.ok(Date.now() - started < 1500);
  clearBoardImages(); clearAvatars();
  process.env.AVATAR_FETCH_TIMEOUT_MS = '200';
  setAvatarFetcher(() => new Promise(() => {}));
  started = Date.now(); r = await buildLeaderboardReply({ ...base });
  assert.ok(r.files.length === 1 && Date.now() - started < 1500, 'a download that never answers is given up after the time limit');
  delete process.env.AVATAR_FETCH_TIMEOUT_MS;
  assert.equal(avatarCacheSize().entries >= 3, true, 'and remembered as missing, so it is not asked again at once');
  fetches = []; setAvatarFetcher(async (link) => { fetches.push(link); return avatarPng; }); clearBoardImages(); clearAvatars();

  // The caches: the same top three again is the same picture and no download; a change is a new picture; avatars are shared.
  const first = await buildLeaderboardReply({ ...base });
  assert.equal(fetches.length, 3, 'one download per avatar'); const afterFirst = fetches.length;
  const again = await buildLeaderboardReply({ ...base });
  assert.equal(again.files[0].attachment, first.files[0].attachment, 'the very same picture');
  assert.equal(fetches.length, afterFirst, 'nothing downloaded for a cached picture');
  assert.equal(boardImageCacheSize().entries, 1);
  clearBoardImages();
  const rebuilt = await buildLeaderboardReply({ ...base });
  assert.notEqual(rebuilt.files[0].attachment, first.files[0].attachment, 'a dropped picture is drawn again');
  assert.equal(fetches.length, afterFirst, 'with the avatars still cached');
  const both = await Promise.all([buildLeaderboardReply({ ...base }), buildLeaderboardReply({ ...base })]);
  assert.equal(both[0].files[0].attachment, both[1].files[0].attachment);
  const rows = rowsOf(0); rows[1].level = 99;
  const changed = await buildLeaderboardReply({ ...base, page: 1 }); assert.equal(changed.files[0].attachment, rebuilt.files[0].attachment, 'same data, same picture');
  members.get('1001').displayName = 'Renamed';
  const renamed = await buildLeaderboardReply({ ...base });
  assert.notEqual(renamed.files[0].attachment, rebuilt.files[0].attachment, 'a new name is a new picture'); members.get('1001').displayName = 'Nube';
  assert.equal(avatarCacheSize().entries, 3);
  const timed = process.hrtime.bigint(); await buildLeaderboardReply({ ...base }); await buildLeaderboardReply({ ...base });
  assert.ok(Number(process.hrtime.bigint() - timed) / 1e6 < 100, 'a cached page is built in a few milliseconds');

  // Pictures that cannot be drawn: the embed is still answered, listing everybody and with a thin bar.
  podiumFails = true; barFails = true; clearBoardImages();
  const plain = await buildLeaderboardReply({ ...base, viewerId: '77' });
  assert.equal(plain.embeds.length, 1); assert.equal(plain.files.length, 0); assert.equal(plain.embeds[0].toJSON().image, undefined);
  assert.equal(plain.embeds[0].toJSON().description.split('\n').filter((text) => text.startsWith('`')).length, 10, 'all ten rows are listed');
  assert.match(plain.embeds[0].toJSON().description, /[─━]{20}/, 'a thin bar of plain characters');
  assert.ok(!/<:|\p{Extended_Pictographic}/u.test(plain.embeds[0].toJSON().description), 'no emoji');
  podiumFails = false; barFails = false;

  // The viewer: nobody without XP, the voice position, and the week.
  viewerRow = { xp: 0, level: 0 };
  assert.ok(!(await buildLeaderboardReply({ ...base, viewerId: '77' })).embeds[1].toJSON().description.includes('You'), 'no line for someone with no XP');
  viewerRow = { xp: 5000, level: 4, voice_xp: 800, voice_level: 3 };
  const voice = await buildLeaderboardReply({ ...base, source: 'voice', viewerId: '77' });
  assert.equal(voice.embeds[0].toJSON().author.name, 'Petto Server • Voice leaderboard'); assert.match(voice.embeds[1].toJSON().description, /#12.* of 72,159.*Level \*\*3\*\*/);
  const week = await buildLeaderboardReply({ ...base, period: 'week', total: 2, totalPages: 1, viewerId: '77' });
  assert.equal(week.embeds[0].toJSON().author.name, 'Petto Server • Leaderboard · This week');
  const weekText = week.embeds[1]?.toJSON().description ?? week.embeds[0].toJSON().description;
  assert.ok(!weekText.includes('Lv.'), 'a week has no level'); assert.match(weekText, /\*\*You\*\*.*#9.* of 2.*450 XP/);
  assert.ok(week.files.every((file) => file.name !== 'rank-bar.png'), 'and no bar');

  // Spanish and Portuguese.
  const es = await buildLeaderboardReply({ ...base, lang: 'es', viewerId: '77' }); const ed = es.embeds[1].toJSON().description;
  assert.match(ed, /Nv\.\u00a0\d+/); assert.match(ed, /\*\*Tú\*\*/); assert.match(es.embeds[1].toJSON().footer.text, /miembro/i);
  const pt = await buildLeaderboardReply({ ...base, lang: 'pt-BR', viewerId: '77' });
  assert.match(pt.embeds[1].toJSON().description, /Nív\.\u00a0\d+/); assert.match(pt.embeds[1].toJSON().description, /\*\*Você\*\*/);

  // The cache of pictures and the limit of pictures drawn at once.
  const cache = createPictureCache({ ttlMs: 30, maxEntries: 5 });
  let made = 0; const make = (n) => async () => { made += 1; return { buffer: Buffer.alloc(n) }; };
  const a = await cache.get('a', make(10)); assert.equal(await cache.get('a', make(10)), a); assert.equal(made, 1, 'a hit draws nothing');
  await new Promise((resolve) => setTimeout(resolve, 45)); await cache.get('a', make(10)); assert.equal(made, 2, 'it expires after its time');
  await assert.rejects(cache.get('bad', async () => { throw new Error('x'); })); assert.equal((await cache.get('bad', make(1))).buffer.length, 1, 'a failed render is not kept');
  const big = createPictureCache({ ttlMs: 60_000, maxEntries: 50, maxMb: 1 });
  for (let i = 0; i < 5; i++) await big.get(`k${i}`, make(400 * 1024));
  assert.ok(big.stats().bytes <= 1024 * 1024 && big.stats().entries === 2, 'the oldest go when the size limit is reached');
  process.env.IMAGE_RENDER_CONCURRENCY = '2';
  let active = 0; let peak = 0;
  const slow = createPictureCache({ ttlMs: 1000 });
  await Promise.all(Array.from({ length: 8 }, (_, i) => slow.get(`s${i}`, async () => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1; return { buffer: Buffer.alloc(1) }; })));
  assert.equal(peak, 2, 'no more than the limit are drawn at once'); delete process.env.IMAGE_RENDER_CONCURRENCY;
  clearBoardImages(); clearAvatars();
  console.log('Checked the leaderboard embed: podium picture, lines, your position, avatars, caches, limits and the plain fallback.');
})().catch((error) => { console.error(error); process.exit(1); });

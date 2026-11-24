// The profile of a person is a PICTURE (`/profile`, `!profile`): this checks the rules of the badges (what a plan gives, what fits in the showcase),
// that the picture is drawn for every plan with the real art of the plan stars, that every badge has its name in the three languages, and that the
// command still has its card of the server (`/profile server`) next to the picture. No database and no Discord: they are replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stub = (relative, exports) => {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });
stub('src/config.js', { ownerId: 'owner', developerIds: [] });

const rules = require('../src/utils/profileBadges');
const { renderProfileImage, WIDTH, HEIGHT } = require('../src/utils/profileImage');
const { loadImage } = require('@napi-rs/canvas');

const root = path.join(__dirname, '..');
const langs = ['en', 'es', 'pt-BR'];

(async () => {
  // Places of the showcase: one with no plan, then 2, 4 and 6.
  assert.deepEqual(['none', 'bronze', 'silver', 'gold'].map((key) => rules.SHOWCASE_SLOTS[key]), [1, 2, 4, 6]);
  assert.equal(rules.slotsFor(null), 1);
  assert.equal(rules.slotsFor(rules.planOf('GOLD')), 6);
  assert.equal(rules.planOf('premium-manual-3'), null, 'the Premium of a server is not a plan of a person');
  assert.equal(rules.planOf(undefined), null);

  // What a person owns: what they saved plus the badge of their plan, never a plan badge they only saved, never a made-up one.
  assert.deepEqual(rules.ownedBadges(['femboy', 'plan-gold', 'nope'], null), ['femboy']);
  assert.deepEqual(rules.ownedBadges(['furro'], 'silver').sort(), ['furro', 'plan-silver']);

  // The showcase keeps the order, drops repeats and what they do not own, and stops at the places of the plan.
  assert.deepEqual(rules.normalizeShowcase(['furro', 'furro', 'nope', 'femboy'], ['furro', 'femboy'], 6), ['furro', 'femboy']);
  assert.deepEqual(rules.normalizeShowcase(['a', 'b', 'c'], ['a', 'b', 'c'], 2), ['a', 'b']);
  assert.deepEqual(rules.normalizeShowcase(['furro'], ['furro'], 0), []);
  assert.equal(rules.normalizeShowcase(Array(10).fill('furro'), ['furro'], 99).length, 1);
  assert.deepEqual(rules.BADGES.filter((b) => b.pack === 'fablo').map((b) => b.id), ['furro', 'boykisser', 'hetero', 'femboy'], 'the Fablo pack');
  assert.ok(rules.isSelfBadge('femboy') && !rules.isSelfBadge('plan-gold') && !rules.isSelfBadge('nothing'));

  // Every badge has its name in the three languages, and the art that is named exists.
  for (const lang of langs) {
    const catalog = require(`../src/i18n/locales/${lang}/profiles.js`);
    for (const badge of rules.BADGES.filter((each) => !each.region && !each.language)) assert.ok(catalog[`profiles.badge.${badge.id}`], `${lang}: name of the badge ${badge.id}`);
    for (const badge of rules.SHOP_BADGES) assert.ok(rules.badgeName(lang, badge, () => '') && rules.badgeLabel(badge), `${lang}: a country or language badge is named by the language and drawn with its code`);
    for (const key of ['level', 'rank', 'messages', 'voice', 'badges', 'failed']) assert.ok(catalog[`profiles.image.${key}`], `${lang}: profiles.image.${key}`);
  }
  for (const badge of rules.BADGES.filter((each) => each.art)) assert.ok(fs.existsSync(path.join(root, 'src/assets/badges', badge.art)), `the art ${badge.art} exists`);
  for (const badge of rules.BADGES.filter((each) => each.unlock === 'plan')) assert.ok(badge.art, 'a plan badge always has art');

  // The picture: a PNG of the right size for each plan, with no throw when the avatar and the banner are missing.
  const art = (file) => (file ? loadImage(path.join(root, 'src/assets/badges', file)) : null);
  const base = { name: 'a'.repeat(120), avatar: null, banner: null, stats: [{ label: 'Level', value: '27' }, { label: 'Rank', value: '#3' }, { label: 'Messages', value: '4,812' }, { label: 'Voice', value: '12' }], showcaseTitle: 'Badges' };
  for (const [plan, ids] of [[null, ['femboy']], ['bronze', ['plan-bronze', 'femboy']], ['silver', ['plan-silver', 'furro', 'femboy']], ['gold', ['plan-gold', 'furro', 'boykisser', 'hetero', 'femboy']]]) {
    const showcase = await Promise.all(ids.map(async (id) => { const def = rules.badgeById(id); return { id, art: await art(def.art), color: def.color }; }));
    const png = renderProfileImage({ ...base, planStar: plan ? await art(`plan-${plan}.png`) : null, showcase, slots: rules.slotsFor(plan) });
    assert.ok(Buffer.isBuffer(png) && png.subarray(1, 4).toString() === 'PNG', `a PNG for the plan ${plan}`);
    const image = await loadImage(png);
    assert.equal(image.width, WIDTH); assert.equal(image.height, HEIGHT);
  }

  // A name font of the shop: the name is drawn big with it (a bad font string once left it at 10 px), and it differs from the default look.
  const { GlobalFonts, createCanvas } = require('@napi-rs/canvas');
  const fontFile = path.join(root, 'src/assets/fonts/anton-400.woff2');
  GlobalFonts.register(fs.readFileSync(fontFile), 'shop-anton');
  const ink = async (nameFont) => {
    const png = renderProfileImage({ ...base, name: 'Liam', nameFont, planStar: null, showcase: [], slots: 1 });
    const canvas = createCanvas(WIDTH, HEIGHT); const c = canvas.getContext('2d'); c.drawImage(await loadImage(png), 0, 0);
    const { data } = c.getImageData(230, 60, 400, 70);
    let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) count += 1;
    return count;
  };
  assert.ok(await ink('shop-anton') > 1500, 'the name is big with a font of the shop');
  assert.ok(await ink(null) > 1500, 'and with the default font');

  // The command: the picture is `show` (and what `!profile @member` runs), the old card is `server`, and the badges have their subcommands.
  const profile = require('../src/commands/automation/profile');
  const json = profile.data.toJSON();
  const names = json.options.map((option) => option.name);
  for (const name of ['show', 'server', 'badge', 'showcase', 'config']) assert.ok(names.includes(name), `/profile ${name}`);
  assert.equal(profile.prefixDefaultSubcommand, 'show');
  const showcase = json.options.find((option) => option.name === 'showcase');
  assert.equal(showcase.options.length, rules.MAX_SLOTS, 'one option for each place of the showcase');
  assert.ok(showcase.options[0].required && showcase.options.slice(1).every((option) => !option.required));
  for (const lang of langs) {
    const catalog = require(`../src/i18n/locales/${lang}/cmd.automation.js`);
    for (const key of ['show', 'server', 'badge', 'showcase']) assert.ok(catalog[`cmd.automation.profile.${key}.desc`], `${lang}: description of /profile ${key}`);
  }
  assert.equal(typeof profile.profileText, 'function', 'the card of the server is still there');

  // The frames of the badges (iron, gold, mithril) are pictures: each one loads, and a badge drawn with one is not the same picture as without it; a plan star is drawn alone.
  const view = require('../src/utils/profileView');
  for (const id of ['normal', 'bright', 'divine']) assert.ok(await view.frameOf(id), `the picture of the frame ${id} loads`);
  assert.equal(await view.frameOf('whatever'), await view.frameOf('normal'), 'an unknown frame is the iron one');
  const flagArt = await loadImage(path.join(root, 'node_modules/flag-icons/flags/1x1/es.svg'));
  const withFrame = (frame, id = 'country-es') => ({ id, art: flagArt, color: '#456', frame });
  const draw = async (badge) => { const canvas = require('@napi-rs/canvas').createCanvas(120, 140); const ctx = canvas.getContext('2d'); require('../src/utils/profileImage').drawBadge(ctx, badge, 60, 70, 50); return canvas.toBuffer('image/png'); };
  const plain = await draw(withFrame('divine'));
  const framed = await draw({ ...withFrame('divine'), frameArt: await view.frameOf('divine') });
  assert.notDeepEqual(plain, framed, 'the frame picture is drawn over the badge');
  const starArt = await view.artOf('plan-gold.png');
  assert.deepEqual(await draw({ id: 'plan-gold', art: starArt, color: '#f4cf3a', frame: 'divine', frameArt: await view.frameOf('divine') }), await draw({ id: 'plan-gold', art: starArt, color: '#f4cf3a' }), 'the star of a plan has no frame');

  console.log('profile card checks passed'); // i18n-ignore: output of a check
})().catch((error) => { console.error(error); process.exit(1); });

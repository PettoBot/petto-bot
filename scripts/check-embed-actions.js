// Checks the buttons of an embed code that do something: how a code is read, the custom id that keeps what a button does,
// the buttons the builder makes, and what a click does to the roles.
const assert = require('node:assert/strict');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { verifyBaseUrl: null });
stub('src/db/database.js', { from: () => { throw new Error('no database'); } });
stub('src/db/responders.js', {});
stub('src/utils/templatedMessage.js', { templatePayload: async () => null });
const { parseEmbedScript } = require('../src/utils/embedScript');
const { parseAction, encodeActions, decodeCustomId, roleRefsOf } = require('../src/utils/embedActions');
const { build } = require('../src/utils/embedBuilder');
const { planRoles } = require('../src/interactions/embedButtons');

const ROLE = '111111111111111111';
const OTHER = '222222222222222222';
const guild = {
  id: '999999999999999999',
  members: { cache: new Map() },
  channels: { cache: new Map() },
  roles: { cache: new Map([[ROLE, { id: ROLE, name: 'Members' }], [OTHER, { id: OTHER, name: 'VIP' }]]) },
};
guild.roles.cache.find = (fn) => [...guild.roles.cache.values()].find(fn);

(async () => {
  // Actions: the three role kinds and the saved embed with its three ways to answer.
  assert.deepEqual(parseAction('role:@Members'), { type: 'role', ref: '@Members', mode: null });
  assert.deepEqual(parseAction('embed:rules'), { type: 'embed', ref: 'rules', mode: 'ephemeral' });
  assert.deepEqual(parseAction('embed:rules:dm'), { type: 'embed', ref: 'rules', mode: 'dm' });
  assert.deepEqual(parseAction('embed:rules:public'), { type: 'embed', ref: 'rules', mode: 'public' });
  assert.equal(parseAction('embed:rules:nowhere'), null);
  assert.equal(parseAction('https://petto.sbs'), null);

  // A code with action buttons and a link button side by side.
  const parsed = parseEmbedScript('{embed}&v{description: hi}&v{button: green && Get it && role:@Members && emoji:✅}&v{button: blurple && Rules && embed:rules:dm && addrole:VIP}&v{button: Docs && https://petto.sbs}');
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.buttons[0], { label: 'Get it', style: 'green', actions: [{ type: 'role', ref: '@Members', mode: null }], emoji: '✅', disabled: false });
  assert.equal(parsed.buttons[1].actions.length, 2);
  assert.deepEqual(parsed.buttons[2], { label: 'Docs', url: 'https://petto.sbs', emoji: '', disabled: false });
  assert.deepEqual(roleRefsOf([parsed.buttons]), ['@Members', 'VIP']);
  // No colour given: the button is grey. A colour on a link only warns.
  assert.equal(parseEmbedScript('{button: Get it && role:@Members}').buttons[0].style, 'grey');
  assert.equal(parseEmbedScript('{button: red && Go && https://x.test}').warnings.length, 1);
  assert.equal(parseEmbedScript('{button: green && role:@Members}').buttons.length, 0);

  // The custom id keeps the actions and reads back the same.
  const id = encodeActions([{ type: 'role', ref: '@Members' }, { type: 'removerole', ref: OTHER }, { type: 'embed', ref: 'rules', mode: 'dm' }], guild, 3);
  assert.equal(id, `eb:t${ROLE};r${OTHER};edrules#3`);
  assert.ok(id.length <= 100);
  assert.deepEqual(decodeCustomId(id), { toggle: [ROLE], add: [], remove: [OTHER], embed: { mode: 'dm', name: 'rules' } });
  assert.equal(encodeActions([{ type: 'role', ref: '@Nobody' }], guild), null, 'a role that does not exist gives no button');
  assert.equal(decodeCustomId('petto_other:1'), null);

  // The builder makes coloured buttons with that id, link buttons as before, and drops what it can not keep.
  const payload = await build({ content: '', embeds: [], buttons: [parsed.buttons.map((b) => ({ ...b }))] }, { guild });
  const buttons = payload.components[0].components;
  assert.equal(buttons.length, 3);
  assert.equal(buttons[0].data.style, ButtonStyle.Success);
  assert.ok(buttons[0].data.custom_id.startsWith('eb:t'));
  assert.equal(buttons[1].data.style, ButtonStyle.Primary);
  assert.notEqual(buttons[0].data.custom_id, buttons[1].data.custom_id, 'two buttons of a message never share an id');
  assert.equal(buttons[2].data.style, ButtonStyle.Link);
  const noGuild = await build({ content: '', embeds: [], buttons: [parsed.buttons] });
  assert.equal(noGuild.components[0].components.length, 1, 'without a server only the link button is left');

  // A click: a toggled role is taken when the member has it, given when not; give and take only do what is needed.
  assert.deepEqual(planRoles({ toggle: [ROLE], add: [], remove: [] }, []), { add: [ROLE], remove: [] });
  assert.deepEqual(planRoles({ toggle: [ROLE], add: [], remove: [] }, [ROLE]), { add: [], remove: [ROLE] });
  assert.deepEqual(planRoles({ toggle: [], add: [ROLE], remove: [OTHER] }, [ROLE]), { add: [], remove: [] });
  console.log('Checked the buttons of an embed code that give roles and show embeds.');
})().catch((error) => { console.error(error); process.exit(1); });

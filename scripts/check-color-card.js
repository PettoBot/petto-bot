// /search color and !color (and !hex) draw the same card: the sample picture goes with it, and where Petto or the member cannot attach files the
// card says why instead of leaving the picture out without a word. Slash and prefix must answer the same. Everything runs against fakes.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const color = require('../src/commands/info/color.js');

function fake({ slash, canAttach }) {
  const sent = [];
  const perms = { has: (p) => (p === PermissionFlagsBits.AttachFiles ? canAttach : true) };
  const interaction = {
    guild: { id: 'g', members: { me: {} }, preferredLocale: 'en-US' }, channel: { permissionsFor: () => perms }, member: {}, user: { id: 'u' },
    options: { getString: () => 'ff00ab' }, deferred: false, replied: false,
    isChatInputCommand: () => slash, rawMessage: slash ? undefined : {},
    deferReply: async function () { this.deferred = true; },
    reply: async (payload) => sent.push(payload), editReply: async (payload) => sent.push(payload),
  };
  return { interaction, sent };
}

(async () => {
  const answers = {};
  for (const slash of [true, false]) for (const canAttach of [true, false]) {
    const { interaction, sent } = fake({ slash, canAttach });
    await color.execute(interaction);
    assert.equal(sent.length, 1);
    answers[`${slash ? 'slash' : 'prefix'}-${canAttach}`] = { picture: Boolean(sent[0].files?.length), note: JSON.stringify(sent[0].components).includes('Attach Files') };
  }
  assert.deepEqual(answers['slash-true'], { picture: true, note: false }, 'slash: the picture goes with the card');
  assert.deepEqual(answers['prefix-true'], answers['slash-true'], 'the prefix answers the same');
  assert.deepEqual(answers['slash-false'], { picture: false, note: true }, 'slash without the permission: no picture, and the card says why');
  assert.deepEqual(answers['prefix-false'], answers['slash-false'], 'the prefix answers the same without the permission');
  console.log('Color card checks passed (the picture, and the reason when files cannot be attached, the same for slash and prefix).');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });

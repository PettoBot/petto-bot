const { SlashCommandBuilder } = require('discord.js');
const { languageOf } = require('../../i18n');
const { runEffect, runHex } = require('../../utils/imageCommands');
const { EFFECTS } = require('../../imgutils/imageEffects');

// The effects, as subcommands: what each does and, for the ones that take a number, its name and what it means.
const SUBCOMMANDS = [
  { name: 'invert', description: 'Invert the colors of an image.' },
  { name: 'grayscale', description: 'Turn an image black and white.' },
  { name: 'sepia', description: 'Give an image an old photo look.' },
  { name: 'blur', description: 'Blur an image.', amount: { name: 'amount', description: 'How much, 1-50 (default 8)' } },
  { name: 'pixelate', description: 'Pixelate an image.', amount: { name: 'size', description: 'Size of the pixels, 2-100 (default 12)' } },
  { name: 'rotate', description: 'Rotate an image.', amount: { name: 'degrees', description: 'Degrees, -360 to 360 (default 90)' } },
  { name: 'flip', description: 'Flip an image upside down.' },
  { name: 'mirror', description: 'Mirror an image left to right.' },
  { name: 'circle', description: 'Crop an image into a circle.' },
  { name: 'deepfry', description: 'Deep fry an image.' },
  { name: 'compress', description: 'Save an image as a low quality JPEG.', amount: { name: 'quality', description: 'JPEG quality, 1-100 (default 5)' } },
  { name: 'hex', description: 'Find the main color of an image or avatar.' },
];

const SOURCE_DESCRIPTION = 'A link, a member, or nothing (an attached or replied image, or your avatar)';

const data = new SlashCommandBuilder()
  .setName('image')
  .setDescription('Apply an effect to an image, an avatar or a link.')
  .setDMPermission(false);
for (const sub of SUBCOMMANDS) {
  data.addSubcommand((builder) => {
    builder.setName(sub.name).setDescription(sub.description);
    if (sub.amount) builder.addIntegerOption((opt) => opt.setName(sub.amount.name).setDescription(sub.amount.description).setRequired(false));
    return builder.addStringOption((opt) => opt.setName('source').setDescription(SOURCE_DESCRIPTION).setRequired(false));
  });
}

const SHORT_NUMBER = /^[+-]?\d{1,4}(?:%|°|deg)?$/i;

/**
 * Reads the text after `!image <effect>` (or `!blur`, `!rotate`...): a short number first is the amount of the effect, the rest is
 * the picture (a link, a member). A long number is an ID, so `!rotate 123456789012345678` turns that member's avatar.
 */
function readArgs(effect) {
  const amountName = SUBCOMMANDS.find((sub) => sub.name === effect)?.amount?.name ?? null;
  return (text) => {
    let rest = String(text ?? '').trim();
    const values = {};
    const first = rest.split(/\s+/)[0] ?? '';
    if (amountName && SHORT_NUMBER.test(first)) {
      values[amountName] = Number.parseInt(first, 10);
      rest = rest.slice(first.length).trim();
    }
    if (rest) values.source = rest;
    return values;
  };
}

module.exports = {
  // Also registered as a slash command (it already has subcommands, so it needs no umbrella); the prefix keeps working.
  registerSlash: true,
  aliases: ['img'],
  cooldownMs: 5000,
  data,
  SUBCOMMANDS,
  prefixRawOptions: Object.fromEntries(SUBCOMMANDS.map((sub) => [sub.name, readArgs(sub.name)])),
  readArgs,

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const effect = interaction.options.getSubcommand();
    const source = interaction.options.getString('source');
    if (effect === 'hex') { await runHex(interaction, lang, source); return; }
    const amountName = SUBCOMMANDS.find((sub) => sub.name === effect)?.amount?.name;
    const amount = amountName ? interaction.options.getInteger(amountName) : null;
    if (!EFFECTS[effect]) return;
    await runEffect(interaction, lang, effect, { amount, source });
  },
};

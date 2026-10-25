// The "Steal" button of `!jumbo`: puts the emoji or the sticker that was shown into the server of whoever presses it, if they may.
// The button is locked as soon as it is pressed (so a second press cannot add it twice) and it says Stolen when it is done.
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { textCard } = require('../utils/caseCard');
const { emojiUrl, stickerUrl } = require('../utils/expressions');
const { EMOJI } = require('../utils/emojis');
const { permissionName } = require('../utils/permissionLabels');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

const STEAL_PREFIX = 'jumbo';
const V2 = MessageFlags.IsComponentsV2;
const PRIVATE = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
// The ones being added right now, by server and picture, for the moment between two presses.
const working = new Set();

/** A copy of the card with the button of this id changed (`patch`), wherever it is inside it. */
function withButton(json, customId, patch) {
  const copy = JSON.parse(JSON.stringify(json));
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.custom_id === customId) Object.assign(node, patch);
    walk(node.components);
  };
  walk(copy);
  return copy;
}

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const say = (text, color) => interaction.reply({ components: [textCard(text, color)], flags: PRIVATE });
  const [, kind, id, animated, ...rest] = interaction.customId.split(':');
  const lock = `${interaction.guild?.id}:${kind}:${id}`;

  if (!interaction.guild || !interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuildExpressions)) {
    return say(t(lang, 'utility.jumbo.needYou', { permission: permissionName('ManageGuildExpressions', lang) }), 0xfe6465);
  }
  if (!interaction.guild.members.me?.permissions?.has(PermissionFlagsBits.ManageGuildExpressions)) {
    return say(t(lang, 'utility.steal.needPermission', { permission: permissionName('ManageGuildExpressions', lang) }), 0xfe6465);
  }
  if (working.has(lock)) return say(t(lang, 'utility.jumbo.working'));
  if (kind === 'e' ? interaction.guild.emojis.cache.has(id) : interaction.guild.stickers.cache.has(id)) return say(t(lang, 'utility.jumbo.already'));

  working.add(lock);
  const card = interaction.message?.components?.[0]?.toJSON?.() ?? null;
  const show = (patch) => (card ? interaction.editReply({ components: [withButton(card, interaction.customId, patch)], flags: V2 }) : null);
  try {
    // Lock the button right away, so it cannot be pressed again while the emoji is being added.
    if (card) await interaction.update({ components: [withButton(card, interaction.customId, { disabled: true, label: t(lang, 'utility.jumbo.stealing') })], flags: V2 });
    else await interaction.deferReply({ flags: PRIVATE });

    let text;
    let ok = true;
    try {
      if (kind === 'e') {
        const name = rest.join(':').replace(/\W/g, '_').slice(0, 32) || 'emoji';
        const created = await interaction.guild.emojis.create({ attachment: emojiUrl(id, animated === 'a'), name });
        text = t(lang, 'utility.jumbo.stolenEmoji', { emoji: `${created}`, name: created.name });
      } else {
        const sticker = await interaction.client.fetchSticker(id);
        const url = stickerUrl(sticker);
        if (!url) throw new Error(t(lang, 'utility.steal.lottie'));
        const created = await interaction.guild.stickers.create({ file: url, name: sticker.name, tags: sticker.tags ?? 'e', description: sticker.description ?? '' });
        text = t(lang, 'utility.steal.stickerAdded', { emoji: EMOJI.APPROVE, name: created.name });
      }
    } catch (err) {
      ok = false;
      logger.error('Failed to steal from the jumbo card:', err);
      text = t(lang, 'utility.jumbo.failed', { emoji: EMOJI.DENY, error: err.message });
    }

    // It is stolen: the button stays locked and says so. It failed: the button is free again to try once more.
    await (ok ? show({ disabled: true, label: t(lang, 'utility.jumbo.done') }) : show({ disabled: false })) ?.catch?.(() => {});
    const reply = { components: [textCard(text, ok ? 0xa5ea7a : 0xfe6465)], flags: PRIVATE };
    if (card) await interaction.followUp(reply);
    else await interaction.editReply({ components: reply.components, flags: V2 });
  } finally {
    working.delete(lock);
  }
}

module.exports = { STEAL_PREFIX, handleButton, withButton };

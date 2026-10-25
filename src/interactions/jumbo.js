// The "Steal" button of `!jumbo`: puts the emoji or the sticker that was shown into the server of whoever presses it, if they may.
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { textCard } = require('../utils/caseCard');
const { emojiUrl, stickerUrl } = require('../utils/expressions');
const { EMOJI } = require('../utils/emojis');
const { permissionName } = require('../utils/permissionLabels');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

const STEAL_PREFIX = 'jumbo';
const V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const say = (text, color) => interaction.reply({ components: [textCard(text, color)], flags: V2 });
  const [, kind, id, animated, ...rest] = interaction.customId.split(':');

  if (!interaction.guild || !interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuildExpressions)) {
    return say(t(lang, 'utility.jumbo.needYou', { permission: permissionName('ManageGuildExpressions', lang) }), 0xfe6465);
  }
  if (!interaction.guild.members.me?.permissions?.has(PermissionFlagsBits.ManageGuildExpressions)) {
    return say(t(lang, 'utility.steal.needPermission', { permission: permissionName('ManageGuildExpressions', lang) }), 0xfe6465);
  }
  if (kind === 'e' ? interaction.guild.emojis.cache.has(id) : interaction.guild.stickers.cache.has(id)) return say(t(lang, 'utility.jumbo.already'));

  await interaction.deferReply({ flags: V2 });
  const finish = (text, color) => interaction.editReply({ components: [textCard(text, color)] });
  try {
    if (kind === 'e') {
      const name = rest.join(':').replace(/\W/g, '_').slice(0, 32) || 'emoji';
      const created = await interaction.guild.emojis.create({ attachment: emojiUrl(id, animated === 'a'), name });
      return finish(t(lang, 'utility.jumbo.stolenEmoji', { emoji: `${created}`, name: created.name }), 0xa5ea7a);
    }
    const sticker = await interaction.client.fetchSticker(id);
    const url = stickerUrl(sticker);
    if (!url) return finish(t(lang, 'utility.steal.lottie'), 0xfe6465);
    const created = await interaction.guild.stickers.create({ file: url, name: sticker.name, tags: sticker.tags ?? 'e', description: sticker.description ?? '' });
    return finish(t(lang, 'utility.steal.stickerAdded', { emoji: EMOJI.APPROVE, name: created.name }), 0xa5ea7a);
  } catch (err) {
    logger.error('Failed to steal from the jumbo card:', err);
    return finish(t(lang, 'utility.jumbo.failed', { emoji: EMOJI.DENY, error: err.message }), 0xfe6465);
  }
}

module.exports = { STEAL_PREFIX, handleButton };

// The buttons of `!stats privacy` (stop being counted, be counted again, delete what was counted about me) and the confirmation of
// `!statsconfig delete`. Each belongs to the person who asked: nobody else can press it.
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const statsRules = require('../db/statsRules');
const activityStats = require('../db/activityStats');
const detail = require('../db/activityDetail');
const { buildPrivacyPanel, PREFIX } = require('../utils/statsPanels');
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');
const { permissionName } = require('../utils/permissionLabels');
const logger = require('../utils/logger');
const { t, tn, languageOf } = require('../i18n');

const V2 = MessageFlags.IsComponentsV2;
const PRIVATE = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const [, action, ...rest] = interaction.customId.split(':');
  const ownerId = action === 'purge' ? rest[1] : rest[0];
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ components: [textCard(t(lang, action === 'purge' ? 'info.statsConfig.delete.notYours' : 'info.stats.privacy.notYours'), 0xfe6465)], flags: PRIVATE });
  }

  if (action === 'purge') {
    const guildId = rest[0];
    // Only someone who can manage the server may delete its counters, also when they press the button a while later.
    if (!interaction.guild || interaction.guild.id !== guildId || !interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ components: [textCard(t(lang, 'core.moderate.youNeed', { permission: permissionName('ManageGuild', lang) }), 0xfe6465)], flags: PRIVATE });
    }
    await interaction.deferUpdate();
    // What is waiting to be written goes first, so that it does not come back after the delete.
    await Promise.all([activityStats.flushActivity(), detail.flush()]).catch((error) => logger.warn(`Stats flush before deleting failed: ${error.message}`));
    const removed = await statsRules.deleteGuildCounts(guildId);
    return interaction.editReply({ components: [textCard(tn(lang, 'info.statsConfig.delete.done', removed, { emoji: EMOJI.APPROVE, count: removed }), 0xa5ea7a)], flags: V2 });
  }

  await interaction.deferUpdate();
  let optedOut = statsRules.isOptedOut(ownerId);
  let done = null;
  if (action === 'optout') {
    await statsRules.setOptOut(ownerId, true);
    optedOut = true;
    done = t(lang, 'info.stats.privacy.optedOut', { emoji: EMOJI.APPROVE });
  } else if (action === 'optin') {
    await statsRules.setOptOut(ownerId, false);
    optedOut = false;
    done = t(lang, 'info.stats.privacy.optedIn', { emoji: EMOJI.APPROVE });
  } else if (action === 'delete') {
    const removed = await statsRules.deleteMemberCounts(ownerId);
    done = tn(lang, 'info.stats.privacy.deleted', removed, { emoji: EMOJI.APPROVE, count: removed });
  }
  return interaction.editReply({ ...buildPrivacyPanel({ userId: ownerId, optedOut, done, lang }), flags: V2 });
}

module.exports = { PREFIX, handleButton };

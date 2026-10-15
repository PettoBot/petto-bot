// The menu and the page buttons of `!quests list`: picking a quest shows its card (only to whoever picked it), and the
// buttons move through the pages. Only the team can use them while the quest alerts are in testing.
const { MessageFlags } = require('discord.js');
const questApi = require('../utils/questApi');
const questsDb = require('../db/quests');
const { questMessage, buildQuestList, SELECT_ID, PAGE_ID } = require('../utils/questMessages');
const { canUseQuests } = require('../utils/questAlerts');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

const QUEST_PREFIX = 'quests:';

const sortNewest = (quests) => quests.sort((a, b) => (b.startsAt - a.startsAt) || b.id.localeCompare(a.id));
const activeQuests = async () => sortNewest((await questApi.getQuests()).filter((quest) => questApi.isActive(quest)));
const say = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

async function handleSelect(interaction) {
  const lang = await languageOf(interaction);
  if (!canUseQuests(interaction.user.id)) return say(interaction, t(lang, 'quests.testing'));
  const questId = interaction.values?.[0];
  let quests;
  try { quests = await activeQuests(); } catch (error) { logger.warn(`Quest menu: ${error.message}`); return say(interaction, t(lang, 'quests.menu.readFailed')); }
  const quest = quests.find((entry) => entry.id === questId);
  if (!quest) return say(interaction, t(lang, 'quests.menu.notActive'));
  const settings = (interaction.guild ? await questsDb.getConfig(interaction.guild.id).catch(() => null) : null) ?? questsDb.DEFAULTS;
  const payload = await questMessage(interaction.guild, { ...settings, role_id: null }, quest, 'new', lang);
  return interaction.reply({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral });
}

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  if (!canUseQuests(interaction.user.id)) return say(interaction, t(lang, 'quests.testing'));
  const page = Number(interaction.customId.split(':')[2]);
  if (!Number.isInteger(page) || page < 1) return interaction.deferUpdate();
  let quests;
  try { quests = await activeQuests(); } catch (error) { logger.warn(`Quest menu: ${error.message}`); return say(interaction, t(lang, 'quests.menu.readFailed')); }
  return interaction.update(buildQuestList(quests, { page, lang }));
}

module.exports = { QUEST_PREFIX, SELECT_ID, PAGE_ID, handleSelect, handleButton };

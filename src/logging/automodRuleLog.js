// Discord AutoMod rules created, changed and deleted. They go to the `automod` category with the actions Petto takes.
const { sendLog, fetchMod, AuditLogEvent } = require('./engine');
const { t, guildLanguage } = require('../i18n');

const TRIGGERS = { 1: 'customWords', 3: 'spam', 4: 'keywordPreset', 5: 'mentionSpam', 6: 'memberProfile' };
const ACTIONS = { 1: 'blockMessage', 2: 'sendAlert', 3: 'timeoutMember', 4: 'blockInteraction' };

const triggerName = (type, lang) => (TRIGGERS[type] ? t(lang, `logs.automod.trigger.${TRIGGERS[type]}`) : t(lang, 'logs.unknown'));
const yesNo = (value, lang) => t(lang, value ? 'logs.yes' : 'logs.no');
// An action Petto does not know is told as "Action" in the summary, and left empty in a change (as before).
const actionName = (type, lang, unknown = t(lang, 'logs.automod.action.generic')) => (ACTIONS[type] ? t(lang, `logs.automod.action.${ACTIONS[type]}`) : unknown);
const actionList = (rule, lang, unknown) => (rule.actions ?? []).map((action) => actionName(action.type, lang, unknown)).join(', ') || t(lang, 'logs.none');

function summary(rule, lang) {
  return [
    { name: t(lang, 'logs.field.trigger'), value: triggerName(rule.triggerType, lang), inline: true },
    { name: t(lang, 'logs.field.enabled'), value: yesNo(rule.enabled, lang), inline: true },
    { name: t(lang, 'logs.field.actions'), value: actionList(rule, lang), inline: false },
  ];
}

async function handleRuleCreate(rule, client) {
  const lang = await guildLanguage(rule.guild.id);
  const fields = summary(rule, lang);
  if (rule.creatorId) fields.push({ name: t(lang, 'logs.field.by'), value: `<@${rule.creatorId}>`, inline: true });
  await sendLog(client, rule.guild.id, 'automod', {
    author: { name: t(lang, 'logs.automod.created.title') },
    description: t(lang, 'logs.automod.created.description', { name: rule.name }),
    fields,
    footer: { text: t(lang, 'logs.automod.footer', { id: rule.id }) },
    timestamp: new Date().toISOString(),
  });
}

async function handleRuleDelete(rule, client) {
  const lang = await guildLanguage(rule.guild.id);
  const mod = await fetchMod(rule.guild, AuditLogEvent.AutoModerationRuleDelete, rule.id);
  const fields = summary(rule, lang);
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });
  await sendLog(client, rule.guild.id, 'automod', {
    author: { name: t(lang, 'logs.automod.deleted.title') },
    description: t(lang, 'logs.automod.deleted.description', { name: rule.name }),
    fields,
    footer: { text: t(lang, 'logs.automod.footer', { id: rule.id }) },
    timestamp: new Date().toISOString(),
  });
}

async function handleRuleUpdate(oldRule, newRule, client) {
  if (!oldRule) return;
  const lang = await guildLanguage(newRule.guild.id);
  const fields = [];
  if (oldRule.name !== newRule.name) fields.push({ name: t(lang, 'logs.field.name'), value: `\`${oldRule.name}\` -> \`${newRule.name}\``, inline: false });
  if (oldRule.enabled !== newRule.enabled) fields.push({ name: t(lang, 'logs.field.enabled'), value: `${yesNo(oldRule.enabled, lang)} -> ${yesNo(newRule.enabled, lang)}`, inline: true });
  const before = (oldRule.actions ?? []).map((a) => a.type).join();
  const after = (newRule.actions ?? []).map((a) => a.type).join();
  if (before !== after) fields.push({ name: t(lang, 'logs.field.actions'), value: `${actionList(oldRule, lang, '')} -> ${actionList(newRule, lang, '')}`, inline: false });
  if (JSON.stringify(oldRule.triggerMetadata ?? {}) !== JSON.stringify(newRule.triggerMetadata ?? {})) fields.push({ name: t(lang, 'logs.field.settings'), value: t(lang, 'logs.automod.settingsChanged'), inline: false });
  if (!fields.length) return;
  const mod = await fetchMod(newRule.guild, AuditLogEvent.AutoModerationRuleUpdate, newRule.id);
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });
  await sendLog(client, newRule.guild.id, 'automod', {
    author: { name: t(lang, 'logs.automod.updated.title') },
    description: t(lang, 'logs.automod.updated.description', { name: newRule.name }),
    fields,
    footer: { text: t(lang, 'logs.automod.footer', { id: newRule.id }) },
    timestamp: new Date().toISOString(),
  });
}

module.exports = { handleRuleCreate, handleRuleDelete, handleRuleUpdate };

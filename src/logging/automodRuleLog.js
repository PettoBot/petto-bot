// Discord AutoMod rules created, changed and deleted. They go to the `automod` category with the actions Petto takes.
const { sendLog, fetchMod, AuditLogEvent } = require('./engine');

const TRIGGERS = { 1: 'Custom words', 3: 'Spam', 4: 'Keyword preset', 5: 'Mention spam', 6: 'Member profile' };
const ACTIONS = { 1: 'Block message', 2: 'Send alert', 3: 'Timeout member', 4: 'Block interaction' };

function summary(rule) {
  const actions = (rule.actions ?? []).map((action) => ACTIONS[action.type] ?? 'Action').join(', ') || 'None';
  return [
    { name: 'Trigger', value: TRIGGERS[rule.triggerType] ?? 'Unknown', inline: true },
    { name: 'Enabled', value: rule.enabled ? 'Yes' : 'No', inline: true },
    { name: 'Actions', value: actions, inline: false },
  ];
}

async function handleRuleCreate(rule, client) {
  const fields = summary(rule);
  if (rule.creatorId) fields.push({ name: 'By', value: `<@${rule.creatorId}>`, inline: true });
  await sendLog(client, rule.guild.id, 'automod', {
    author: { name: 'AutoMod Rule Created' },
    description: `The rule \`${rule.name}\` was created`,
    fields,
    footer: { text: `Rule ID: ${rule.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleRuleDelete(rule, client) {
  const mod = await fetchMod(rule.guild, AuditLogEvent.AutoModerationRuleDelete, rule.id);
  const fields = summary(rule);
  if (mod) fields.push({ name: 'By', value: mod, inline: true });
  await sendLog(client, rule.guild.id, 'automod', {
    author: { name: 'AutoMod Rule Deleted' },
    description: `The rule \`${rule.name}\` was deleted`,
    fields,
    footer: { text: `Rule ID: ${rule.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleRuleUpdate(oldRule, newRule, client) {
  if (!oldRule) return;
  const fields = [];
  if (oldRule.name !== newRule.name) fields.push({ name: 'Name', value: `\`${oldRule.name}\` -> \`${newRule.name}\``, inline: false });
  if (oldRule.enabled !== newRule.enabled) fields.push({ name: 'Enabled', value: `${oldRule.enabled ? 'Yes' : 'No'} -> ${newRule.enabled ? 'Yes' : 'No'}`, inline: true });
  const before = (oldRule.actions ?? []).map((a) => a.type).join();
  const after = (newRule.actions ?? []).map((a) => a.type).join();
  if (before !== after) fields.push({ name: 'Actions', value: `${(oldRule.actions ?? []).map((a) => ACTIONS[a.type]).join(', ') || 'None'} -> ${(newRule.actions ?? []).map((a) => ACTIONS[a.type]).join(', ') || 'None'}`, inline: false });
  if (JSON.stringify(oldRule.triggerMetadata ?? {}) !== JSON.stringify(newRule.triggerMetadata ?? {})) fields.push({ name: 'Settings', value: 'The words, limits or exemptions of the rule were changed', inline: false });
  if (!fields.length) return;
  const mod = await fetchMod(newRule.guild, AuditLogEvent.AutoModerationRuleUpdate, newRule.id);
  if (mod) fields.push({ name: 'By', value: mod, inline: true });
  await sendLog(client, newRule.guild.id, 'automod', {
    author: { name: 'AutoMod Rule Updated' },
    description: `The rule \`${newRule.name}\` was updated`,
    fields,
    footer: { text: `Rule ID: ${newRule.id}` },
    timestamp: new Date().toISOString(),
  });
}

module.exports = { handleRuleCreate, handleRuleDelete, handleRuleUpdate };

// Moderation rules made in the dashboard (utils/modRulesEngine.ts). Reference catalog: es and pt-BR must have the same keys.
module.exports = {
  'modrules.reason': 'Rule "{rule}"',
  'modrules.banDm': 'You were banned from **{server}**. {reason}',
  'modrules.log': '**{rule}** · {user} in {channel} · {trigger} → {effects}',
  'modrules.logNone': 'nothing yet',
  "modrules.logDry": "**{rule}** (test) · {user} in {channel} · {trigger} → would do: {effects}",
  "modrules.alert": "{rule}: {user} in {channel}",
  "modrules.gate.reason": "Join gate: {why}",
  "modrules.gate.alert": "Join gate: {user} ({why})",
  "modrules.gate.raid": "{joins} joins in {seconds} seconds",
  "modrules.gate.raidOn": "a raid is going on",
  "modrules.gate.raidAlert": "**Possible raid:** {joins} members joined in {seconds} seconds.",
};

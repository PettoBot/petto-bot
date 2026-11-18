// Moderation rules made in the dashboard (utils/modRulesEngine.ts). Reference catalog: es and pt-BR must have the same keys.
module.exports = {
  'modrules.reason': 'Regla "{rule}"',
  'modrules.banDm': 'Te baneamos de **{server}**. {reason}',
  'modrules.log': '**{rule}** · {user} en {channel} · {trigger} → {effects}',
  'modrules.logNone': 'nada todavía',
  "modrules.logDry": "**{rule}** (prueba) · {user} en {channel} · {trigger} → haría: {effects}",
  "modrules.alert": "{rule}: {user} en {channel}",
  "modrules.gate.reason": "Puerta de entrada: {why}",
  "modrules.gate.alert": "Puerta de entrada: {user} ({why})",
  "modrules.gate.raid": "{joins} entradas en {seconds} segundos",
  "modrules.gate.raidOn": "hay un raid en curso",
  "modrules.gate.raidAlert": "**Posible raid:** {joins} miembros entraron en {seconds} segundos.",
};

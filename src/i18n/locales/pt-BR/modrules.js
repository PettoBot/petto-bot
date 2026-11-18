// Moderation rules made in the dashboard (utils/modRulesEngine.ts). Reference catalog: es and pt-BR must have the same keys.
module.exports = {
  'modrules.reason': 'Regra "{rule}"',
  'modrules.banDm': 'Você foi banido de **{server}**. {reason}',
  'modrules.log': '**{rule}** · {user} em {channel} · {trigger} → {effects}',
  'modrules.logNone': 'nada ainda',
  "modrules.logDry": "**{rule}** (teste) · {user} em {channel} · {trigger} → faria: {effects}",
  "modrules.alert": "{rule}: {user} em {channel}",
  "modrules.gate.reason": "Porta de entrada: {why}",
  "modrules.gate.alert": "Porta de entrada: {user} ({why})",
  "modrules.gate.raid": "{joins} entradas em {seconds} segundos",
  "modrules.gate.raidOn": "há um raid em andamento",
  "modrules.gate.raidAlert": "**Possível raid:** {joins} membros entraram em {seconds} segundos.",
};

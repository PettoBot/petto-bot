// Roles por mensajes: un rol que se da al llegar a un número de mensajes (utils/messageRoles.ts, commands/welcome/messagerole.js). Catálogo de referencia: es y pt-BR deben tener las mismas claves.
module.exports = {
  'messageroles.managed': '{role} lo gestiona una integración o es @everyone: no se puede dar ni quitar.',
  'messageroles.aboveMe': '{role} está por encima de mi rol más alto, así que no puedo darlo ni quitarlo. Sube mi rol por encima.',
  'messageroles.problem.full': 'No hay espacio: un servidor puede tener {max} reglas de este tipo.',
  'messageroles.problem.messages': 'El número de mensajes tiene que ser de 1 a {maxMessages}.',
  'messageroles.problem.period': 'Los días del periodo tienen que ser de 1 a {maxDays}.',
  'messageroles.rule.total': '**{messages}** mensajes',
  'messageroles.rule.period': '**{messages}** mensajes en los últimos **{days}** días',
  'messageroles.rule.periodRemove': '**{messages}** mensajes en los últimos **{days}** días (se quita si baja de ahí)',
  'messageroles.added': '{emoji} Desde ahora, {role} se da a los miembros que lleguen a {rule}.',
  'messageroles.countsFromNow': 'Los mensajes se cuentan desde ahora: los enviados antes de la primera regla no cuentan. El miembro recibe el rol justo después del mensaje con el que llega.',
  'messageroles.removed': '{emoji} Dejé de dar {role} por mensajes ({count} quitadas). Los miembros se quedan con los roles que ya tienen.',
  'messageroles.notFound': 'No hay ninguna regla para {role}.',
  'messageroles.empty': 'Todavía no se da ningún rol por mensajes. Añade uno con `add`.',
  'messageroles.listTitle': '**Roles por mensajes** ({count} de {max})',
  'messageroles.line': '{role} con {rule}{off}',
  'messageroles.off': 'apagada',
};

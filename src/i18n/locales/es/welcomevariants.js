// Varios mensajes para la bienvenida, la despedida y el boost (utils/messageVariantsCommand.ts). Catálogo de referencia: es y pt-BR deben tener las mismas claves.
module.exports = {
  'welcomevariants.kind.welcome': 'bienvenida',
  'welcomevariants.kind.leave': 'despedida',
  'welcomevariants.kind.boost': 'boost',
  'welcomevariants.needText': 'Escribe el mensaje, o el nombre de un embed guardado en `embed`.',
  'welcomevariants.noEmbed': 'No hay un embed guardado llamado "{name}".',
  'welcomevariants.full': 'No hay espacio: en «{kind}» caben {max} mensajes en total.',
  'welcomevariants.added': '{emoji} Agregado. En «{kind}» ahora hay {total} mensajes; se elige uno al azar cada vez, nunca el mismo dos veces seguidas.',
  'welcomevariants.firstNote': 'El número 1 es el mensaje principal: cámbialo con `setup`. Aquí solo se pueden quitar los demás.',
  'welcomevariants.removed': '{emoji} Se quitó el mensaje número {number}.',
  'welcomevariants.notFound': 'No hay un mensaje número {number}: mira primero la lista.',
  'welcomevariants.template': 'embed guardado "{name}"',
  'welcomevariants.listTitle': '**Mensajes de {kind}** ({count} de {max}): se elige uno al azar cada vez.',
  'welcomevariants.listEmpty': '«{kind}» todavía no tiene mensaje. Pon el primero con `setup`.',
};

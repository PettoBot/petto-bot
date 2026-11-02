// Un rol que un servidor eligió en una configuración de Petto y luego eliminó: el aviso para su staff, en el canal de registros del servidor.
module.exports = {
  'deadroles.title': '{emoji} Un rol elegido en Petto ya no existe',
  'deadroles.body': 'El rol `{role}` elegido para {where} fue eliminado de este servidor.',
  'deadroles.where.verification': 'la verificación',
  'deadroles.where.gate': 'la puerta de verificación (el rol de quienes aún no se verificaron)',
  'deadroles.where.join': 'los roles de entrada',
  'deadroles.where.reaction': 'un rol por reacción',
  'deadroles.where.level': 'una recompensa de nivel',
  'deadroles.where.button': 'un botón o menú de roles',
  'deadroles.where.invite': 'una recompensa de invitaciones',
  'deadroles.action.removed': 'Petto lo quitó de esa configuración para que nada siga fallando. Elige un rol nuevo ahí cuando quieras.',
  'deadroles.action.pick': 'Abre esa configuración en el panel y elige el rol otra vez.',
  'deadroles.action.verification.removed': 'Petto lo quitó de la configuración de verificación para que nada siga fallando. Abre la configuración de verificación en el panel (o usa `/verify setup`) y elige un rol otra vez. Mientras tanto, quienes pasan la comprobación cuentan como verificados en Petto pero no reciben ningún rol.',
  'deadroles.action.made': 'Petto creó un rol nuevo llamado **{name}** y lo guardó en esa configuración.',
};

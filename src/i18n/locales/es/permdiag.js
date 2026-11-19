// Qué falta exactamente cuando Petto no pudo hacer algo (utils/permissionDiagnosis.ts, utils/permissionAlerts.ts): se le dice a quien lo pidió, al staff en el canal de registros y en el dashboard.
module.exports = {
  'permdiag.here.server': 'en este servidor',
  'permdiag.here.channel': 'en {channel}',
  'permdiag.item': '**{permission}** {where}',
  'permdiag.member.single': 'No pude hacerlo: me falta **{permission}** {where}. Pídele al staff que me lo dé.',
  'permdiag.member.many': 'No pude hacerlo: me faltan estos permisos: {list}. Pídele al staff que me los dé.',
  'permdiag.role.above': 'El rol {role} está por encima de mi rol más alto, así que no puedo darlo ni quitarlo. Pídele al staff que suba mi rol por encima de ese.',
  'permdiag.role.managed': 'El rol {role} pertenece a una integración (un bot o un servicio), así que no puedo darlo ni quitarlo.',
  'permdiag.member.above': 'Ese miembro tiene un rol tan alto como el mío o más alto (o es el dueño del servidor), así que no puedo hacerle eso. Pídele al staff que suba mi rol por encima del suyo.',
  'permdiag.feature.command': 'el comando **{name}**',
  'permdiag.feature.event': 'el evento **{name}**',
  'permdiag.feature.ticket': 'una acción de tickets',
  'permdiag.feature.task': 'una tarea de Petto',
  'permdiag.notice.feature': 'Qué falló: {feature} (ha pasado {count} veces).',
};

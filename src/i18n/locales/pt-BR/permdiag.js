// O que exatamente está faltando quando o Petto não conseguiu fazer algo (utils/permissionDiagnosis.ts, utils/permissionAlerts.ts): dito a quem pediu, à equipe no canal de logs e no dashboard.
module.exports = {
  'permdiag.here.server': 'neste servidor',
  'permdiag.here.channel': 'em {channel}',
  'permdiag.item': '**{permission}** {where}',
  'permdiag.member.single': 'Não consegui fazer isso: está faltando **{permission}** {where}. Peça para a equipe me dar essa permissão.',
  'permdiag.member.many': 'Não consegui fazer isso: estão faltando estas permissões: {list}. Peça para a equipe me dar essas permissões.',
  'permdiag.role.above': 'O cargo {role} está acima do meu cargo mais alto, então não posso dá-lo nem tirá-lo. Peça para a equipe subir meu cargo acima dele.',
  'permdiag.role.managed': 'O cargo {role} pertence a uma integração (um bot ou um serviço), então não posso dá-lo nem tirá-lo.',
  'permdiag.member.above': 'Esse membro tem um cargo tão alto quanto o meu ou mais alto (ou é o dono do servidor), então não posso fazer isso com ele. Peça para a equipe subir meu cargo acima do dele.',
  'permdiag.feature.command': 'o comando **{name}**',
  'permdiag.feature.event': 'o evento **{name}**',
  'permdiag.feature.ticket': 'uma ação de tickets',
  'permdiag.feature.task': 'uma tarefa do Petto',
  'permdiag.notice.feature': 'O que falhou: {feature} (já aconteceu {count} vezes).',
};

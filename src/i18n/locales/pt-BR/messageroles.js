// Cargos por mensagens: um cargo dado ao chegar a um número de mensagens (utils/messageRoles.ts, commands/welcome/messagerole.js). Catálogo de referência: es e pt-BR devem ter as mesmas chaves.
module.exports = {
  'messageroles.managed': '{role} é gerenciado por uma integração ou é @everyone: não pode ser dado nem tirado.',
  'messageroles.aboveMe': '{role} está acima do meu cargo mais alto, então não posso dá-lo nem tirá-lo. Suba meu cargo acima dele.',
  'messageroles.problem.full': 'Não há espaço: um servidor pode ter {max} regras deste tipo.',
  'messageroles.problem.messages': 'O número de mensagens deve ser de 1 a {maxMessages}.',
  'messageroles.problem.period': 'Os dias do período devem ser de 1 a {maxDays}.',
  'messageroles.rule.total': '**{messages}** mensagens',
  'messageroles.rule.period': '**{messages}** mensagens nos últimos **{days}** dias',
  'messageroles.rule.periodRemove': '**{messages}** mensagens nos últimos **{days}** dias (é tirado se cair abaixo)',
  'messageroles.added': '{emoji} A partir de agora, {role} é dado aos membros que chegarem a {rule}.',
  'messageroles.countsFromNow': 'As mensagens são contadas a partir de agora: as enviadas antes da primeira regra não contam. O membro recebe o cargo logo depois da mensagem que o faz chegar lá.',
  'messageroles.removed': '{emoji} Parei de dar {role} por mensagens ({count} removidas). Os membros ficam com os cargos que já têm.',
  'messageroles.notFound': 'Não há nenhuma regra para {role}.',
  'messageroles.empty': 'Nenhum cargo é dado por mensagens ainda. Adicione um com `add`.',
  'messageroles.listTitle': '**Cargos por mensagens** ({count} de {max})',
  'messageroles.line': '{role} com {rule}{off}',
  'messageroles.off': 'desligada',
};

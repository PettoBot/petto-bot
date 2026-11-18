// Várias mensagens para as boas-vindas, a despedida e o boost (utils/messageVariantsCommand.ts). Catálogo de referência: es e pt-BR devem ter as mesmas chaves.
module.exports = {
  'welcomevariants.kind.welcome': 'boas-vindas',
  'welcomevariants.kind.leave': 'despedida',
  'welcomevariants.kind.boost': 'boost',
  'welcomevariants.needText': 'Escreva a mensagem, ou o nome de um embed salvo em `embed`.',
  'welcomevariants.noEmbed': 'Não há um embed salvo chamado "{name}".',
  'welcomevariants.full': 'Não há espaço: em «{kind}» cabem {max} mensagens no total.',
  'welcomevariants.added': '{emoji} Adicionada. Em «{kind}» agora há {total} mensagens; uma é escolhida ao acaso a cada vez, nunca a mesma duas vezes seguidas.',
  'welcomevariants.firstNote': 'O número 1 é a mensagem principal: mude com `setup`. Aqui só dá para remover as outras.',
  'welcomevariants.removed': '{emoji} A mensagem número {number} foi removida.',
  'welcomevariants.notFound': 'Não há mensagem número {number}: veja a lista primeiro.',
  'welcomevariants.template': 'embed salvo "{name}"',
  'welcomevariants.listTitle': '**Mensagens de {kind}** ({count} de {max}): uma é escolhida ao acaso a cada vez.',
  'welcomevariants.listEmpty': '«{kind}» ainda não tem mensagem. Defina a primeira com `setup`.',
};

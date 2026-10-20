// Comandos de imagens: !quote, !image e a cor de uma imagem (!hex).
module.exports = {
  'images.error.botAttach': 'Não posso enviar imagens aqui: preciso da permissão Anexar arquivos neste canal.',
  'images.error.memberAttach': 'Você precisa da permissão Anexar arquivos neste canal para usar os comandos de imagens.',
  'images.error.tooLarge': 'Essa imagem é pesada demais (o limite é {mb} MB).',
  'images.error.tooManyPixels': 'Essa imagem é grande demais (no máximo {side} pixels de cada lado).',
  'images.error.notImage': 'Isso não é uma imagem PNG, JPEG, WebP ou GIF que eu consiga ler.',
  'images.error.download': 'Não consegui baixar essa imagem. Confira o link e tente de novo.',
  'images.error.httpsOnly': 'Só são aceitos links `https://` de imagens.',
  'images.error.noSource': 'Não encontrei uma imagem nem um membro para `{input}`. Anexe uma imagem, responda a uma, ou informe um link ou um membro.',
  'images.error.busy': 'Muitas imagens estão sendo feitas agora. Tente de novo em alguns segundos.',
  'images.error.render': 'Algo deu errado ao fazer a imagem. Tente com outra.',
  'images.gifFirstFrame': '-# GIF: só o primeiro quadro foi usado.',
  'images.hex.done': '**{hex}** · `rgb({rgb})`',
  'images.quote.usage': 'Responda a uma mensagem com `{prefix}quote`, ou informe um link ou ID de mensagem, ou um texto e um membro: `{prefix}quote olá @membro`. Adicione `--color`, `--light` ou `--bold` para mudar o visual.',
  'images.quote.noText': 'Essa mensagem não tem texto para citar.',
  'images.quote.notFound': 'Não encontrei essa mensagem, ou você não pode ver o canal dela.',
  'images.quote.otherServer': 'Só posso citar mensagens deste servidor.',
};

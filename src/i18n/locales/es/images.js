// Comandos de imágenes: !quote, !image y el color de una imagen (!hex).
module.exports = {
  'images.error.botAttach': 'No puedo enviar imágenes aquí: necesito el permiso Adjuntar archivos en este canal.',
  'images.error.memberAttach': 'Necesitas el permiso Adjuntar archivos en este canal para usar los comandos de imágenes.',
  'images.error.tooLarge': 'Esa imagen es demasiado pesada (el límite es {mb} MB).',
  'images.error.tooManyPixels': 'Esa imagen es demasiado grande (como mucho {side} píxeles por lado).',
  'images.error.notImage': 'Eso no es una imagen PNG, JPEG, WebP o GIF que pueda leer.',
  'images.error.download': 'No pude descargar esa imagen. Revisa el enlace e inténtalo de nuevo.',
  'images.error.httpsOnly': 'Solo se aceptan enlaces `https://` de imágenes.',
  'images.error.noSource': 'No encontré una imagen ni un miembro para `{input}`. Adjunta una imagen, responde a una, o indica un enlace o un miembro.',
  'images.error.busy': 'Se están haciendo demasiadas imágenes ahora mismo. Inténtalo de nuevo en unos segundos.',
  'images.error.render': 'Algo salió mal al hacer la imagen. Inténtalo con otra.',
  'images.gifFirstFrame': '-# GIF: solo se usó el primer fotograma.',
  'images.hex.done': '**{hex}** · `rgb({rgb})`',
  'images.quote.usage': 'Responde a un mensaje con `{prefix}quote`, o indica un enlace o ID de mensaje, o un texto y un miembro: `{prefix}quote hola @miembro`. Añade `--color`, `--light` o `--bold` para cambiar el estilo.',
  'images.quote.noText': 'Ese mensaje no tiene texto que citar.',
  'images.quote.notFound': 'No encontré ese mensaje, o no puedes ver su canal.',
  'images.quote.otherServer': 'Solo puedo citar mensajes de este servidor.',
};

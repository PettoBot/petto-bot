// Image commands: !quote, !image and the color of a picture (!hex).
module.exports = {
  'images.error.botAttach': "I can't send images here: I need the Attach Files permission in this channel.",
  'images.error.memberAttach': 'You need the Attach Files permission in this channel to use image commands.',
  'images.error.tooLarge': 'That image is too large (the limit is {mb} MB).',
  'images.error.tooManyPixels': 'That image is too big (at most {side} pixels on each side).',
  'images.error.notImage': "That isn't a PNG, JPEG, WebP or GIF image I can read.",
  'images.error.download': "I couldn't download that image. Check the link and try again.",
  'images.error.httpsOnly': 'Only `https://` image links are accepted.',
  'images.error.noSource': "I couldn't find an image or a member for `{input}`. Attach an image, reply to one, or give a link or a member.",
  'images.error.busy': 'Too many images are being made right now. Try again in a few seconds.',
  'images.error.render': 'Something went wrong while making the image. Try again with another one.',
  'images.gifFirstFrame': '-# GIF: only the first frame was used.',
  'images.hex.done': '**{hex}** · `rgb({rgb})`',
  'images.quote.usage': 'Reply to a message with `{prefix}quote`, or give a message link or ID, or some text and a member: `{prefix}quote hello @member`. Add `--color`, `--light` or `--bold` to change the look.',
  'images.quote.noText': 'That message has no text to quote.',
  'images.quote.notFound': "I couldn't find that message, or you can't see its channel.",
  'images.quote.otherServer': 'I can only quote messages from this server.',
};

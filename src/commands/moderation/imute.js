// !imute / !iunmute: no files or embeds for a member, everywhere. They can still talk.
const { createPermissionMuteCommand } = require('../../utils/permissionMute');

module.exports = createPermissionMuteCommand('image', {
  name: 'imute',
  aliases: ['imagemute', 'picmute'],
  description: 'Take away the files and embeds of a member in every channel (they can still talk).',
  userText: 'Image mute a member.',
  removeText: 'Give a member their files and embeds back.',
});

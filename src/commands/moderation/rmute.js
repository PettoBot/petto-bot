// !rmute / !runmute: no reactions or external emojis for a member, everywhere. They can still talk.
const { createPermissionMuteCommand } = require('../../utils/permissionMute');

module.exports = createPermissionMuteCommand('reaction', {
  name: 'rmute',
  aliases: ['reactionmute'],
  description: 'Take away the reactions and external emojis of a member in every channel.',
  userText: 'Reaction mute a member.',
  removeText: 'Give a member their reactions and external emojis back.',
});

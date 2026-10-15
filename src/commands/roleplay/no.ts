const { createRoleplayCommand } = require('../../utils/roleplay');

module.exports = createRoleplayCommand('no', {
  aliases: ['nope'],
  description: 'Give a playful no.',
});

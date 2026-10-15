const { createRoleplayCommand } = require('../../utils/roleplay');

module.exports = createRoleplayCommand('hi', {
  aliases: ['hello'],
  description: 'Say hi to someone.',
});

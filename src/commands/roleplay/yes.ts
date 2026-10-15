const { createRoleplayCommand } = require('../../utils/roleplay');

module.exports = createRoleplayCommand('yes', {
  aliases: ['agree'],
  description: 'Give an enthusiastic yes.',
});

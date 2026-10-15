const { createRoleplayCommand } = require('../../utils/roleplay');

module.exports = createRoleplayCommand('sad', {
  aliases: ['unhappy'],
  description: 'Share a sad moment.',
});

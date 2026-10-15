const { createRoleplayCommand } = require('../../utils/roleplay');

module.exports = createRoleplayCommand('bye', {
  aliases: ['goodbye'],
  description: 'Say goodbye to someone.',
});

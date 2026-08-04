const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('highfive', { aliases: ['hf'], label: 'high five', verb: 'high-fives', self: '**{actor}** holds a high five in the air.', description: 'Give someone a high five.' });

const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('kick', { label: 'kick', verb: 'gives a harmless roleplay kick to', self: '**{actor}** kicks the air dramatically.', description: 'Give someone a harmless roleplay kick.' });

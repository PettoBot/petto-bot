const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('slap', { label: 'slap', verb: 'gives a theatrical roleplay slap to', self: '**{actor}** slaps the air for dramatic effect.', description: 'Give someone a theatrical roleplay slap.' });

const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('dance', { label: 'dance', verb: 'dances with', self: '**{actor}** starts dancing.', description: 'Start a little dance.' });

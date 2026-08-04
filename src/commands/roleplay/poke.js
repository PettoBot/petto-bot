const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('poke', { label: 'poke', verb: 'pokes', self: '**{actor}** pokes the air to get attention.', description: 'Poke someone playfully.' });

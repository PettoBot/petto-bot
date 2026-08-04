const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('boop', { label: 'boop', verb: 'boops', self: '**{actor}** boops the air.', description: 'Give someone a tiny boop.' });

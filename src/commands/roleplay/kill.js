const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('kill', { label: 'defeat', verb: 'pretends to defeat', self: '**{actor}** defeats an imaginary boss.', description: 'Pretend to defeat someone in a fictional scene.' });

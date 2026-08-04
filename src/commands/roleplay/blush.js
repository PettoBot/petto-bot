const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('blush', { label: 'blush', verb: 'blushes at', self: '**{actor}** blushes shyly.', description: 'Blush at someone.' });

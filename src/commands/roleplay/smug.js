const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('smug', { label: 'smug', verb: 'looks smugly at', self: '**{actor}** looks extremely smug.', description: 'Give someone a smug look.' });

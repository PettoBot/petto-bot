const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('tickle', { label: 'tickle', verb: 'tickles', self: '**{actor}** tickles the air and laughs.', description: 'Tickle someone playfully.' });

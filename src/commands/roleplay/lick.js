const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('lick', { label: 'lick', verb: 'gives a silly lick to', self: '**{actor}** makes a silly face.', description: 'Give someone a silly lick.' });

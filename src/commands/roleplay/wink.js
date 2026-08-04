const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('wink', { label: 'wink', verb: 'winks at', self: '**{actor}** winks at the room.', description: 'Send a playful wink.' });

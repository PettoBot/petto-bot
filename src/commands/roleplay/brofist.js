const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('brofist', { aliases: ['bf'], label: 'brofist', verb: 'brofists', self: '**{actor}** raises a fist for the room.', description: 'Share a victorious brofist.' });

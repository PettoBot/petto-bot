const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('happy', { label: 'happy', verb: 'celebrates with', self: '**{actor}** is feeling happy.', description: 'Share a happy moment.' });

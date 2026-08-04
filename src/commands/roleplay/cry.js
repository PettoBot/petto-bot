const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('cry', { label: 'cry', verb: 'cries with', self: '**{actor}** has a small cry.', description: 'Share an emotional moment.' });

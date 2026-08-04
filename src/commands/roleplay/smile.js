const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('smile', { label: 'smile', verb: 'smiles at', self: '**{actor}** smiles warmly.', description: 'Share a warm smile.' });

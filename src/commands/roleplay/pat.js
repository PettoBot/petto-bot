const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('pat', { label: 'pat', verb: 'gently pats', self: '**{actor}** gives themselves a reassuring pat.', description: 'Give someone a gentle pat.' });

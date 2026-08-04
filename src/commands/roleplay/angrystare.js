const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('angrystare', { label: 'angry stare', verb: 'stares angrily at', self: '**{actor}** practices an intimidating stare.', description: 'Give someone an exaggerated angry stare.' });

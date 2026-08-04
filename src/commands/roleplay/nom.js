const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('nom', { label: 'nom', verb: 'playfully noms', self: '**{actor}** noms on an imaginary snack.', description: 'Nom playfully.' });

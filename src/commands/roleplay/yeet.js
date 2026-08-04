const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('yeet', { label: 'yeet', verb: 'pretends to yeet', self: '**{actor}** yeets an imaginary object into the distance.', description: 'Pretend to yeet someone in a fictional scene.' });

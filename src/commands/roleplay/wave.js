const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('wave', { label: 'wave', verb: 'waves to', self: '**{actor}** waves to everyone.', description: 'Wave hello to someone.' });

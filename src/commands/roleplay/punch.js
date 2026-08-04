const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('punch', { label: 'punch', verb: 'throws a harmless roleplay punch at', self: '**{actor}** shadowboxes dramatically.', description: 'Throw a harmless fictional punch.' });

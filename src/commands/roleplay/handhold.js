const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('handhold', { aliases: ['hh'], label: 'hand hold', verb: 'holds hands with', self: '**{actor}** holds their own hand and smiles.', description: 'Hold hands with someone.' });

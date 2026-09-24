"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('yes', {
    aliases: ['agree'],
    label: 'yes',
    verb: 'agrees with',
    self: '**{actor}** gives an enthusiastic yes.',
    description: 'Give an enthusiastic yes.',
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('angry', {
    label: 'angry',
    verb: 'gets angry at',
    self: '**{actor}** looks angry.',
    description: 'Show playful anger at someone.',
});

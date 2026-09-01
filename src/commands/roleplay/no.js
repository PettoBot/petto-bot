"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('no', {
    aliases: ['nope'],
    label: 'no',
    verb: 'says no to',
    self: '**{actor}** shakes their head and says no.',
    description: 'Give a playful no.',
});

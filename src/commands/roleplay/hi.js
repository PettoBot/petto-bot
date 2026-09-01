"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('hi', {
    aliases: ['hello'],
    label: 'hi',
    verb: 'says hi to',
    self: '**{actor}** says hi to everyone.',
    description: 'Say hi to someone.',
});

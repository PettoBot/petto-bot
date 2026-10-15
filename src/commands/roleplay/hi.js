"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('hi', {
    aliases: ['hello'],
    description: 'Say hi to someone.',
});

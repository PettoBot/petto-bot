"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('yes', {
    aliases: ['agree'],
    description: 'Give an enthusiastic yes.',
});

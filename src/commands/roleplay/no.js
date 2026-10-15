"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('no', {
    aliases: ['nope'],
    description: 'Give a playful no.',
});

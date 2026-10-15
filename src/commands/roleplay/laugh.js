"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('laugh', {
    aliases: ['lol'],
    description: 'Share a laugh with someone.',
});

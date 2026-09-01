"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('sad', {
    aliases: ['unhappy'],
    label: 'sad',
    verb: 'feels sad with',
    self: '**{actor}** looks sad.',
    description: 'Share a sad moment.',
});

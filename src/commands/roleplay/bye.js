"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('bye', {
    aliases: ['goodbye'],
    label: 'goodbye',
    verb: 'says goodbye to',
    self: '**{actor}** says goodbye to everyone.',
    description: 'Say goodbye to someone.',
});

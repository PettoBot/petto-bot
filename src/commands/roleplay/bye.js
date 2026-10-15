"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { createRoleplayCommand } = require('../../utils/roleplay');
module.exports = createRoleplayCommand('bye', {
    aliases: ['goodbye'],
    description: 'Say goodbye to someone.',
});

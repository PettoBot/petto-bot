const config = require('../config');
const { tokenize } = require('../handlers/prefixInteraction');

const CONTROL_ACTIONS = new Set(['stats', 'sync']);

function controlAction(rawText) {
  const tokens = tokenize(rawText);
  if (tokens[0] !== config.automodControlToken) return null;
  const action = (tokens[1] || 'stats').toLowerCase();
  return CONTROL_ACTIONS.has(action) ? action : 'invalid';
}

function isPettoOperator(userId) {
  return userId === config.ownerId || config.developerIds.includes(userId);
}

function controlCommand(prefix, action = null) {
  return `${prefix}am ${config.automodControlToken}${action ? ` ${action}` : ''}`;
}

module.exports = { controlAction, isPettoOperator, controlCommand };

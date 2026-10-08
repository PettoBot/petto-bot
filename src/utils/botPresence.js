// The status of the bot in the member list: the dot, and the custom status text under its name.
const { ActivityType } = require('discord.js');
const config = require('../config');
const botSettings = require('../db/botSettings');

const STATUSES = ['online', 'idle', 'dnd', 'invisible'];
const SETTING_KEY = 'presence_status';
const CUSTOM_STATUS = { name: 'Custom Status', type: ActivityType.Custom, state: 'Keeping the server safe', emoji: { name: '🦆' } };

function normalizeStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  return STATUSES.includes(status) ? status : null;
}

/** The status chosen from Discord and saved, or the one from the environment (online by default). */
async function currentStatus() {
  try {
    return normalizeStatus(await botSettings.getSetting(SETTING_KEY)) ?? config.presenceStatus;
  } catch {
    return config.presenceStatus;
  }
}

function applyStatus(client, status) {
  client.user.setPresence({ status, activities: status === 'invisible' ? [] : [CUSTOM_STATUS] });
}

async function chooseStatus(client, status) {
  const normalized = normalizeStatus(status);
  if (!normalized) throw new Error(`The status must be one of: ${STATUSES.join(', ')}.`);
  await botSettings.setSetting(SETTING_KEY, normalized);
  applyStatus(client, normalized);
  return normalized;
}

module.exports = { STATUSES, normalizeStatus, currentStatus, applyStatus, chooseStatus };

// When the onboarding of a server is changed, what Petto knows about it (whether the join messages have to wait for it) is read again.
const { Events, AuditLogEvent } = require('discord.js');
const { forgetOnboarding } = require('../utils/joinGate');

const ONBOARDING = new Set([AuditLogEvent.OnboardingCreate, AuditLogEvent.OnboardingUpdate, AuditLogEvent.OnboardingPromptCreate, AuditLogEvent.OnboardingPromptUpdate, AuditLogEvent.OnboardingPromptDelete]);

module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  execute(entry, guild) {
    if (guild?.id && ONBOARDING.has(entry?.action)) forgetOnboarding(guild.id);
  },
};

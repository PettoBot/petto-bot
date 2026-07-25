/**
 * Parses a free-form string of channel mentions/IDs/names (space or comma separated) into
 * resolved GuildChannel objects. Same shape as userResolve.js/roleResolve.js, for options that
 * take multiple channels in one string (Discord slash commands have no native "list" type).
 */
function resolveChannels(guild, input) {
  const tokens = input.split(/[\s,]+/).filter(Boolean);
  const resolved = [];
  const unresolved = [];

  for (const token of tokens) {
    const id = token.replace(/[<#>]/g, '');
    const channel = guild.channels.cache.get(id) ?? guild.channels.cache.find((c) => c.name.toLowerCase() === token.toLowerCase());
    if (channel) resolved.push(channel);
    else unresolved.push(token);
  }

  return { resolved, unresolved };
}

module.exports = { resolveChannels };

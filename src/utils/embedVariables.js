// Variable/placeholder engine for /embed fields — ported from an earlier bot's
// utils/variables.js. Petto is slash-only (no prefix commands, no message-triggered
// commands), so `{server_prefix}` reads the guild's configured `prefix` column
// (via ctx.prefix, set by the caller) but nothing in Petto currently sets it from
// a command — it exists for forward-compatibility, same as the DB column itself.
// Message-scoped variables resolve empty when there's no triggering message in ctx.

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const BOOST_THRESHOLDS = [0, 2, 7, 14];

async function resolve(text, ctx = {}) {
  const { member, guild, channel, message } = ctx;
  const user = member?.user ?? ctx.user ?? message?.author;
  const currentLevel = guild?.premiumTier ?? 0;
  const nextLevel = Math.min(currentLevel + 1, 3);
  const boostRequired = BOOST_THRESHOLDS[nextLevel] ?? BOOST_THRESHOLDS[3];
  const boostCurrent = guild?.premiumSubscriptionCount ?? 0;
  const boostUntil = Math.max(0, boostRequired - boostCurrent);
  const allMembers = guild ? [...guild.members.cache.values()] : [];
  const humanMembers = allMembers.filter((m) => !m.user.bot);
  const randAll = allMembers[Math.floor(Math.random() * allMembers.length)];
  const randHuman = humanMembers[Math.floor(Math.random() * humanMembers.length)];
  const joinPos = (() => {
    if (!guild || !member?.joinedTimestamp) return '';
    const sorted = [...guild.members.cache.values()].filter((m) => m.joinedTimestamp).sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
    const pos = sorted.findIndex((m) => m.id === member.id) + 1;
    return pos > 0 ? String(pos) : '';
  })();

  let result = text;
  result = result.replace(/\{choose\d*:([^}]+)\}/gi, (_, opts) => {
    const choices = opts.split('|').map((s) => s.trim()).filter(Boolean);
    return choices[Math.floor(Math.random() * choices.length)] ?? '';
  });
  result = result.replace(/\{range:(\d+)-(\d+)\}/gi, (_, min, max) => {
    const lo = parseInt(min, 10);
    const hi = parseInt(max, 10);
    return String(Math.floor(Math.random() * (hi - lo + 1)) + lo);
  });

  const map = {
    '{user}': user ? `<@${user.id}>` : '',
    '{user_tag}': user?.username ?? '',
    '{user_name}': user?.username ?? '',
    '{user_avatar}': user?.displayAvatarURL({ size: 512 }) ?? '',
    '{user_id}': user?.id ?? '',
    '{user_discrim}': user?.discriminator ?? '',
    '{user_nick}': member?.displayName ?? user?.username ?? '',
    '{user_joindate}': member?.joinedAt?.toLocaleDateString('en-US') ?? '',
    '{user_createdate}': user?.createdAt?.toLocaleDateString('en-US') ?? '',
    '{user_displaycolor}': member?.displayHexColor ?? '#000000',
    '{user_boostsince}': member?.premiumSince?.toLocaleDateString('en-US') ?? 'Not boosting',
    '{user.mention}': user ? `<@${user.id}>` : '',
    '{user.name}': user?.username ?? '',
    '{user.id}': user?.id ?? '',
    '{user.avatar}': user?.displayAvatarURL({ size: 512 }) ?? '',
    '{user.display_avatar}': member?.displayAvatarURL({ size: 512 }) ?? user?.displayAvatarURL({ size: 512 }) ?? '',
    '{user.display_name}': member?.displayName ?? user?.username ?? '',
    '{user.joined_at}': member?.joinedAt?.toLocaleDateString('en-US') ?? '',
    '{user.joined_at_timestamp}': member?.joinedTimestamp ? String(Math.floor(member.joinedTimestamp / 1000)) : '',
    '{user.created_at}': user?.createdAt?.toLocaleDateString('en-US') ?? '',
    '{user.created_at_timestamp}': user?.createdTimestamp ? String(Math.floor(user.createdTimestamp / 1000)) : '',
    '{user.boost}': member?.premiumSince ? 'Yes' : 'No',
    '{user.boost_since}': member?.premiumSince?.toLocaleDateString('en-US') ?? 'Not boosting',
    '{user.boost_since_timestamp}': member?.premiumSinceTimestamp ? String(Math.floor(member.premiumSinceTimestamp / 1000)) : '',
    '{user.color}': member?.displayHexColor ?? '#000000',
    '{user.top_role}': member?.roles.highest?.name ?? 'N/A',
    '{user.role_list}': member ? member.roles.cache.filter((r) => r.id !== guild?.id).map((r) => `<@&${r.id}>`).join(', ') || 'N/A' : 'N/A',
    '{user.bot}': user?.bot ? 'Yes' : 'No',
    '{user.join_position}': joinPos,
    '{user.join_position_suffix}': joinPos ? ordinal(parseInt(joinPos, 10)) : '',
    '{server_prefix}': ctx.prefix ?? '/',
    '{server_name}': guild?.name ?? '',
    '{server_id}': guild?.id ?? '',
    '{server_membercount}': (guild?.memberCount ?? 0).toString(),
    '{server_membercount_ordinal}': ordinal(guild?.memberCount ?? 0),
    '{server_membercount_nobots}': humanMembers.length.toString(),
    '{server_membercount_nobots_ordinal}': ordinal(humanMembers.length),
    '{server_botcount}': (allMembers.length - humanMembers.length).toString(),
    '{server_botcount_ordinal}': ordinal(allMembers.length - humanMembers.length),
    '{server_icon}': guild?.iconURL({ size: 512 }) ?? '',
    '{server_rolecount}': (guild?.roles.cache.size ?? 0).toString(),
    '{server_channelcount}': (guild?.channels.cache.size ?? 0).toString(),
    '{server_randommember}': randAll ? `<@${randAll.id}>` : '',
    '{server_randommember_tag}': randAll?.user.username ?? '',
    '{server_randommember_nobots}': randHuman ? `<@${randHuman.id}>` : '',
    '{server_owner}': guild ? `<@${guild.ownerId}>` : '',
    '{server_owner_id}': guild?.ownerId ?? '',
    '{server_createdate}': guild?.createdAt?.toLocaleDateString('en-US') ?? '',
    '{server_boostlevel}': currentLevel.toString(),
    '{server_boostcount}': boostCurrent.toString(),
    '{server_nextboostlevel}': nextLevel.toString(),
    '{server_nextboostlevel_required}': boostRequired.toString(),
    '{server_nextboostlevel_until_required}': boostUntil.toString(),
    '{guild.name}': guild?.name ?? '',
    '{guild.id}': guild?.id ?? '',
    '{guild.count}': (guild?.memberCount ?? 0).toString(),
    '{guild.icon}': guild?.iconURL({ size: 512 }) ?? 'N/A',
    '{guild.banner}': guild?.bannerURL({ size: 1024 }) ?? 'N/A',
    '{guild.owner_id}': guild?.ownerId ?? '',
    '{guild.created_at}': guild?.createdAt?.toLocaleDateString('en-US') ?? '',
    '{guild.created_at_timestamp}': guild?.createdTimestamp ? String(Math.floor(guild.createdTimestamp / 1000)) : '',
    '{guild.emoji_count}': (guild?.emojis.cache.size ?? 0).toString(),
    '{guild.role_count}': (guild?.roles.cache.size ?? 0).toString(),
    '{guild.boost_count}': boostCurrent.toString(),
    '{guild.boost_tier}': currentLevel > 0 ? `Level ${currentLevel}` : 'No Level',
    '{guild.channels_count}': (guild?.channels.cache.size ?? 0).toString(),
    '{guild.vanity}': guild?.vanityURLCode ? `discord.gg/${guild.vanityURLCode}` : 'N/A',
    '{guild.region}': guild?.preferredLocale ?? 'N/A',
    '{guild.max_members}': (guild?.maximumMembers ?? 0).toString(),
    '{channel}': channel ? `<#${channel.id}>` : '',
    '{channel_name}': channel?.name ?? '',
    '{channel_createdate}': channel?.createdAt?.toLocaleDateString('en-US') ?? '',
    '{channel.name}': channel?.name ?? '',
    '{channel.id}': channel?.id ?? '',
    '{channel.mention}': channel ? `<#${channel.id}>` : '',
    '{channel.topic}': channel?.topic ?? 'N/A',
    '{message_link}': message && guild && channel ? `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}` : '',
    '{message_id}': message?.id ?? '',
    '{message_content}': message?.content ?? '',
    '{level}': ctx.levelData?.level != null ? String(ctx.levelData.level) : '',
    '{level_xp}': ctx.levelData?.xp != null ? ctx.levelData.xp.toLocaleString() : '',
    '{level_xp_needed}': ctx.levelData?.xpNeeded != null ? ctx.levelData.xpNeeded.toLocaleString() : '',
    '{level_rank}': ctx.levelData?.rank != null ? String(ctx.levelData.rank) : '',
    '{gw.prize}': ctx.giveaway?.prize ?? '',
    '{gw.winners}': ctx.giveaway?.winnersCount != null ? String(ctx.giveaway.winnersCount) : '',
    '{gw.entries}': ctx.giveaway?.entriesCount != null ? String(ctx.giveaway.entriesCount) : '',
    '{gw.host}': ctx.giveaway?.hostId ? `<@${ctx.giveaway.hostId}>` : '',
    '{gw.duration}': ctx.giveaway?.endsAtUnix != null ? String(ctx.giveaway.endsAtUnix) : '',
    '{gw.timestamp}': ctx.giveaway?.endsAtUnix != null ? `<t:${ctx.giveaway.endsAtUnix}:R>` : '',
    '{gw.claim_time}': ctx.giveaway?.claimTimeText ?? '',
    '{gw.reaction}': ctx.giveaway?.reaction ?? '',
    '{gw.entry_mode}': ctx.giveaway?.entryMode === 'reaction' ? 'react with' : 'click on',
    // {gw.preset}: the templating engine has no loop/conditional syntax, so the per-role
    // lines (using {role.mention}/{role.entries}/{role.claim_time}/{role.id}) are built by
    // the caller (see utils/giveawayEngine.js) and passed in pre-joined as ctx.giveaway.presetText.
    '{gw.preset}': ctx.giveaway?.presetText ?? '',
    '{date}': new Date().toLocaleDateString('en-US'),
    '{date.now}': new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }),
    '{date.utc_timestamp}': String(Math.floor(Date.now() / 1000)),
    '{date.utc_now}': new Date().toUTCString(),
    '{newline}': '\n',
    '{separator}': '──────────────────────',
  };

  for (const [key, val] of Object.entries(map)) {
    result = result.replaceAll(key, val);
  }
  return result;
}

module.exports = { resolve };

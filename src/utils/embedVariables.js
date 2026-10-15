// Variable/placeholder engine for /embed fields — ported from an earlier bot's
// utils/variables.js. Petto is slash-only (no prefix commands, no message-triggered
// commands), so `{server_prefix}` reads the guild's configured `prefix` column
// (via ctx.prefix, set by the caller) but nothing in Petto currently sets it from
// a command — it exists for forward-compatibility, same as the DB column itself.
// Message-scoped variables resolve empty when there's no triggering message in ctx.

const { parseWhen, discordTimestamp } = require('./when');
const { QUEST_EXTRA_KEYS } = require('./questTime');
const { buildProgressBar } = require('./levelProgressBar');
const { t, currentLanguage, formatNumber } = require('../i18n');

// The words Petto itself puts in a variable ("Yes", "Never", a date) follow the language of the server (`ctx.lang`, or the
// language of the command or event that is running). What the server wrote and the names of things are never translated.
const DATE_LOCALES = { en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' };
// 1.º / 1º: the ordinal mark of each language after the number (English uses its suffixes).
const ORDINAL_MARKS = { es: '.º', 'pt-BR': 'º' };

function ordinal(n, lang = 'en') {
  if (ORDINAL_MARKS[lang]) return `${n}${ORDINAL_MARKS[lang]}`;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const BOOST_THRESHOLDS = [0, 2, 7, 14];

async function resolve(text, ctx = {}) {
  const { member, guild, channel, message } = ctx;
  const lang = DATE_LOCALES[ctx.lang] ? ctx.lang : currentLanguage();
  const dateLocale = DATE_LOCALES[lang] ?? DATE_LOCALES.en;
  const word = (key, vars) => t(lang, `embeds.value.${key}`, vars);
  // Numbers with thousands separators: as before in English, and the way each language writes them otherwise.
  const count = (n) => (lang === 'en' ? n.toLocaleString() : formatNumber(lang, n));
  const argText = typeof ctx.args === 'string' ? ctx.args : '';
  const argTokens = Array.isArray(ctx.argTokens) ? ctx.argTokens : [];
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

  // {imgcard:name} is read by the message builder (utils/imgCardTokens.js); where no card is drawn it must not show up as text.
  let result = text.replace(/\{imgcard:[^}]*\}/gi, '');
  result = result.replace(/\{choose\d*:([^}]+)\}/gi, (_, opts) => {
    const choices = opts.split('|').map((s) => s.trim()).filter(Boolean);
    return choices[Math.floor(Math.random() * choices.length)] ?? '';
  });
  // {timestamp:tomorrow 8pm|F}: a moment written in words, shown the way the reader's Discord shows it.
  result = result.replace(/\{timestamp:([^}|]+)(?:\|([^}]+))?\}/gi, (_, when, style) => {
    const moment = parseWhen(when);
    return moment === null ? '' : discordTimestamp(moment, (style ?? 'f').trim());
  });
  result = result.replace(/\{range:(\d+)-(\d+)\}/gi, (_, min, max) => {
    const lo = parseInt(min, 10);
    const hi = parseInt(max, 10);
    return String(Math.floor(Math.random() * (hi - lo + 1)) + lo);
  });
  result = result.replace(/\{arg(\d{1,2})\}/gi, (_, rawIndex) => {
    const index = Number(rawIndex) - 1;
    return index >= 0 ? (argTokens[index] ?? '') : '';
  });
  result = result.replace(/\{args_from:(\d{1,2})\}/gi, (_, rawIndex) => {
    const index = Math.max(0, Number(rawIndex) - 1);
    return argTokens.slice(index).join(' ');
  });

  const map = {
    '{user}': user ? `<@${user.id}>` : '',
    '{user_tag}': user?.username ?? '',
    '{user_name}': user?.username ?? '',
    '{user_avatar}': user?.displayAvatarURL({ size: 512 }) ?? '',
    '{user_id}': user?.id ?? '',
    '{user_discrim}': user?.discriminator ?? '',
    '{user_nick}': member?.displayName ?? user?.username ?? '',
    '{user_joindate}': member?.joinedAt?.toLocaleDateString(dateLocale) ?? '',
    '{user_createdate}': user?.createdAt?.toLocaleDateString(dateLocale) ?? '',
    '{user_displaycolor}': member?.displayHexColor ?? '#000000',
    '{user_boostsince}': member?.premiumSince?.toLocaleDateString(dateLocale) ?? word('notBoosting'),
    '{user.mention}': user ? `<@${user.id}>` : '',
    '{user.name}': user?.username ?? '',
    '{user.id}': user?.id ?? '',
    '{user.avatar}': user?.displayAvatarURL({ size: 512 }) ?? '',
    '{user.display_avatar}': member?.displayAvatarURL({ size: 512 }) ?? user?.displayAvatarURL({ size: 512 }) ?? '',
    '{user.display_name}': member?.displayName ?? user?.username ?? '',
    '{user.joined_at}': member?.joinedAt?.toLocaleDateString(dateLocale) ?? '',
    '{user.joined_at_timestamp}': member?.joinedTimestamp ? String(Math.floor(member.joinedTimestamp / 1000)) : '',
    '{user.created_at}': user?.createdAt?.toLocaleDateString(dateLocale) ?? '',
    '{user.created_at_timestamp}': user?.createdTimestamp ? String(Math.floor(user.createdTimestamp / 1000)) : '',
    '{user.boost}': member?.premiumSince ? word('yes') : word('no'),
    '{user.boost_since}': member?.premiumSince?.toLocaleDateString(dateLocale) ?? word('notBoosting'),
    '{user.boost_since_timestamp}': member?.premiumSinceTimestamp ? String(Math.floor(member.premiumSinceTimestamp / 1000)) : '',
    '{user.color}': member?.displayHexColor ?? '#000000',
    '{user.top_role}': member?.roles.highest?.name ?? 'N/A',
    '{user.role_list}': member ? member.roles.cache.filter((r) => r.id !== guild?.id).map((r) => `<@&${r.id}>`).join(', ') || 'N/A' : 'N/A',
    '{user.bot}': user?.bot ? word('yes') : word('no'),
    '{user.join_position}': joinPos,
    '{user.join_position_suffix}': joinPos ? ordinal(parseInt(joinPos, 10), lang) : '',
    '{args}': argText,
    '{arguments}': argText,
    '{args_raw}': argText,
    '{arg_count}': String(argTokens.length),
    '{command_name}': ctx.commandName ?? '',
    '{prefix}': ctx.prefix ?? '',
    '{server_prefix}': ctx.prefix ?? '/',
    '{server_name}': guild?.name ?? '',
    '{server_id}': guild?.id ?? '',
    '{server_membercount}': (guild?.memberCount ?? 0).toString(),
    '{server_membercount_ordinal}': ordinal(guild?.memberCount ?? 0, lang),
    '{server_membercount_nobots}': humanMembers.length.toString(),
    '{server_membercount_nobots_ordinal}': ordinal(humanMembers.length, lang),
    '{server_botcount}': (allMembers.length - humanMembers.length).toString(),
    '{server_botcount_ordinal}': ordinal(allMembers.length - humanMembers.length, lang),
    '{server_icon}': guild?.iconURL({ size: 512 }) ?? '',
    '{server_rolecount}': (guild?.roles.cache.size ?? 0).toString(),
    '{server_channelcount}': (guild?.channels.cache.size ?? 0).toString(),
    '{server_randommember}': randAll ? `<@${randAll.id}>` : '',
    '{server_randommember_tag}': randAll?.user.username ?? '',
    '{server_randommember_nobots}': randHuman ? `<@${randHuman.id}>` : '',
    '{server_owner}': guild ? `<@${guild.ownerId}>` : '',
    '{server_owner_id}': guild?.ownerId ?? '',
    '{server_createdate}': guild?.createdAt?.toLocaleDateString(dateLocale) ?? '',
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
    '{guild.created_at}': guild?.createdAt?.toLocaleDateString(dateLocale) ?? '',
    '{guild.created_at_timestamp}': guild?.createdTimestamp ? String(Math.floor(guild.createdTimestamp / 1000)) : '',
    '{guild.emoji_count}': (guild?.emojis.cache.size ?? 0).toString(),
    '{guild.role_count}': (guild?.roles.cache.size ?? 0).toString(),
    '{guild.boost_count}': boostCurrent.toString(),
    '{guild.boost_tier}': currentLevel > 0 ? word('boostTier', { level: currentLevel }) : word('noBoostTier'),
    '{guild.channels_count}': (guild?.channels.cache.size ?? 0).toString(),
    '{guild.vanity}': guild?.vanityURLCode ? `discord.gg/${guild.vanityURLCode}` : 'N/A',
    '{guild.region}': guild?.preferredLocale ?? 'N/A',
    '{guild.max_members}': (guild?.maximumMembers ?? 0).toString(),
    '{channel}': channel ? `<#${channel.id}>` : '',
    '{channel_name}': channel?.name ?? '',
    '{channel_createdate}': channel?.createdAt?.toLocaleDateString(dateLocale) ?? '',
    '{channel.name}': channel?.name ?? '',
    '{channel.id}': channel?.id ?? '',
    '{channel.mention}': channel ? `<#${channel.id}>` : '',
    '{channel.topic}': channel?.topic ?? 'N/A',
    '{message_link}': message && guild && channel ? `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}` : '',
    '{message_id}': message?.id ?? '',
    '{message_content}': message?.content ?? '',
    '{level}': ctx.levelData?.level != null ? String(ctx.levelData.level) : '',
    '{level_xp}': ctx.levelData?.xp != null ? count(ctx.levelData.xp) : '',
    '{level_xp_needed}': ctx.levelData?.xpNeeded != null ? count(ctx.levelData.xpNeeded) : '',
    '{level_rank}': ctx.levelData?.rank != null ? String(ctx.levelData.rank) : '',
    '{level_next}': ctx.levelData?.level != null ? String(ctx.levelData.level + 1) : '',
    '{level_progress}': ctx.levelData?.progress != null ? String(ctx.levelData.progress) : '',
    '{level_xp_current}': ctx.levelData?.xpCurrent != null ? count(ctx.levelData.xpCurrent) : '',
    '{level_xp_to_next}': ctx.levelData?.xpToNext != null ? count(ctx.levelData.xpToNext) : '',
    '{level_rank_total}': ctx.levelData?.total != null ? String(ctx.levelData.total) : '',
    '{level_streak}': ctx.levelData?.streak != null ? String(ctx.levelData.streak) : '',
    '{level_messages}': ctx.levelData?.messages != null ? count(ctx.levelData.messages) : '',
    '{level_voice_minutes}': ctx.levelData?.voiceMinutes != null ? count(ctx.levelData.voiceMinutes) : '',
    '{level_type}': ctx.levelData?.source ?? '',
    '{level_bar}': ctx.levelData?.progress != null ? buildProgressBar(ctx.levelData.progress) : '',
    '{level_role}': ctx.levelReward?.id ? `<@&${ctx.levelReward.id}>` : '',
    '{level_role_name}': ctx.levelReward?.name ?? '',
    '{level_previous}': ctx.levelData?.level != null ? String(Math.max(0, ctx.levelData.level - 1)) : '',
    '{gw.prize}': ctx.giveaway?.prize ?? '',
    '{gw.winners}': ctx.giveaway?.winnersCount != null ? String(ctx.giveaway.winnersCount) : '',
    '{gw.entries}': ctx.giveaway?.entriesCount != null ? String(ctx.giveaway.entriesCount) : '',
    '{gw.host}': ctx.giveaway?.hostId ? `<@${ctx.giveaway.hostId}>` : '',
    '{gw.host_name}': ctx.giveaway?.hostName ?? '',
    '{gw.host_avatar}': ctx.giveaway?.hostAvatar ?? '',
    '{gw.duration}': ctx.giveaway?.endsAtUnix != null ? String(ctx.giveaway.endsAtUnix) : '',
    '{gw.timestamp}': ctx.giveaway?.endsAtUnix != null ? `<t:${ctx.giveaway.endsAtUnix}:R>` : '',
    '{gw.ends}': ctx.giveaway?.endsAtUnix != null ? `<t:${ctx.giveaway.endsAtUnix}:R>` : '',
    '{gw.claim_time}': ctx.giveaway?.claimTimeText ?? '',
    '{gw.reaction}': ctx.giveaway?.reaction ?? '',
    '{gw.entry_mode}': ctx.giveaway?.entryMode === 'reaction' ? word('entryReact') : word('entryClick'),
    '{gw.entry_text}': ctx.giveaway?.entryText ?? '',
    '{gw.winner_text}': ctx.giveaway?.winnerText ?? '',
    '{gw.status}': ctx.giveaway?.status ?? '',
    // {gw.preset}: the templating engine has no loop/conditional syntax, so the per-role
    // lines (using {role.mention}/{role.entries}/{role.claim_time}/{role.id}) are built by
    // the caller (see utils/giveawayEngine.js) and passed in pre-joined as ctx.giveaway.presetText.
    '{gw.preset}': ctx.giveaway?.presetText ?? '',
    // Moderation: ctx.sanction describes one case (see utils/sanctionTemplates.js), ctx.star one starred message and ctx.monkey one monkeyed message (see
    // events/starboardReaction.js) and ctx.verify the verification link.
    '{case.id}': ctx.sanction?.caseNumber != null ? String(ctx.sanction.caseNumber) : '',
    '{case.type}': ctx.sanction?.type ?? '',
    '{case.action}': ctx.sanction?.action ?? '',
    '{case.emoji}': ctx.sanction?.emoji ?? '',
    '{case.reason}': ctx.sanction ? (ctx.sanction.reason || word('noReason')) : '',
    '{case.duration}': ctx.sanction ? (ctx.sanction.durationText || (['ban', 'hardban', 'mute', 'jail'].includes(ctx.sanction.type) ? word('permanent') : 'N/A')) : '',
    '{case.expires}': ctx.sanction ? (ctx.sanction.expiresUnix ? `<t:${ctx.sanction.expiresUnix}:R>` : word('never')) : '',
    '{case.expires_at}': ctx.sanction ? (ctx.sanction.expiresUnix ? `<t:${ctx.sanction.expiresUnix}:f>` : word('never')) : '',
    '{case.source}': ctx.sanction?.source ?? '',
    '{case.moderator}': ctx.sanction?.moderator?.id ? `<@${ctx.sanction.moderator.id}>` : '',
    '{case.moderator_name}': ctx.sanction?.moderator?.name ?? '',
    '{case.moderator_id}': ctx.sanction?.moderator?.id ?? '',
    '{case.moderator_avatar}': ctx.sanction?.moderator?.avatar ?? '',
    '{case.user}': ctx.sanction?.target?.id ? `<@${ctx.sanction.target.id}>` : '',
    '{case.user_name}': ctx.sanction?.target?.name ?? '',
    '{case.user_id}': ctx.sanction?.target?.id ?? '',
    '{case.user_avatar}': ctx.sanction?.target?.avatar ?? '',
    // Vanity and Server Tag rules: ctx.identity describes one rule and the role it changed (see utils/identity/emit.js).
    '{rule.name}': ctx.identity?.rule?.name ?? '',
    '{rule.source}': ctx.identity?.rule?.source ?? '',
    '{rule.value}': ctx.identity?.rule?.value ?? '',
    '{rule.condition}': ctx.identity?.rule?.condition ?? '',
    '{rule.reason}': ctx.identity?.rule?.reason ?? '',
    '{rule.role}': ctx.identity?.rule?.role ?? '',
    '{rule.role_id}': ctx.identity?.rule?.roleId ?? '',
    '{rule.action}': ctx.identity?.rule?.action ?? '',
    '{rule.action_text}': ctx.identity?.rule?.actionText ?? '',
    '{rule.result}': ctx.identity?.rule?.result ?? '',
    '{rule.error}': ctx.identity?.rule?.error ?? '',
    '{rule.matched_value}': ctx.identity?.rule?.matchedValue ?? '',
    '{rule.event}': ctx.identity?.rule?.event ?? '',
    '{rule.event_title}': ctx.identity?.rule?.eventTitle ?? '',
    // The invite a member joined with (welcome messages): who made it, how many invites they have, and its code.
    '{inviter}': ctx.invite?.inviterId ? `<@${ctx.invite.inviterId}>` : word('unknown'),
    '{inviter.name}': ctx.invite?.inviterName || word('unknown'),
    '{inviter.id}': ctx.invite?.inviterId ?? '',
    '{inviter.invites}': String(ctx.invite?.invites ?? 0),
    '{invite.code}': ctx.invite?.code ?? '',
    '{vanity.rule}': ctx.identity?.vanity?.rule ?? '',
    '{vanity.word}': ctx.identity?.vanity?.word ?? '',
    '{vanity.source}': ctx.identity?.vanity?.source ?? '',
    '{vanity.value}': ctx.identity?.vanity?.value ?? '',
    '{vanity.role}': ctx.identity?.vanity?.role ?? '',
    '{tag}': ctx.identity?.tag?.text ?? '',
    '{tag.rule}': ctx.identity?.tag?.rule ?? '',
    '{tag.condition}': ctx.identity?.tag?.condition ?? '',
    '{tag.rule_value}': ctx.identity?.tag?.ruleValue ?? '',
    '{tag.guild_id}': ctx.identity?.tag?.guildId ?? '',
    '{tag.enabled}': ctx.identity?.tag?.enabled ?? '',
    '{tag.badge}': ctx.identity?.tag?.badge ?? '',
    '{tag.role}': ctx.identity?.tag?.role ?? '',
    '{star.count}': ctx.star?.count != null ? String(ctx.star.count) : '',
    '{star.emoji}': ctx.star?.emoji ?? '',
    '{star.channel}': ctx.star?.channelId ? `<#${ctx.star.channelId}>` : '',
    '{star.channel_name}': ctx.star?.channelName ?? '',
    '{star.link}': ctx.star?.link ?? '',
    '{star.message_id}': ctx.star?.messageId ?? '',
    '{star.author}': ctx.star?.author?.id ? `<@${ctx.star.author.id}>` : '',
    '{star.author_name}': ctx.star?.author?.name ?? '',
    '{star.author_id}': ctx.star?.author?.id ?? '',
    '{star.author_avatar}': ctx.star?.author?.avatar ?? '',
    '{star.content}': ctx.star ? (ctx.star.content || word('noText')) : '',
    '{star.image}': ctx.star?.image ?? '',
    '{star.attachments}': ctx.star?.attachments ?? '',
    '{star.time}': ctx.star?.unix ? `<t:${ctx.star.unix}:f>` : '',
    '{monkey.count}': ctx.monkey?.count != null ? String(ctx.monkey.count) : '',
    '{monkey.emoji}': ctx.monkey?.emoji ?? '',
    '{monkey.channel}': ctx.monkey?.channelId ? `<#${ctx.monkey.channelId}>` : '',
    '{monkey.channel_name}': ctx.monkey?.channelName ?? '',
    '{monkey.link}': ctx.monkey?.link ?? '',
    '{monkey.message_id}': ctx.monkey?.messageId ?? '',
    '{monkey.author}': ctx.monkey?.author?.id ? `<@${ctx.monkey.author.id}>` : '',
    '{monkey.author_name}': ctx.monkey?.author?.name ?? '',
    '{monkey.author_id}': ctx.monkey?.author?.id ?? '',
    '{monkey.author_avatar}': ctx.monkey?.author?.avatar ?? '',
    '{monkey.content}': ctx.monkey ? (ctx.monkey.content || word('noText')) : '',
    '{monkey.image}': ctx.monkey?.image ?? '',
    '{monkey.attachments}': ctx.monkey?.attachments ?? '',
    '{monkey.time}': ctx.monkey?.unix ? `<t:${ctx.monkey.unix}:f>` : '',
    '{suggestion.id}': ctx.suggestion?.id ?? '',
    '{suggestion.number}': ctx.suggestion?.number != null ? String(ctx.suggestion.number) : '',
    '{suggestion.content}': ctx.suggestion?.content ?? '',
    '{suggestion.status}': ctx.suggestion?.status ?? '',
    '{suggestion.status_label}': ctx.suggestion?.statusLabel ?? '',
    '{suggestion.reason}': ctx.suggestion?.reason ?? '',
    '{suggestion.staff}': ctx.suggestion?.staffId ? `<@${ctx.suggestion.staffId}>` : '',
    '{suggestion.staff_name}': ctx.suggestion?.staffName ?? '',
    '{suggestion.author}': ctx.suggestion?.author?.id ? `<@${ctx.suggestion.author.id}>` : '',
    '{suggestion.author_name}': ctx.suggestion?.author?.name ?? '',
    '{suggestion.author_id}': ctx.suggestion?.author?.id ?? '',
    '{suggestion.author_avatar}': ctx.suggestion?.author?.avatar ?? '',
    '{suggestion.up}': ctx.suggestion?.up != null ? String(ctx.suggestion.up) : '',
    '{suggestion.down}': ctx.suggestion?.down != null ? String(ctx.suggestion.down) : '',
    '{suggestion.up_emoji}': ctx.suggestion?.upEmoji ?? '',
    '{suggestion.down_emoji}': ctx.suggestion?.downEmoji ?? '',
    '{suggestion.score}': ctx.suggestion?.score != null ? String(ctx.suggestion.score) : '',
    '{suggestion.percent}': ctx.suggestion?.percent != null ? String(ctx.suggestion.percent) : '',
    '{suggestion.image}': ctx.suggestion?.image ?? '',
    '{suggestion.link}': ctx.suggestion?.link ?? '',
    '{suggestion.channel}': ctx.suggestion?.channelId ? `<#${ctx.suggestion.channelId}>` : '',
    '{suggestion.thread}': ctx.suggestion?.threadId ? `<#${ctx.suggestion.threadId}>` : '',
    '{suggestion.created}': ctx.suggestion?.unix ? `<t:${ctx.suggestion.unix}:R>` : '',
    '{suggestion.created_time}': ctx.suggestion?.unix ? `<t:${ctx.suggestion.unix}:f>` : '',
    '{confession.id}': ctx.confession?.id ?? '',
    '{confession.number}': ctx.confession?.number != null ? String(ctx.confession.number) : '',
    '{confession.content}': ctx.confession?.content ?? '',
    '{confession.image}': ctx.confession?.image ?? '',
    '{confession.link}': ctx.confession?.link ?? '',
    '{confession.channel}': ctx.confession?.channelId ? `<#${ctx.confession.channelId}>` : '',
    '{confession.created}': ctx.confession?.unix ? `<t:${ctx.confession.unix}:R>` : '',
    '{confession.created_time}': ctx.confession?.unix ? `<t:${ctx.confession.unix}:f>` : '',
    '{verify.link}': ctx.verify?.link ?? '',
    '{rollout.name}': ctx.rollout?.name ?? '',
    '{rollout.id}': ctx.rollout?.id ?? '',
    '{rollout.kind}': ctx.rollout?.kind ?? '',
    '{rollout.type}': ctx.rollout?.type ?? '',
    '{rollout.status}': ctx.rollout?.status ?? '',
    '{rollout.percent}': ctx.rollout?.percent ?? '',
    '{rollout.from}': ctx.rollout?.from ?? '',
    '{rollout.to}': ctx.rollout?.to ?? '',
    '{rollout.change}': ctx.rollout?.change ?? '',
    '{rollout.badge}': ctx.rollout?.badge ?? '',
    '{rollout.kind_icon}': ctx.rollout?.kind_icon ?? '',
    '{rollout.event_icon}': ctx.rollout?.event_icon ?? '',
    '{rollout.variants}': ctx.rollout?.variants ?? '',
    '{rollout.ranges}': ctx.rollout?.ranges ?? '',
    '{rollout.platforms}': ctx.rollout?.platforms ?? '',
    '{rollout.filters}': ctx.rollout?.filters ?? '',
    '{rollout.source}': ctx.rollout?.source ?? '',
    '{quest.name}': ctx.quest?.name ?? '',
    '{quest.game}': ctx.quest?.game ?? '',
    '{quest.publisher}': ctx.quest?.publisher ?? '',
    '{quest.id}': ctx.quest?.id ?? '',
    '{quest.url}': ctx.quest?.url ?? '',
    '{quest.link}': ctx.quest?.link ?? '',
    '{quest.image}': ctx.quest?.image ?? '',
    '{quest.logo}': ctx.quest?.logo ?? '',
    '{quest.color}': ctx.quest?.color ?? '',
    '{quest.reward}': ctx.quest?.reward ?? '',
    '{quest.reward_type}': ctx.quest?.reward_type ?? '',
    '{quest.reward_amount}': ctx.quest?.reward_amount ?? '',
    '{quest.reward_image}': ctx.quest?.reward_image ?? '',
    '{quest.task}': ctx.quest?.task ?? '',
    '{quest.task_minutes}': ctx.quest?.task_minutes ?? '',
    '{quest.tasks}': ctx.quest?.tasks ?? '',
    '{quest.platforms}': ctx.quest?.platforms ?? '',
    '{quest.starts}': ctx.quest?.starts ?? '',
    '{quest.starts_at}': ctx.quest?.starts_at ?? '',
    '{quest.expires}': ctx.quest?.expires ?? '',
    '{quest.expires_at}': ctx.quest?.expires_at ?? '',
    '{quest.limits}': ctx.quest?.limits ?? '',
    '{quest.age_gate}': ctx.quest?.age_gate ?? '',
    '{quest.status}': ctx.quest?.status ?? '',
    '{quest.source}': ctx.quest?.source ?? '',
    ...Object.fromEntries(QUEST_EXTRA_KEYS.map((key) => [`{quest.${key}}`, ctx.quest?.[key] ?? ''])),
    // Partners: ctx.partner describes one partnership (see utils/partnerMessages.js).
    '{poll.question}': ctx.poll?.question ?? '',
    '{poll.options}': ctx.poll?.options ?? '',
    '{poll.results}': ctx.poll?.results ?? '',
    '{poll.votes}': ctx.poll?.votes != null ? String(ctx.poll.votes) : '',
    '{poll.votes_text}': ctx.poll?.votesText ?? '',
    '{poll.type}': ctx.poll?.type ?? '',
    '{poll.status}': ctx.poll?.status ?? '',
    '{poll.ends}': ctx.poll?.endsAtUnix != null ? `<t:${ctx.poll.endsAtUnix}:R>` : '',
    '{poll.image}': ctx.poll?.image ?? '',
    '{poll.host}': ctx.poll?.hostId ? `<@${ctx.poll.hostId}>` : '',
    '{poll.winner}': ctx.poll?.winner ?? '',
    '{partner.name}': ctx.partner?.name ?? '',
    '{partner.id}': ctx.partner?.id ?? '',
    '{partner.members}': ctx.partner?.members ?? '',
    '{partner.invite}': ctx.partner?.invite ?? '',
    '{partner.manager}': ctx.partner?.manager ?? '',
    '{partner.manager_name}': ctx.partner?.manager_name ?? '',
    '{partner.count_day}': ctx.partner?.count_day ?? '',
    '{partner.count_week}': ctx.partner?.count_week ?? '',
    '{partner.count_total}': ctx.partner?.count_total ?? '',
    '{partner.min_members}': ctx.partner?.min_members ?? '',
    '{partner.min_age_days}': ctx.partner?.min_age_days ?? '',
    '{partner.cooldown_days}': ctx.partner?.cooldown_days ?? '',
    '{partner.cooldown_ends}': ctx.partner?.cooldown_ends ?? '',
    '{partner.cooldown}': ctx.partner?.cooldown ?? '',
    '{partner.rank_week}': ctx.partner?.rank_week ?? '',
    '{partner.rank_total}': ctx.partner?.rank_total ?? '',
    '{partner.top_week}': ctx.partner?.top_week ?? '',
    '{partner.top_week_count}': ctx.partner?.top_week_count ?? '',
    '{partner.top_total}': ctx.partner?.top_total ?? '',
    '{partner.top_total_count}': ctx.partner?.top_total_count ?? '',
    '{partner.server_day}': ctx.partner?.server_day ?? '',
    '{partner.server_week}': ctx.partner?.server_week ?? '',
    '{partner.server_total}': ctx.partner?.server_total ?? '',
    // Requests: ctx.request describes one request (see commands/automation/request.js).
    '{request.number}': ctx.request?.number ?? '',
    '{request.text}': ctx.request?.text ?? '',
    '{request.link}': ctx.request?.link ?? '',
    '{request.channel}': ctx.request?.channel ?? '',
    '{request.status}': ctx.request?.status ?? '',
    // Honeypot: ctx.honeypot describes the bait channel (see utils/honeypot.js).
    '{honeypot.action}': ctx.honeypot?.action ?? '',
    '{honeypot.count}': ctx.honeypot?.count ?? '',
    '{honeypot.channel}': ctx.honeypot?.channel ?? '',
    '{nextBump}': ctx.bump?.nextUnix ? `<t:${ctx.bump.nextUnix}:R>` : '',
    '{date}': new Date().toLocaleDateString(dateLocale, { timeZone: 'America/Bogota' }),
    '{date.now}': new Date().toLocaleDateString(dateLocale, { timeZone: 'America/Bogota' }),
    '{date.utc_timestamp}': String(Math.floor(Date.now() / 1000)),
    '{timestamp}': discordTimestamp(Date.now(), 'f'),
    '{timestamp.unix}': String(Math.floor(Date.now() / 1000)),
    '{timestamp.short_time}': discordTimestamp(Date.now(), 't'),
    '{timestamp.long_time}': discordTimestamp(Date.now(), 'T'),
    '{timestamp.short_date}': discordTimestamp(Date.now(), 'd'),
    '{timestamp.long_date}': discordTimestamp(Date.now(), 'D'),
    '{timestamp.full}': discordTimestamp(Date.now(), 'f'),
    '{timestamp.full_long}': discordTimestamp(Date.now(), 'F'),
    '{timestamp.short_datetime}': discordTimestamp(Date.now(), 's'),
    '{timestamp.medium_datetime}': discordTimestamp(Date.now(), 'S'),
    '{timestamp.relative}': discordTimestamp(Date.now(), 'R'),
    '{date.utc_now}': new Date().toUTCString(),
    '{newline}': '\n',
    '{separator}': '──────────────────────',
  };

  // Names other people (and other bots) use for the same thing, so a variable written the way the server's admins know it still works.
  const aliases = {
    mention: 'user', user_mention: 'user', member: 'user', 'member.mention': 'user', 'user.ping': 'user',
    'user.tag': 'user_tag', 'user.username': 'user_name', username: 'user_name', 'user.nickname': 'user.display_name', 'user.nick': 'user_nick', nickname: 'user_nick',
    'user.discriminator': 'user_discrim', 'user.avatar_url': 'user.avatar', 'user.display_avatar_url': 'user.display_avatar', 'member.name': 'user.display_name', 'member.id': 'user.id',
    'level.level': 'level', 'level.current': 'level', 'level.xp': 'level_xp', 'level.total_xp': 'level_xp', 'level.xp_needed': 'level_xp_needed', 'level.rank': 'level_rank',
    'level.next': 'level_next', 'level.progress': 'level_progress', 'level.xp_current': 'level_xp_current', 'level.xp_to_next': 'level_xp_to_next', 'level.rank_total': 'level_rank_total',
    'level.total': 'level_rank_total', 'level.streak': 'level_streak', 'level.messages': 'level_messages', 'level.voice_minutes': 'level_voice_minutes', 'level.type': 'level_type',
    'level.bar': 'level_bar', 'level.role': 'level_role', 'level.role_name': 'level_role_name', 'level.previous': 'level_previous',
    server: 'server_name', 'server.name': 'server_name', 'server.id': 'server_id', 'server.members': 'server_membercount', 'server.icon': 'server_icon', guild: 'server_name',
    'message.link': 'message_link', 'message.id': 'message_id', 'message.content': 'message_content', 'channel.link': 'channel',
  };
  // A variable is found whatever its case and with spaces inside the braces (`{ User.Mention }`), in one pass, so what a variable gives is never read as a variable again.
  const lookup = new Map(Object.entries(map).map(([key, val]) => [key.slice(1, -1).toLowerCase(), val]));
  result = result.replace(/\{\s*([A-Za-z0-9_.]+)\s*\}/g, (whole, name) => {
    const key = name.toLowerCase();
    const found = lookup.has(key) ? lookup.get(key) : lookup.get(aliases[key]);
    return found === undefined ? whole : String(found);
  });
  return result;
}

module.exports = { resolve };
